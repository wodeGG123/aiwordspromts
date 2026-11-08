import OpenAI from "openai";
import { preparePromptFromRequest, RuntimeContractError } from "../runtime_contract.mjs";
import {
  advanceV3,
  parseV3Output,
  prepareV3Prompt,
  transitionV3,
  V3ContractError,
  V3OutputError
} from "../engine/v3_adapter.mjs";
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
  writeSseEvent,
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

// v3 请求体带 adventure 字段；旧通道用 runtime_yaml 字符串。
function isV3Request(input) {
  return Boolean(input && input.adventure !== undefined);
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

  // ── v3 控制通道：纯状态迁移，不请求模型 ──────────────────────────
  async function handleAdventureTransition(req, res, origin) {
    if (req.method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "请使用POST方法", config, origin);
      return;
    }

    let release;
    try {
      limiter.check(clientIp(req));
      release = beginRequest(clientIp(req));
      const input = await readJsonBody(req, config.requestMaxBytes);
      const result = transitionV3(input);
      console.info(JSON.stringify({
        component: "adventure-transition",
        event: "transition_completed",
        action: input?.action,
        revision: result.adventure?.revision,
        chapter_id: result.adventure?.runtime?.chapter_id ?? null,
        campaign_status: result.adventure?.campaign?.status ?? null
      }));
      sendJson(res, 200, result, config, origin);
    } catch (error) {
      const status = error.code === "REQUEST_TOO_LARGE"
        ? 413
        : error.code === "RATE_LIMITED" || error.code === "CONCURRENT_LIMITED"
          ? 429
          : 400;
      console.warn(JSON.stringify({
        component: "adventure-transition",
        event: "transition_rejected",
        code: error.code || "TRANSITION_FAILED",
        message: error.message
      }));
      sendError(res, status, error.code || "TRANSITION_FAILED", error.message, config, origin, error.details);
    } finally {
      release?.();
    }
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

      const v3 = isV3Request(input);

      let prepared;
      const promptAssemblyStartedAt = Date.now();
      try {
        if (v3) {
          prepared = prepareV3Prompt(input);
        } else {
          if (input?.runtime_yaml?.length > config.runtimeMaxChars) {
            throw Object.assign(new Error("runtime_yaml超过长度限制"), { code: "RUNTIME_TOO_LARGE" });
          }
          prepared = preparePromptFromRequest(input, {
            blacklist: config.enablePromptFilter ? config.promptBlacklist : null
          });
        }
      } catch (error) {
        const status = error.code === "RUNTIME_TOO_LARGE"
          ? 413
          : error instanceof V3ContractError || error instanceof RuntimeContractError
            ? 400
            : 500;
        console.warn(JSON.stringify({
          component: v3 ? "adventure-chat-v3" : "adventure-chat",
          event: "request_rejected",
          request_id: requestId,
          operation: input?.operation?.type,
          code: error.code || "PROMPT_ASSEMBLY_FAILED",
          message: error.message,
          details: error.details
        }));
        sendError(res, status, error.code || "PROMPT_ASSEMBLY_FAILED", error.message, config, origin, error.details, requestId);
        return;
      }
      promptAssemblyMs = Date.now() - promptAssemblyStartedAt;
      if (!v3 && Array.isArray(prepared.assetFindings) && prepared.assetFindings.length > 0) {
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
      requestMetrics = {
        request_body_ms: requestBodyMs,
        prompt_assembly_ms: promptAssemblyMs,
        runtime_yaml_chars: runtimeYamlChars,
        system_prompt_chars: systemPromptChars,
        user_prompt_chars: userPromptChars
      };

      // 旧通道的诊断：协议规定 current_team 必须出现在发给 AI 的 prompt 里。
      if (!v3) {
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
      }

      // v3 的幂等指纹取自存档游标；旧通道取 runtime_yaml 摘要。
      const fingerprint = v3
        ? hashRequest(prepared.fingerprintSource)
        : hashRequest({ runtime_yaml: input.runtime_yaml, operation: input.operation, state_version: input.state_version });
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
        component: v3 ? "adventure-chat-v3" : "adventure-chat",
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
        runtimeYaml: v3 ? prepared.userPrompt : input.runtime_yaml
      });

      let streamMetrics;
      try {
        let forwardedChars = 0;
        // v3 需要在流结束后用完整 YAML 做权威校验，因此必须累积原始文本。
        const rawChunks = [];
        for await (const delta of modelService.stream(prepared.messages, {
          signal: controller.signal,
          onMetrics: metrics => { streamMetrics = metrics; }
        })) {
          aiDebugger.appendDelta(trace, delta);
          writeSseData(res, delta);
          if (v3) rawChunks.push(delta);
          forwardedChars += delta.length;
        }
        const summary = { forwarded_chars: forwardedChars, ...(streamMetrics || {}) };
        if (controller.signal.aborted) {
          idempotency.update(prepared.requestId, { status: "cancelled" });
          log("stream_cancelled", summary);
          await aiDebugger.finish(trace, { status: "cancelled", metrics: streamMetrics });
          return;
        }

        if (v3) {
          // ── 服务端权威校验 + 状态推进 ──────────────────────────
          // ⚠️ 校验失败绝不推进任何状态；客户端保留原存档并可重试。
          const rawYaml = rawChunks.join("");
          let aiOutput;
          try {
            aiOutput = parseV3Output(rawYaml, input.operation);
          } catch (error) {
            idempotency.update(prepared.requestId, {
              status: "failed",
              error: { code: error.code, message: error.message }
            });
            log("output_rejected", { code: error.code, reason: error.message });
            writeSseError(res, {
              code: error.code || "V3_OUTPUT_INVALID",
              message: error.message,
              ...(error.details ? { details: error.details } : {})
            });
            await aiDebugger.finish(trace, { status: "failed", error, metrics: streamMetrics });
            return;
          }

          let advanced;
          try {
            advanced = advanceV3(prepared.premigratedAdventure, input.operation, aiOutput);
          } catch (error) {
            idempotency.update(prepared.requestId, {
              status: "failed",
              error: { code: error.code || "V3_ADVANCE_FAILED", message: error.message }
            });
            log("advance_failed", { code: error.code, reason: error.message });
            writeSseError(res, {
              code: error.code || "V3_ADVANCE_FAILED",
              message: error.message
            });
            await aiDebugger.finish(trace, { status: "failed", error, metrics: streamMetrics });
            return;
          }

          // 状态事件必须先于 [DONE]，客户端据此落盘新存档。
          writeSseEvent(res, "state", JSON.stringify({
            adventure: advanced.adventure,
            state_version: advanced.adventure?.runtime?.state_version ?? null,
            revision: advanced.adventure?.revision ?? null,
            request_guard: prepared.requestGuard,
            changed: advanced.changed
          }));
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
    if (req.url === "/api/adventure/transition") {
      await handleAdventureTransition(req, res, origin);
      return;
    }
    sendError(res, 404, "NOT_FOUND", "未找到请求的端点", config, origin);
  };
}
