export class ModelServiceError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "ModelServiceError";
    this.code = code;
    this.status = status;
  }
}

export function createModelService({ client, model, timeoutMs, outputMaxChars }) {
  if (!client) throw new Error("model client is required");

  return Object.freeze({
    async *stream(messages, { signal } = {}) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason || "client_aborted");
      const timeout = setTimeout(() => controller.abort("upstream_timeout"), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      let totalChars = 0;

      try {
        let upstream;
        try {
          upstream = await client.chat.completions.create({ model, messages, stream: true }, { signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted && controller.signal.reason === "upstream_timeout") {
            throw new ModelServiceError("UPSTREAM_TIMEOUT", "上游模型请求超时", 504);
          }
          if (signal?.aborted || controller.signal.reason === "client_aborted") {
            throw new ModelServiceError("CLIENT_ABORTED", "客户端已断开连接", 499);
          }
          throw new ModelServiceError("UPSTREAM_ERROR", "上游模型调用失败", 502);
        }

        for await (const chunk of upstream) {
          if (controller.signal.aborted) {
            throw new ModelServiceError(
              signal?.aborted ? "CLIENT_ABORTED" : "UPSTREAM_TIMEOUT",
              signal?.aborted ? "客户端已断开连接" : "上游模型请求超时",
              signal?.aborted ? 499 : 504
            );
          }
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta !== "string" || delta.length === 0) continue;
          totalChars += delta.length;
          if (totalChars > outputMaxChars) {
            throw new ModelServiceError("OUTPUT_TOO_LARGE", "模型输出超过限制", 502);
          }
          yield delta;
        }
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      }
    }
  });
}
