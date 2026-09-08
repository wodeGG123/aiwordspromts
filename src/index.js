import "dotenv/config";
import http from "http";
import { loadConfig } from "./server/config.mjs";
import { createApp } from "./server/routes.mjs";

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

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] shutting down (${signal})`);
  server.close(error => {
    if (error) {
      console.error(`[server] shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
    process.exit();
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

export { server };
