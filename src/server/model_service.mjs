export class ModelServiceError extends Error {
  constructor(code, message, status = 502, details) {
    super(message);
    this.name = "ModelServiceError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (typeof part?.text === "string") return part.text;
    if (typeof part?.value === "string") return part.value;
    return "";
  }).join("");
}

function extractChunkText(chunk) {
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
  return choices.map(choice => textFromContent(choice?.delta?.content ?? choice?.message?.content)).join("");
}

function extractReasoningText(chunk) {
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
  return choices.map(choice => textFromContent(choice?.delta?.reasoning_content ?? choice?.message?.reasoning_content)).join("");
}

function chunkDiagnostics(chunk) {
  return {
    keys: Object.keys(chunk || {}).slice(0, 20),
    choice_keys: Array.isArray(chunk?.choices) ? chunk.choices.map(choice => Object.keys(choice || {}).slice(0, 20)) : [],
    finish_reasons: Array.isArray(chunk?.choices) ? chunk.choices.map(choice => choice?.finish_reason).filter(Boolean) : [],
    has_refusal: Array.isArray(chunk?.choices) && chunk.choices.some(choice => Boolean(choice?.delta?.refusal || choice?.message?.refusal)),
    has_reasoning_content: Array.isArray(chunk?.choices) && chunk.choices.some(choice => typeof choice?.delta?.reasoning_content === "string")
  };
}

export function createModelService({ client, model, outputMaxChars, maxCompletionTokens }) {
  if (!client) throw new Error("model client is required");

  return Object.freeze({
    async *stream(messages, { signal, onMetrics } = {}) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason || "client_aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      let totalChars = 0;
      let receivedOutput = false;
      let observedChunks = 0;
      let contentChunks = 0;
      let reasoningChunks = 0;
      let reasoningCharsDiscarded = 0;
      let firstUpstreamChunkMs;
      let firstContentMs;
      let lastChunkDiagnostics;
      const modelStartedAt = Date.now();
      const reportMetrics = () => onMetrics?.({
        upstream_connect_ms: upstreamConnectedAt === undefined ? undefined : upstreamConnectedAt - modelStartedAt,
        time_to_first_chunk_ms: firstUpstreamChunkMs,
        time_to_first_content_ms: firstContentMs,
        generation_ms: Date.now() - modelStartedAt,
        observed_chunks: observedChunks,
        content_chunks: contentChunks,
        output_chars: totalChars,
        reasoning_chunks: reasoningChunks,
        reasoning_chars_discarded: reasoningCharsDiscarded,
        finish_reasons: lastChunkDiagnostics?.finish_reasons || []
      });
      let upstreamConnectedAt;

      try {
        let upstream;
        try {
          upstream = await client.chat.completions.create({
            model,
            messages,
            stream: true,
            max_tokens: maxCompletionTokens,
            thinking: { type: "disabled" }
          }, { signal: controller.signal });
          upstreamConnectedAt = Date.now();
        } catch (error) {
          if (controller.signal.aborted) {
            if (signal?.aborted || controller.signal.reason === "client_aborted") {
              throw new ModelServiceError("CLIENT_ABORTED", "客户端已断开连接", 499);
            }
            throw new ModelServiceError("UPSTREAM_ABORTED", "上游模型请求被中止", 502);
          }
          throw new ModelServiceError("UPSTREAM_ERROR", "上游模型调用失败", 502);
        }

        for await (const chunk of upstream) {
          observedChunks += 1;
          const elapsedMs = Date.now() - modelStartedAt;
          if (firstUpstreamChunkMs === undefined) firstUpstreamChunkMs = elapsedMs;
          lastChunkDiagnostics = chunkDiagnostics(chunk);
          if (controller.signal.aborted) {
            if (signal?.aborted || controller.signal.reason === "client_aborted") {
              throw new ModelServiceError("CLIENT_ABORTED", "客户端已断开连接", 499);
            }
            throw new ModelServiceError("UPSTREAM_ABORTED", "上游模型请求被中止", 502);
          }
          const reasoning = extractReasoningText(chunk);
          if (reasoning.length > 0) {
            reasoningChunks += 1;
            reasoningCharsDiscarded += reasoning.length;
          }
          const delta = extractChunkText(chunk);
          if (delta.length === 0) continue;
          if (firstContentMs === undefined) firstContentMs = elapsedMs;
          contentChunks += 1;
          receivedOutput = true;
          totalChars += delta.length;
          if (totalChars > outputMaxChars) {
            throw new ModelServiceError("OUTPUT_TOO_LARGE", "模型输出超过限制", 502);
          }
          yield delta;
        }
        if (!receivedOutput) {
          throw new ModelServiceError("EMPTY_MODEL_OUTPUT", "上游模型返回了空内容", 502, {
            observed_chunks: observedChunks,
            last_chunk: lastChunkDiagnostics || null
          });
        }
      } finally {
        reportMetrics();
        signal?.removeEventListener("abort", onAbort);
      }
    }
  });
}
