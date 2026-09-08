import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig } from "../server/config.mjs";
import { createApp } from "../server/routes.mjs";
import { validateRequest } from "../runtime_contract.mjs";

function validRequest(overrides = {}) {
  return {
    runtime_yaml: "template: 新一轮事件\nuser_input: test",
    operation: { type: "start", request_id: "req-test-001", expected_template_name: "新一轮事件" },
    state_version: 0,
    current_round: 1,
    current_scene_id: "scene_village",
    event_context: {
      event_package_version: "dungeon-event-yaml-v1",
      dungeon_package_version: "2026.09.04.1",
      event_id: "M01",
      candidate_event_ids: ["M01"],
      forced_event_id: "M01",
      npc_names: ["村长艾德", "史莱姆"],
      scene_ids: ["scene_village"],
      scene_names: ["艾德村庄"],
      template_contract: "five-template-v3"
    },
    story_state: {
      completed_events: [], story_flags: [], route_scores: { combat: 0, scheme: 0, cleanse: 0 },
      current_scene_id: "scene_village", visited_scene_ids: [], npc_states: [], unresolved_hooks: [],
      memory_notes: [], recent_event_ids: [], run_archetype: "balanced", run_modifier_ids: ["A", "B"]
    },
    ...overrides
  };
}

function startTestServer({ chunks = ["event_details:\n  template_name: \"新一轮事件\"\n"], client, configOverrides = {} } = {}) {
  const config = loadConfig({ NODE_ENV: "test", AI_API_KEY: "test-key", AI_MODEL: "test-model", CLIENT_ORIGINS: "http://client.test", ...configOverrides });
  const modelClient = client || { chat: { completions: { create: async function* () { for (const content of chunks) yield { choices: [{ delta: { content } }] }; } } } };
  const app = createApp({ config, modelClient });
  const server = http.createServer((req, res) => app(req, res));
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function close(server) { await new Promise(resolve => server.close(resolve)); }

async function readResponse(response) {
  return await response.text();
}

describe("server config", () => {
  it("accepts published event package version from client payload", () => {
    const request = validRequest({
      event_context: {
        event_package_version: "2026.09.04.1",
        template_contract_version: "five-template-v3",
        candidate_event_ids: ["M01"],
        forced_event_id: "M01",
        associated_roles: [
          { id: "200000129", name: "村长艾德" },
          { id: "200000130", name: "史莱姆" },
          { id: "290000011", name: "重甲守卫" }
        ],
        associated_scenes: [{ id: "scene_village", name: "艾德村庄" }]
      }
    });
    const normalized = validateRequest(request);
    assert.equal(normalized.eventContext.event_id, "M01");
  });
  it("derives a choose event from the committed pending interaction", () => {
    const request = validRequest({
      operation: { type: "choose", request_id: "req-choose-pending", expected_template_name: "检定" },
      pending_interaction: { event_id: "M01", scene_id: "scene_village" },
      event_context: {
        event_package_version: "2026.09.04.1",
        template_contract_version: "five-template-v3",
        candidate_event_ids: ["M01"],
        associated_roles: [
          { id: "200000129", name: "村长艾德" },
          { id: "200000130", name: "史莱姆" }
        ],
        associated_scenes: [{ id: "scene_village", name: "艾德村庄" }]
      }
    });
    const normalized = validateRequest(request);
    assert.equal(normalized.eventContext.event_id, "M01");
  });
  it("normalizes display scene names before prompt assembly", () => {
    const request = validRequest({
      current_scene_id: "艾德村庄",
      story_state: {
        ...validRequest().story_state,
        current_scene_id: "艾德村庄",
        visited_scene_ids: ["艾德村庄"]
      },
      event_context: {
        ...validRequest().event_context,
        associated_scenes: [{ id: "scene_village", name: "艾德村庄" }]
      }
    });
    const normalized = validateRequest(request);
    assert.equal(normalized.currentSceneId, "scene_village");
    assert.equal(normalized.storyState.current_scene_id, "scene_village");
    assert.deepEqual(normalized.storyState.visited_scene_ids, ["scene_village"]);
  });
  it("accepts multiple next-round candidates without a selected event", () => {
    const request = validRequest({
      operation: { type: "next_round", request_id: "req-round-two-many", expected_template_name: "新一轮事件" },
      current_round: 2,
      story_state: {
        ...validRequest().story_state,
        completed_events: ["M01"]
      },
      event_context: {
        event_package_version: "2026.09.04.1",
        template_contract_version: "five-template-v3",
        candidate_event_ids: ["R_P1_FLOODED_CHAPEL", "R_P1_TRAPPED_SCOUT"],
        associated_roles: [
          { id: "200000189", name: "主教劳伦斯" },
          { id: "200000208", name: "苔藓古卫" },
          { id: "200000130", name: "史莱姆" }
        ],
        associated_scenes: [
          { id: "scene_village", name: "艾德村庄" },
          { id: "scene_forest", name: "幽暗森林" },
          { id: "scene_church", name: "神圣教堂" }
        ]
      }
    });
    const normalized = validateRequest(request);
    assert.equal(normalized.eventContext.event_id, undefined);
    assert.deepEqual(normalized.eventContext.candidate_event_ids, ["R_P1_FLOODED_CHAPEL", "R_P1_TRAPPED_SCOUT"]);
  });
  it("uses the sole next-round candidate when forced_event_id is omitted", () => {
    const base = validRequest();
    const request = validRequest({
      operation: { type: "next_round", request_id: "req-round-two", expected_template_name: "新一轮事件" },
      current_round: 2,
      event_context: {
        ...base.event_context,
        event_id: undefined,
        forced_event_id: undefined,
        candidate_event_ids: ["R_P1_FLOODED_CHAPEL"],
        npc_names: ["主教劳伦斯", "祭司索菲亚", "毒藤母体"],
        scene_ids: ["scene_village", "scene_forest", "scene_church"]
      }
    });
    const normalized = validateRequest(request);
    assert.equal(normalized.eventContext.event_id, "R_P1_FLOODED_CHAPEL");
  });
});

describe("server routes", () => {
  it("returns health and capabilities", async () => {
    const { server, base } = await startTestServer();
    try {
      const health = await fetch(`${base}/health`);
      const capabilities = await fetch(`${base}/api/capabilities`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).contracts.runtime, "adventure-runtime-v4");
      assert.equal(capabilities.status, 200);
      assert.deepEqual((await capabilities.json()).templates, ["新一轮事件", "战斗事件", "检定", "结算", "终章"]);
    } finally { await close(server); }
  });

  it("returns CORS headers only for approved origins", async () => {
    const { server, base } = await startTestServer();
    try {
      const approved = await fetch(`${base}/health`, { headers: { Origin: "http://client.test" } });
      const rejected = await fetch(`${base}/health`, { headers: { Origin: "https://untrusted.example" } });
      assert.equal(approved.headers.get("access-control-allow-origin"), "http://client.test");
      assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    } finally { await close(server); }
  });

  it("passes separate system and user messages to the model", async () => {
    let received;
    const client = { chat: { completions: { create: async function* (request) {
      received = request;
      yield { choices: [{ delta: { content: "event_details:\n  template_name: \"新一轮事件\"\n" } }] };
    } } } };
    const { server, base } = await startTestServer({ client });
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRequest({ operation: { type: "start", request_id: "req-message-shape", expected_template_name: "新一轮事件" } }))
      });
      await response.text();
      assert.equal(response.status, 200);
      assert.equal(received.messages.length, 2);
      assert.equal(received.messages[0].role, "system");
      assert.equal(received.messages[1].role, "user");
      assert.match(received.messages[0].content, /#通用引擎/);
      assert.match(received.messages[1].content, /#本次程序运行态输入/);
    } finally { await close(server); }
  });

  it("streams deltas and one DONE frame", async () => {
    const { server, base } = await startTestServer({ chunks: ["event_details:\n  template_name: ", "\"新一轮事件\"\n"] });
    try {
      const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://client.test", "Idempotency-Key": "req-test-001" }, body: JSON.stringify(validRequest()) });
      const text = await readResponse(response);
      assert.equal(response.status, 200);
      assert.equal((text.match(/data: \[DONE\]/g) || []).length, 1);
      assert.match(text, /data: event_details:/);
    } finally { await close(server); }
  });

  it("encodes YAML newlines as legal SSE data lines", async () => {
    const { server, base } = await startTestServer({ chunks: ["event_details:\n  template_name: ", "\"新一轮事件\"\n"] });
    try {
      const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://client.test", "Idempotency-Key": "req-test-001" }, body: JSON.stringify(validRequest()) });
      const text = await readResponse(response);
      assert.equal(response.status, 200);
      assert.equal(
        text,
        'data: event_details:\ndata:   template_name: "新一轮事件"\ndata: \n\n' +
          'data: [DONE]\n\n',
      );
    } finally { await close(server); }
  });

  it("rejects client model override and invalid JSON", async () => {
    const { server, base } = await startTestServer();
    try {
      const override = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validRequest({ model: "other" })) });
      assert.equal(override.status, 400);
      assert.equal((await override.json()).error.code, "MODEL_OVERRIDE_NOT_ALLOWED");
      const invalid = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, "INVALID_JSON");
    } finally { await close(server); }
  });

  it("模板不匹配时重试，并只发送最终匹配模板", async () => {
    let calls = 0;
    const client = { chat: { completions: { create: async function* () {
      calls += 1;
      const template = calls === 1 ? "战斗事件" : "检定";
      yield { choices: [{ delta: { content: `event_details:\n  template_name: "${template}"\n` } }] };
    } } } };
    const { server, base } = await startTestServer({ client });
    try {
      const request = validRequest({
        operation: { type: "choose", request_id: "req-template-retry", expected_template_name: "检定" },
        pending_interaction: { event_id: "M01", scene_id: "scene_village" }
      });
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://client.test" },
        body: JSON.stringify(request)
      });
      const text = await readResponse(response);
      assert.equal(response.status, 200);
      assert.equal(calls, 2);
      assert.match(text, /template_name: "检定"/);
      assert.doesNotMatch(text, /template_name: "战斗事件"/);
      assert.equal((text.match(/data: \[DONE\]/g) || []).length, 1);
    } finally { await close(server); }
  });

  it("模板重试耗尽时返回可诊断的模板错误", async () => {
    let calls = 0;
    const client = { chat: { completions: { create: async function* () {
      calls += 1;
      yield { choices: [{ delta: { content: "event_details:\n  template_name: \"战斗事件\"\n" } }] };
    } } } };
    const { server, base } = await startTestServer({ client, configOverrides: { AI_TEMPLATE_RETRY_LIMIT: "1" } });
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://client.test" },
        body: JSON.stringify(validRequest({
          operation: { type: "choose", request_id: "req-template-failed", expected_template_name: "检定" },
          pending_interaction: { event_id: "M01", scene_id: "scene_village" }
        }))
      });
      const text = await readResponse(response);
      assert.equal(response.status, 200);
      assert.equal(calls, 2);
      assert.match(text, /event: error/);
      const errorLine = text.split("\n").find(line => line.startsWith("data: {") && line.includes("SCHEMA_TEMPLATE_MISMATCH"));
      assert.ok(errorLine);
      const payload = JSON.parse(errorLine.slice("data: ".length));
      assert.equal(payload.code, "SCHEMA_TEMPLATE_MISMATCH");
      assert.deepEqual(payload.details, {
        expected_template_name: "检定",
        actual_template_name: "战斗事件",
        attempts: 2
      });
    } finally { await close(server); }
  });
  it("does not call model twice for the same request snapshot", async () => {
    let calls = 0;
    const client = { chat: { completions: { create: async function* () { calls += 1; yield { choices: [{ delta: { content: "event_details:\n  template_name: \"新一轮事件\"\n" } }] }; } } } };
    const { server, base } = await startTestServer({ client });
    try {
      const body = JSON.stringify(validRequest());
      const headers = { "Content-Type": "application/json", "Idempotency-Key": "req-test-001" };
      const first = await fetch(`${base}/api/chat`, { method: "POST", headers, body });
      await first.text();
      const second = await fetch(`${base}/api/chat`, { method: "POST", headers, body });
      const text = await second.text();
      assert.equal(calls, 1);
      assert.equal((text.match(/data: \[DONE\]/g) || []).length, 1);
    } finally { await close(server); }
  });
});
