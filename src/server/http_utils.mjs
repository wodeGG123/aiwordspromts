import { CONTRACTS, TEMPLATES } from "./constants.mjs";

export function corsHeaders(config, requestOrigin) {
  const allowOrigin = config.clientOrigins.includes("*")
    ? "*"
    : (requestOrigin && config.clientOrigins.includes(requestOrigin) ? requestOrigin : undefined);
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
    Vary: "Origin"
  };
}

export function sendJson(res, status, payload, config, origin) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(config, origin)
  });
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, code, message, config, origin, details, requestId) {
  const error = { code, message, type: status >= 500 ? "server_error" : "request_error" };
  if (details !== undefined) error.details = details;
  if (requestId) error.request_id = requestId;
  sendJson(res, status, { error }, config, origin);
}

export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const error = new Error("request body too large");
        error.code = "REQUEST_TOO_LARGE";
        fail(error);
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(body);
        settled = true;
        resolve(parsed);
      } catch {
        const error = new Error("请求体不是合法JSON");
        error.code = "INVALID_JSON";
        fail(error);
      }
    });
    req.on("error", fail);
  });
}

export function writeSseHeaders(res, config, origin) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...corsHeaders(config, origin)
  });
}

export function writeSseData(res, text) {
  if (res.writableEnded) return;
  for (const line of String(text).split(/\r?\n/)) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

export function writeSseDone(res) {
  if (!res.writableEnded) res.write("data: [DONE]\n\n");
}

export function writeSseError(res, payload) {
  if (!res.writableEnded) res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function healthPayload() {
  return {
    status: "ok",
    service: "adventure-api",
    contracts: CONTRACTS
  };
}

export function capabilitiesPayload(config) {
  return {
    contracts: CONTRACTS,
    dungeons: [{ id: "dungeon1.corrupted-demon-king.runtime", version: "2026.09.04.1" }],
    templates: TEMPLATES,
    provider_chunk_mode: "delta_text",
    limits: {
      max_runtime_yaml_chars: config.runtimeMaxChars,
      max_request_bytes: config.requestMaxBytes,
      max_output_chars: config.outputMaxChars,
      max_concurrent_per_ip: config.maxConcurrentPerIp
    }
  };
}
