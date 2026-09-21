import "dotenv/config";
import http from "node:http";
import { loadConfig } from "./server/config.mjs";
import { createApp } from "./server/routes.mjs";
import { createProxyServer } from "./server/proxy_server.mjs";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[config] ${error.message}`);
  process.exit(1);
}

const app = createApp({ config });
const server = http.createServer((req, res) => {
  app(req, res).catch(error => {
    console.error(`[server] ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误", type: "server_error" } }));
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});

let proxyServer = null;
if (config.proxyEnabled) {
  proxyServer = createProxyServer({
    target: config.proxyTarget,
    label: "proxy",
    allowAllCors: true
  });
}

const servers = [server, proxyServer].filter(Boolean);
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] shutting down (${signal})`);
  let remaining = servers.length;
  const onClosed = error => {
    if (error) console.error(`[server] shutdown failed: ${error.message}`);
    remaining -= 1;
    if (remaining === 0) {
      if (servers.some((_, idx) => errors[idx])) process.exitCode = 1;
      process.exit();
    }
  };
  const errors = [];
  servers.forEach(srv => {
    try {
      srv.close(onClosed);
    } catch (error) {
      errors.push(error);
      onClosed(error);
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

server.listen(config.port, () => {
  console.log(`[server] adventure API listening on http://localhost:${config.port}`);
  console.log(`[server] model=${config.aiModel}`);
  console.log(`[server] cors=${config.clientOrigins.join(",")}`);
});

server.on("error", error => {
  console.error(`[server] ${error.message}`);
  process.exit(1);
});

if (proxyServer) {
  proxyServer.listen(config.proxyPort, () => {
    console.log(`[proxy] forwarding CORS-enabled traffic on http://localhost:${config.proxyPort} -> ${config.proxyTarget}`);
  });
  proxyServer.on("error", error => {
    console.error(`[proxy] ${error.message}`);
    process.exit(1);
  });
}

export { server, proxyServer };
