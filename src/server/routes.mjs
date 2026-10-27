import OpenAI from "openai";
import { preparePromptFromRequest, RuntimeContractError } from "../runtime_contract.mjs";
import { IdempotencyStore, FixedWindowRateLimiter } from "./idempotency_store.mjs";
import { createModelService } from "./model_service.mjs";
import { createAiDebugger } from "./ai_debug.mjs";
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

// 校验失败时把 event_context 摘要落日志（不记录 runtime_yaml，避免日志被撑爆）
function summarizeEventContext(eventContext) {
  if (!eventContext || typeof eventContext !== "object") return null;
  const summarizeEntries = value => {
    if (!Array.isArray(value)) return undefined;
    return value.map(item => {
      if (item === null || typeof item !== "object") return { value: item };
      return { id: item.id, name: item.name };
    });
  };
  return {
    candidate_event_ids: eventContext.candidate_event_ids,
    event_id: eventContext.event_id,
    forced_event_id: eventContext.forced_event_id,
    npc_names: eventContext.npc_names,
    associated_roles: summarizeEntries(eventContext.associated_roles),
    scene_ids: eventContext.scene_ids,
    associated_scenes: summarizeEntries(eventContext.associated_scenes)
  };
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
  const aiDebugger = createAiDebugger({
    enabled: config.aiDebugTrace,
    logDir: config.aiDebugLogDir,
    maxAgeDays: config.aiDebugLogMaxAgeDays
  });
  if (aiDebugger.enabled) {
    console.info(`[ai-trace] ENABLED, writing each AI call to ${aiDebugger.dir} (retention: ${aiDebugger.maxAgeDays} days)`);
  } else {
    console.info(`[ai-trace] disabled (set AI_DEBUG_TRACE=true to enable, or unset NODE_ENV=production)`);
  }
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
        console.warn(JSON.stringify({
          component: "adventure-chat",
          event: "request_rejected",
          request_id: requestId,
          operation: input?.operation?.type,
          code: error.code || "PROMPT_ASSEMBLY_FAILED",
          message: error.message,
          details: error.details,
          event_context: summarizeEventContext(input?.event_context)
        }));
        sendError(res, status, error.code || "PROMPT_ASSEMBLY_FAILED", error.message, config, origin, error.details, requestId);
        return;
      }
      promptAssemblyMs = Date.now() - promptAssemblyStartedAt;
      if (Array.isArray(prepared.assetFindings) && prepared.assetFindings.length > 0) {
        console.warn(JSON.stringify({
          component: "adventure-chat",
          event: "asset_scope_advisory",
          request_id: prepared.requestId,
          operation: prepared.operationType,
          findings: prepared.assetFindings
        }));
      }
      const systemPromptChars = prepared.messages.find(message => message.role === "system")?.content.length ?? 0;
      const userPromptChars = prepared.messages.find(message => message.role === "user")?.content.length ?? 0;
      const runtimeYamlChars = typeof prepared.runtimeYaml === "string" ? prepared.runtimeYaml.length : 0;
      requestMetrics = { request_body_ms: requestBodyMs, prompt_assembly_ms: promptAssemblyMs, runtime_yaml_chars: runtimeYamlChars, system_prompt_chars: systemPromptChars, user_prompt_chars: userPromptChars };

      // 协议规定 current_team 必须出现在发给 AI 的 prompt 里,否则 AI 拿不到队员姓名/属性/职业/种族/性格
      // (典型表现:剧情里不出现卡牌名,卡牌特性不进叙事,检定无法执行)
      // 顶层 current_team 已自动注入 runtime_yaml;这里仅做诊断,缺了就打 warning
      const currentTeamSource = prepared.currentTeamSource ?? "missing";
      if (currentTeamSource === "missing") {
        console.warn(JSON.stringify({
          component: "adventure-chat",
          event: "current_team_missing",
          request_id: prepared.requestId,
          operation: prepared.operationType,
          hint: "请确认前端在请求里传了 current_team(顶层数组或 runtime_yaml 内的 current_team: 块),否则 AI 无法感知上阵卡牌"
        }));
      } else {
        const teamCount = Array.isArray(prepared.currentTeam) ? prepared.currentTeam.length : (userPromptChars > 0 ? 1 : 0);
        console.info(JSON.stringify({
          component: "adventure-chat",
          event: "current_team_present",
          request_id: prepared.requestId,
          source: currentTeamSource,
          member_count: teamCount
        }));
      }

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

      // 调试追踪:记录完整 prompt 和 AI 输出
      const trace = aiDebugger.start({
        requestId: prepared.requestId,
        operation: prepared.operationType,
        clientIp: clientIp(req),
        model: config.aiModel,
        maxTokens: config.maxCompletionTokens,
        messages: prepared.messages,
        runtimeYaml: input.runtime_yaml
      });

      let streamMetrics;
      try {
        let forwardedChars = 0;
        for await (const delta of modelService.stream(prepared.messages, {
          signal: controller.signal,
          onMetrics: metrics => { streamMetrics = metrics; }
        })) {
          aiDebugger.appendDelta(trace, delta);
          writeSseData(res, delta);
          forwardedChars += delta.length;
        }
        const summary = { forwarded_chars: forwardedChars, ...(streamMetrics || {}) };
        if (controller.signal.aborted) {
          idempotency.update(prepared.requestId, { status: "cancelled" });
          log("stream_cancelled", summary);
          await aiDebugger.finish(trace, { status: "cancelled", metrics: streamMetrics });
          return;
        }
        idempotency.update(prepared.requestId, { status: "completed" });
        writeSseDone(res);
        log("stream_completed", summary);
        await aiDebugger.finish(trace, { status: "completed", metrics: streamMetrics });
      } catch (error) {
        const payload = { code: error.code || "UPSTREAM_ERROR", message: error.message };
        if (error.details !== undefined) payload.details = error.details;
        idempotency.update(prepared.requestId, { status: error.code === "CLIENT_ABORTED" ? "cancelled" : "failed", error: payload });
        log("stream_failed", { code: payload.code, ...(streamMetrics || {}) });
        if (!controller.signal.aborted && !res.writableEnded) writeSseError(res, payload);
        await aiDebugger.finish(trace, { status: error.code === "CLIENT_ABORTED" ? "cancelled" : "failed", error, metrics: streamMetrics });
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
    if (req.method === "GET" && req.url === "/api/apk") {
      sendJson(res, 200, {
        url: config.apkUrl,
        version: config.apkVersion
      }, config, origin);
      return;
    }
    if (req.url === "/api/chat") {
      await handleChat(req, res, origin);
      return;
    }
    sendError(res, 404, "NOT_FOUND", "未找到请求的端点", config, origin);
  };
}
