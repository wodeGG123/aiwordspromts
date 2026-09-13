import OpenAI from "openai";
import { preparePromptFromRequest, RuntimeContractError } from "../runtime_contract.mjs";
import { IdempotencyStore, FixedWindowRateLimiter } from "./idempotency_store.mjs";
import { createModelService } from "./model_service.mjs";
import {
  capabilitiesPayload,
  healthPayload,
  readJsonBody,
  sendError,
  sendJson,
  writeSseData,
  writeSseDone,
  writeSseError,
  writeSseHeaders,
  writeSseComment
} from "./http_utils.mjs";

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function hashRequest(value) {
  return JSON.stringify(value);
}

export function createApp({ config, modelClient } = {}) {
  const client = modelClient || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const modelService = createModelService({
    client,
    model: config.aiModel,
    outputMaxChars: config.outputMaxChars,
    maxCompletionTokens: config.maxCompletionTokens
  });
  const idempotency = new IdempotencyStore();
  const limiter = new FixedWindowRateLimiter({ limit: config.rateLimitPerMinute });
  const activeByIp = new Map();

  function beginRequest(ip) {
    const active = activeByIp.get(ip) || 0;
    if (active >= config.maxConcurrentPerIp) {
      const error = new Error("too many concurrent requests");
      error.code = "CONCURRENT_LIMITED";
      throw error;
    }
    activeByIp.set(ip, active + 1);
    return () => {
      const next = (activeByIp.get(ip) || 1) - 1;
      if (next <= 0) activeByIp.delete(ip);
      else activeByIp.set(ip, next);
    };
  }

  async function handleChat(req, res, origin) {
    if (req.method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "请使用POST方法", config, origin);
      return;
    }

    let release;
    const requestStartedAt = Date.now();
    let requestBodyMs;
    let promptAssemblyMs;
    let requestMetrics = {};
    try {
      limiter.check(clientIp(req));
      release = beginRequest(clientIp(req));
      const input = await readJsonBody(req, config.requestMaxBytes);
      requestBodyMs = Date.now() - requestStartedAt;
      const requestId = input?.operation?.request_id;
      const idempotencyKey = req.headers["idempotency-key"];
      if (idempotencyKey && requestId && idempotencyKey !== requestId) {
        sendError(res, 400, "IDEMPOTENCY_KEY_MISMATCH", "Idempotency-Key必须与operation.request_id一致", config, origin, undefined, requestId);
        return;
      }
      if (input?.model !== undefined) {
        sendError(res, 400, "MODEL_OVERRIDE_NOT_ALLOWED", "生产接口不允许客户端指定模型", config, origin, undefined, requestId);
        return;
      }

      let prepared;
      const promptAssemblyStartedAt = Date.now();
      try {
        if (input?.runtime_yaml?.length > config.runtimeMaxChars) {
          throw Object.assign(new Error("runtime_yaml超过长度限制"), { code: "RUNTIME_TOO_LARGE" });
        }
        prepared = preparePromptFromRequest(input, {
          blacklist: config.enablePromptFilter ? config.promptBlacklist : null
        });
      } catch (error) {
        const status = error.code === "RUNTIME_TOO_LARGE" ? 413 : error instanceof RuntimeContractError ? 400 : 500;
        sendError(res, status, error.code || "PROMPT_ASSEMBLY_FAILED", error.message, config, origin, error.details, requestId);
        return;
      }
      promptAssemblyMs = Date.now() - promptAssemblyStartedAt;
      const systemPromptChars = prepared.messages.find(message => message.role === "system")?.content.length ?? 0;
      const userPromptChars = prepared.messages.find(message => message.role === "user")?.content.length ?? 0;
      const runtimeYamlChars = typeof prepared.runtimeYaml === "string" ? prepared.runtimeYaml.length : 0;
      requestMetrics = { request_body_ms: requestBodyMs, prompt_assembly_ms: promptAssemblyMs, runtime_yaml_chars: runtimeYamlChars, system_prompt_chars: systemPromptChars, user_prompt_chars: userPromptChars };

      const fingerprint = hashRequest({ runtime_yaml: input.runtime_yaml, operation: input.operation, state_version: input.state_version });
      const result = idempotency.begin(prepared.requestId, fingerprint);
      if (!result.created) {
        if (result.entry.fingerprint !== fingerprint) {
          sendError(res, 409, "IDEMPOTENCY_CONFLICT", "request_id已用于另一份请求快照", config, origin, undefined, prepared.requestId);
          return;
        }
        sendError(res, 409, "REQUEST_NOT_REPLAYABLE", "相同request_id的流已处理或正在处理中，不能重放或重新建立AI流", config, origin, { status: result.entry.status }, prepared.requestId);
        return;
      }

      idempotency.update(prepared.requestId, { status: "streaming" });
      const startedAt = Date.now();
      const log = (event, fields = {}) => console.info(JSON.stringify({
        component: "adventure-chat",
        event,
        request_id: prepared.requestId,
        operation: prepared.operationType,
        elapsed_ms: Date.now() - startedAt,
        total_elapsed_ms: Date.now() - requestStartedAt,
        ...fields
      }));
      const controller = new AbortController();
      const onAbort = () => controller.abort("client_aborted");
      req.once("aborted", onAbort);
      writeSseHeaders(res, config, origin);
      const heartbeat = setInterval(() => writeSseComment(res, "keep-alive"), config.sseHeartbeatMs);
      log("stream_started", {
        model: config.aiModel,
        max_completion_tokens: config.maxCompletionTokens,
        ...requestMetrics
      });

      let streamMetrics;
      try {
        let forwardedChars = 0;
        for await (const delta of modelService.stream(prepared.messages, {
          signal: controller.signal,
          onMetrics: metrics => { streamMetrics = metrics; }
        })) {
          writeSseData(res, delta);
          forwardedChars += delta.length;
        }
        const summary = { forwarded_chars: forwardedChars, ...(streamMetrics || {}) };
        if (controller.signal.aborted) {
          idempotency.update(prepared.requestId, { status: "cancelled" });
          log("stream_cancelled", summary);
          return;
        }
        idempotency.update(prepared.requestId, { status: "completed" });
        writeSseDone(res);
        log("stream_completed", summary);
      } catch (error) {
        const payload = { code: error.code || "UPSTREAM_ERROR", message: error.message };
        if (error.details !== undefined) payload.details = error.details;
        idempotency.update(prepared.requestId, { status: error.code === "CLIENT_ABORTED" ? "cancelled" : "failed", error: payload });
        log("stream_failed", { code: payload.code, ...(streamMetrics || {}) });
        if (!controller.signal.aborted && !res.writableEnded) writeSseError(res, payload);
      } finally {
        clearInterval(heartbeat);
        req.off("aborted", onAbort);
        if (!res.writableEnded) res.end();
      }
    } catch (error) {
      const status = error.code === "REQUEST_TOO_LARGE" || error.code === "RUNTIME_TOO_LARGE" ? 413 : error.code === "RATE_LIMITED" || error.code === "CONCURRENT_LIMITED" ? 429 : error.code === "INVALID_JSON" ? 400 : 500;
      sendError(res, status, error.code || "REQUEST_FAILED", error.code === "INVALID_JSON" ? "请求体不是合法JSON" : error.message, config, origin);
    } finally {
      release?.();
    }
  }

  return async function app(req, res) {
    const origin = req.headers.origin;
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true }, config, origin);
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ...healthPayload(), timestamp: new Date().toISOString() }, config, origin);
      return;
    }
    if (req.method === "GET" && req.url === "/api/capabilities") {
      sendJson(res, 200, capabilitiesPayload(config), config, origin);
      return;
    }
    if (req.url === "/api/chat") {
      await handleChat(req, res, origin);
      return;
    }
    sendError(res, 404, "NOT_FOUND", "未找到请求的端点", config, origin);
  };
}
