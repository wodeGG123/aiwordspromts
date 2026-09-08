import OpenAI from "openai";
import { preparePromptFromRequest, RuntimeContractError } from "../runtime_contract.mjs";
import { IdempotencyStore, FixedWindowRateLimiter } from "./idempotency_store.mjs";
import { createModelService, ModelServiceError } from "./model_service.mjs";
import {
  capabilitiesPayload,
  healthPayload,
  readJsonBody,
  sendError,
  sendJson,
  writeSseData,
  writeSseDone,
  writeSseError,
  writeSseHeaders
} from "./http_utils.mjs";

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function hashRequest(value) {
  return JSON.stringify(value);
}

function correctionMessages(messages, expectedTemplateName, actualTemplateName) {
  return Object.freeze([
    ...messages,
    Object.freeze({
      role: "user",
      content: `【系统纠错】上一次输出的event_details.template_name为“${actualTemplateName ?? "缺失"}”，与本次请求要求的“${expectedTemplateName}”不一致。请完整重生成本次响应，只输出模板“${expectedTemplateName}”，不要解释原因。`
    })
  ]);
}

function templateNameFromPrefix(text) {
  const match = /(?:^|\n)\s*template_name:\s*"([^"\r\n]+)"\s*(?:\r?\n|$)/.exec(text);
  return match ? match[1] : undefined;
}

async function streamVerifiedAttempt({ modelService, messages, expectedTemplateName, signal, onVerifiedDelta }) {
  let buffered = "";
  let rawYaml = "";
  let templateName;
  let released = false;

  for await (const delta of modelService.stream(messages, { signal })) {
    rawYaml += delta;
    if (released) {
      onVerifiedDelta(delta);
      continue;
    }

    buffered += delta;
    templateName = templateNameFromPrefix(buffered);
    if (templateName === undefined) continue;
    if (templateName !== expectedTemplateName) {
      return { rawYaml, templateName, verified: false };
    }
    released = true;
    onVerifiedDelta(buffered);
    buffered = "";
  }

  return { rawYaml, templateName, verified: released };
}

export function createApp({ config, modelClient } = {}) {
  const client = modelClient || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const modelService = createModelService({
    client,
    model: config.aiModel,
    timeoutMs: config.upstreamTimeoutMs,
    outputMaxChars: config.outputMaxChars
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
    try {
      limiter.check(clientIp(req));
      release = beginRequest(clientIp(req));
      const input = await readJsonBody(req, config.requestMaxBytes);
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

      const fingerprint = hashRequest({ runtime_yaml: input.runtime_yaml, operation: input.operation, state_version: input.state_version });
      const result = idempotency.begin(prepared.requestId, fingerprint);
      if (!result.created) {
        if (result.entry.fingerprint !== fingerprint) {
          sendError(res, 409, "IDEMPOTENCY_CONFLICT", "request_id已用于另一份请求快照", config, origin, undefined, prepared.requestId);
          return;
        }
        if (result.entry.status === "completed" && result.entry.rawYaml !== undefined) {
          writeSseHeaders(res, config, origin);
          writeSseData(res, result.entry.rawYaml);
          writeSseDone(res);
          res.end();
          return;
        }
        sendError(res, 409, "REQUEST_IN_PROGRESS", "相同request_id的请求正在处理中", config, origin, { status: result.entry.status }, prepared.requestId);
        return;
      }

      idempotency.update(prepared.requestId, { status: "streaming" });
      const controller = new AbortController();
      const onAbort = () => controller.abort("client_aborted");
      req.once("aborted", onAbort);
      writeSseHeaders(res, config, origin);

      try {
        let rawYaml = "";
        let lastTemplateName;
        let completed = false;
        for (let attempt = 0; attempt <= config.templateRetryLimit; attempt += 1) {
          const messages = attempt === 0
            ? prepared.messages
            : correctionMessages(prepared.messages, prepared.expectedTemplateName, lastTemplateName);
          const outcome = await streamVerifiedAttempt({
            modelService,
            messages,
            expectedTemplateName: prepared.expectedTemplateName,
            signal: controller.signal,
            onVerifiedDelta: delta => writeSseData(res, delta)
          });
          rawYaml = outcome.rawYaml;
          lastTemplateName = outcome.templateName;
          if (outcome.verified) {
            completed = true;
            break;
          }
        }

        if (!completed) {
          const error = new ModelServiceError(
            "SCHEMA_TEMPLATE_MISMATCH",
            `模型输出模板“${lastTemplateName ?? "缺失"}”与期望模板“${prepared.expectedTemplateName}”不一致`,
            502
          );
          error.details = {
            expected_template_name: prepared.expectedTemplateName,
            actual_template_name: lastTemplateName ?? null,
            attempts: config.templateRetryLimit + 1
          };
          throw error;
        }
        if (controller.signal.aborted) {
          idempotency.update(prepared.requestId, { status: "cancelled" });
          return;
        }
        idempotency.update(prepared.requestId, { status: "completed", rawYaml });
        writeSseDone(res);
      } catch (error) {
        const payload = { code: error.code || "UPSTREAM_ERROR", message: error.message };
        if (error.details !== undefined) payload.details = error.details;
        idempotency.update(prepared.requestId, { status: error.code === "CLIENT_ABORTED" ? "cancelled" : "failed", error: payload });
        if (!controller.signal.aborted && !res.writableEnded) writeSseError(res, payload);
      } finally {
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

export { ModelServiceError };
