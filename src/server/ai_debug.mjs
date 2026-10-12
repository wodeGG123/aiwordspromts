// AI 调试追踪器:把每次 AI 调用的"入参 + 出参"全量落盘,默认关闭。
//
// 用途:
//   - AI 返回不准确时,人工对照 prompt 和 response 排查
//   - 统计 token / 时延 / 失败率
//
// 启用方式(环境变量):
//   - dev 模式(NODE_ENV !== "production"):默认开启
//   - prod 模式:默认关闭
//   - 显式 AI_DEBUG_TRACE=true / false 可覆盖默认
//   AI_DEBUG_LOG_DIR=./logs/ai-trace   (可选,默认 ./logs/ai-trace)
//   AI_DEBUG_LOG_MAX_AGE_DAYS=7        (可选,默认 7;超过这个天数的文件会在写入新文件时自动清理)
//
// 输出文件:
//   <logDir>/<sanitized_requestId>__<startedAtMs>.json
//   一个请求一个文件,失败/取消/正常完成都会写。

import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

const MAX_PREVIEW_CHARS = 500;

function sanitizeId(value) {
  // requestId 来自客户端,要防止路径穿越
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.\-]/g, "_").slice(0, 80);
}

function preview(text) {
  if (text.length <= MAX_PREVIEW_CHARS * 2 + 20) return text;
  return `${text.slice(0, MAX_PREVIEW_CHARS)}\n\n... [省略 ${text.length - MAX_PREVIEW_CHARS * 2} 字符] ...\n\n${text.slice(-MAX_PREVIEW_CHARS)}`;
}

// 简单过期清理:删除 mtime 早于 cutoff 的文件
// 走异步、不阻塞主流程
async function purgeExpiredFiles(dir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return { scanned: 0, deleted: 0, error: "readdir_failed" };
  }
  let deleted = 0;
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const filePath = join(dir, name);
    try {
      const info = await stat(filePath);
      if (info.mtimeMs < cutoff) {
        await unlink(filePath);
        deleted += 1;
      }
    } catch {
      // 单个文件出错不影响整体
    }
  }
  return { scanned: entries.length, deleted };
}

export function createAiDebugger({ enabled, logDir, maxAgeDays = 7 } = {}) {
  if (!enabled) {
    // 关闭时所有方法都是空操作,几乎零开销
    return {
      enabled: false,
      dir: null,
      start: () => null,
      appendDelta: () => {},
      finish: () => {}
    };
  }

  const dir = resolve(logDir || "./logs/ai-trace");
  let lastPurgeAt = 0;
  const PURGE_INTERVAL_MS = 60 * 60 * 1000; // 最多 1 小时跑一次清理

  return {
    enabled: true,
    dir,
    maxAgeDays,

    // 在调用 AI 前调用,返回一个 trace 句柄
    start({ requestId, operation, clientIp, model, maxTokens, messages, runtimeYaml }) {
      const trace = {
        request_id: requestId,
        operation: operation || null,
        client_ip: clientIp || null,
        model,
        max_tokens: maxTokens,
        started_at: new Date().toISOString(),
        started_at_ms: Date.now(),
        // 完整 prompt(给 AI 看的那份)
        ai_request: {
          messages: messages || [],
          messages_count: Array.isArray(messages) ? messages.length : 0,
          // 原始 runtime_yaml 和 operation 也保留,方便对比"组装前后"是否一致
          runtime_yaml: typeof runtimeYaml === "string" ? runtimeYaml : null,
          runtime_yaml_chars: typeof runtimeYaml === "string" ? runtimeYaml.length : 0
        },
        // AI 增量返回会累积到这里
        ai_response: {
          output: "",
          delta_count: 0
        }
      };
      return trace;
    },

    // 每收到一个 delta 调一次(很频繁,但只做字符串拼接)
    appendDelta(trace, delta) {
      if (!trace) return;
      trace.ai_response.output += delta;
      trace.ai_response.delta_count += 1;
    },

    // 调用结束(成功 / 取消 / 失败都要调)
    async finish(trace, { status, error, metrics } = {}) {
      if (!trace) return;
      try {
        const finishedAtMs = Date.now();
        trace.finished_at = new Date(finishedAtMs).toISOString();
        trace.duration_ms = finishedAtMs - trace.started_at_ms;
        trace.status = status || "unknown";
        trace.metrics = metrics || null;
        if (error) {
          trace.error = {
            code: error.code || "UNKNOWN",
            message: error.message || String(error)
          };
        }
        trace.ai_response.output_chars = trace.ai_response.output.length;
        trace.ai_response.output_preview = preview(trace.ai_response.output);

        await mkdir(dir, { recursive: true });
        const fileName = `${sanitizeId(trace.request_id)}__${trace.started_at_ms}.json`;
        const filePath = resolve(dir, fileName);
        await writeFile(filePath, JSON.stringify(trace, null, 2), "utf8");

        // 控制台打一行索引(便于检索)
        console.info(JSON.stringify({
          component: "ai-trace",
          event: "trace_written",
          request_id: trace.request_id,
          operation: trace.operation,
          status: trace.status,
          duration_ms: trace.duration_ms,
          input_chars: trace.ai_request.runtime_yaml_chars,
          output_chars: trace.ai_response.output_chars,
          log_file: filePath
        }));

        // 异步清理过期文件(节流:每 PURGE_INTERVAL_MS 最多一次)
        const now = Date.now();
        if (now - lastPurgeAt > PURGE_INTERVAL_MS) {
          lastPurgeAt = now;
          purgeExpiredFiles(dir, maxAgeDays).then(result => {
            if (result.deleted > 0) {
              console.info(JSON.stringify({
                component: "ai-trace",
                event: "purged_expired",
                dir,
                max_age_days: maxAgeDays,
                deleted: result.deleted,
                scanned: result.scanned
              }));
            }
          }).catch(() => { /* 静默:清理失败不影响主流程 */ });
        }
      } catch (writeError) {
        // 写文件失败不要影响主流程
        console.error(`[ai-trace] failed to write trace file: ${writeError.message}`);
      }
    }
  };
}

