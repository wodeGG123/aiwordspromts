import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

// hop-by-hop 头不应该透传到上游，也不要回写到客户端
// host 是 hop-by-hop，但必须转发给上游才能让目标服务器正确路由和 TLS 校验
// connection / keep-alive / upgrade 这几个才是真正需要去掉的 hop-by-hop
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length"
]);

// 这些响应头由本代理重新生成，不能直接回传
const OVERRIDE_RESPONSE_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-allow-credentials",
  "access-control-expose-headers",
  "vary"
]);

function corsHeaders(requestOrigin, allowAll = false) {
  return {
    "Access-Control-Allow-Origin": allowAll ? "*" : (requestOrigin || "*"),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Requested-With, Accept, Origin",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function filterRequestHeaders(headers, upstreamHostname) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === "host") {
      out["Host"] = upstreamHostname;
      continue;
    }
    out[key] = value;
  }
  if (!out["Host"]) out["Host"] = upstreamHostname;
  return out;
}

function filterResponseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (OVERRIDE_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

export function buildProxyHandler({ target, label = "proxy", allowAllCors = true }) {
  const targetUrl = new URL(target);

  return async function handle(req, res) {
    const origin = req.headers.origin;

    // 处理 CORS 预检
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(origin, allowAllCors));
      res.end();
      return;
    }

    const targetPath = req.url.startsWith("/") ? req.url : `/${req.url}`;
    const upstreamPath = targetUrl.pathname.replace(/\/$/, "") + targetPath;
    const upstreamUrl = `${targetUrl.protocol}//${targetUrl.host}${upstreamPath}`;
    const upstreamHeaders = filterRequestHeaders(req.headers, targetUrl.hostname);

    console.log(`[${label}] ${req.method} ${req.url} -> ${upstreamUrl}`);
    console.log(`[${label}] upstream headers:`, JSON.stringify(upstreamHeaders));

    // 读取请求 body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    try {
      // 使用 Node.js 原生 fetch（Node 18+ 内置，无需 undici）
      const upstreamRes = await fetch(upstreamUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body,
        // 禁用自动重定向，由代理透明转发
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });

      const responseHeaders = filterResponseHeaders(
        Object.fromEntries(upstreamRes.headers.entries())
      );

      const clientHeaders = {
        ...responseHeaders,
        ...corsHeaders(origin, allowAllCors)
      };

      res.writeHead(upstreamRes.status, clientHeaders);

      // 透明转发响应体
      if (upstreamRes.body) {
        for await (const chunk of upstreamRes.body) {
          res.write(chunk);
        }
      }
      res.end();

    } catch (error) {
      const code = error.cause?.code || "";
      const reason =
        code === "ECONNREFUSED"        ? "上游拒绝连接（服务未启动或端口不对）" :
        code === "ENOTFOUND"           ? "DNS 解析失败（域名不存在或网络不通）" :
        code === "ETIMEDOUT"           ? "连接超时（网络问题或上游响应过慢）" :
        code === "ECONNRESET"          ? "上游重置了连接（可能被反爬拦截）" :
        code === "EPIPE"               ? "写入管道破裂（上游提前关闭了连接）" :
        `未知错误 code=${code} message=${error.message}`;

      console.error(`[${label}] fetch error: ${reason} (${error.message})`);

      const statusCode =
        code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "ECONNRESET" ? 502 :
        502;

      if (!res.headersSent) {
        res.writeHead(statusCode, {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(origin, allowAllCors)
        });
        res.end(JSON.stringify({
          error: {
            code: "UPSTREAM_UNREACHABLE",
            message: reason,
            detail: error.message,
            type: "server_error"
          }
        }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };
}

export function createProxyServer(options) {
  return http.createServer(buildProxyHandler(options));
}
