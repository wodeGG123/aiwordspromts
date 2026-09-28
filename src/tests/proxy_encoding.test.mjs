import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { buildProxyHandler } from "../server/proxy_server.mjs";

/// 起一个假上游：正常回 JSON，但对 /api/v1/artifacts/ 回 gzip 压缩的大列表，
/// 复现真实上游「超过压缩阈值才压缩」的行为。
function startFakeUpstream() {
  const payload = JSON.stringify({ artifacts: Array.from({ length: 60 }, (_, i) => ({ artifact_uid: `a${i}`, name: "圣物" })) });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/v1/artifacts/")) {
      const gzipped = zlib.gzipSync(Buffer.from(payload, "utf8"));
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Content-Length": String(gzipped.length)
      });
      res.end(gzipped);
      return;
    }
    const small = Buffer.from(JSON.stringify({ ok: true }), "utf8");
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(small.length) });
    res.end(small);
  });
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve({ server, target: `http://127.0.0.1:${server.address().port}` }))
  );
}

function startProxy(target) {
  const handler = buildProxyHandler({ target, label: "test", allowAllCors: true });
  const server = http.createServer((req, res) => handler(req, res));
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  );
}

function get(base, path, { acceptEncoding = "gzip, deflate, br" } = {}) {
  return fetch(`${base}${path}`, { headers: { "Accept-Encoding": acceptEncoding } }).then(async res => ({
    status: res.status,
    contentEncoding: res.headers.get("content-encoding"),
    text: await res.text()
  }));
}

describe("proxy 内容编码透传", () => {
  it("上游 gzip 响应经代理后不再声明 content-encoding，浏览器可正常解码", async () => {
    const upstream = await startFakeUpstream();
    const proxy = await startProxy(upstream.target);
    try {
      const res = await get(proxy.base, "/api/v1/artifacts/?page=1&page_size=100");

      assert.equal(res.status, 200);
      // undici 已解压，代理转发的是明文，因此绝不能再带 content-encoding
      assert.equal(res.contentEncoding, null, "代理不得回传 content-encoding");
      // 能被读成 JSON，说明客户端拿到的字节与标头一致
      const parsed = JSON.parse(res.text);
      assert.equal(parsed.artifacts.length, 60);
    } finally {
      await new Promise(r => proxy.server.close(r));
      await new Promise(r => upstream.server.close(r));
    }
  });

  it("未压缩的小响应同样透传且内容不变", async () => {
    const upstream = await startFakeUpstream();
    const proxy = await startProxy(upstream.target);
    try {
      const res = await get(proxy.base, "/api/v1/user-system");
      assert.equal(res.status, 200);
      assert.equal(res.contentEncoding, null);
      assert.deepEqual(JSON.parse(res.text), { ok: true });
    } finally {
      await new Promise(r => proxy.server.close(r));
      await new Promise(r => upstream.server.close(r));
    }
  });

  it("客户端声明 identity 时上游不压缩，代理照常透传", async () => {
    const upstream = await startFakeUpstream();
    const proxy = await startProxy(upstream.target);
    try {
      const res = await get(proxy.base, "/api/v1/artifacts/?page=1", { acceptEncoding: "identity" });
      assert.equal(res.status, 200);
      assert.equal(res.contentEncoding, null);
      assert.equal(JSON.parse(res.text).artifacts.length, 60);
    } finally {
      await new Promise(r => proxy.server.close(r));
      await new Promise(r => upstream.server.close(r));
    }
  });
});
