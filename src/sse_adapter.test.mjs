/**
 * 流式接口集成测试
 * 
 * 测试目标：
 * 1. SSE 事件解析
 * 2. 适配器连接逻辑
 * 3. 文本累积器
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { createSseEventDecoder, createTextAccumulator } from "./sse_adapter.mjs";

// ---------------------------------------------------------------------------
// 测试：createTextAccumulator
// ---------------------------------------------------------------------------

describe("createTextAccumulator", () => {
  it("累积空片段后 finish 返回空字符串", () => {
    const acc = createTextAccumulator();
    acc.add("");
    acc.add("");
    assert.strictEqual(acc.finish(), "");
  });

  it("累积多个片段后返回拼接结果", () => {
    const acc = createTextAccumulator();
    acc.add("Hello");
    acc.add(" ");
    acc.add("World");
    assert.strictEqual(acc.finish(), "Hello World");
  });

  it("累积 Unicode 字符", () => {
    const acc = createTextAccumulator();
    acc.add("你好，");
    acc.add("世界！🎮");
    assert.strictEqual(acc.finish(), "你好，世界！🎮");
  });

  it("累积多行文本", () => {
    const acc = createTextAccumulator();
    acc.add("第一行\n");
    acc.add("第二行\n");
    acc.add("第三行");
    assert.strictEqual(acc.finish(), "第一行\n第二行\n第三行");
  });

  it("单次 add 完整文本", () => {
    const acc = createTextAccumulator();
    acc.add("完整的句子");
    assert.strictEqual(acc.finish(), "完整的句子");
  });
});

// ---------------------------------------------------------------------------
// 测试：SSE 事件解析
// ---------------------------------------------------------------------------

describe("SSE 事件解析", () => {
  it("SSE 事件块以双换行分隔", () => {
    const buffer = "data: Hello\ndata: World\n\ndata: Second event\n\n";
    const parts = buffer.split(/\n\n/);
    assert.strictEqual(parts.length, 3);
    assert.strictEqual(parts[0], "data: Hello\ndata: World");
    assert.strictEqual(parts[1], "data: Second event");
    assert.strictEqual(parts[2], "");
  });

  it("单事件块无尾部双换行", () => {
    const buffer = "data: Single";
    const parts = buffer.split(/\n\n/);
    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0], "data: Single");
  });

  it("解析带 event: 前缀的事件类型", () => {
    const block = "event: error\ndata:{\"code\":\"TEST\",\"message\":\"test error\"}\n";
    const lines = block.split(/\r?\n/);
    let type = "text";
    let data = "";

    for (const line of lines) {
      if (/^event:\s*(\S+)/.test(line)) {
        const match = line.match(/^event:\s*(\S+)/);
        type = match[1];
      } else if (line.startsWith("data:")) {
        data = line.slice(5).trimStart();
      }
    }

    assert.strictEqual(type, "error");
    assert.strictEqual(data, '{"code":"TEST","message":"test error"}');
  });

  it("多行 data 值用换行拼接", () => {
    const block = "data:First line\ndata:Second line\ndata:Third line";
    const lines = block.split(/\r?\n/);
    let data = "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const value = line.slice(5).trimStart();
        data += (data.length > 0 ? "\n" : "") + value;
      }
    }

    assert.strictEqual(data, "First line\nSecond line\nThird line");
  });

  it("忽略非 data/event 行", () => {
    const block = "id: 123\ndata:content\nretry: 3000\n";
    const lines = block.split(/\r?\n/);
    let data = "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        data = line.slice(5).trimStart();
      }
    }

    assert.strictEqual(data, "content");
  });
});

// ---------------------------------------------------------------------------
// 测试：SSE 解码器
// ---------------------------------------------------------------------------

describe("SSE 解码器", () => {
  it("仅在空行终止事件后派发，且跨网络分片不丢失内容", () => {
    const events = [];
    const decoder = createSseEventDecoder(event => events.push(event));
    decoder.push("data: event_details:\ndata:   tem");
    assert.deepStrictEqual(events, []);
    decoder.push("plate_name: \"检定\"\n\n");
    assert.deepStrictEqual(events, [{
      type: "text",
      data: 'event_details:\n  template_name: "检定"',
      raw: 'data: event_details:\ndata:   template_name: "检定"'
    }]);
  });

  it("移除 data: 后的单个分隔空格，保留 YAML 自身的缩进", () => {
    const data = [];
    const decoder = createSseEventDecoder(event => data.push(event.data));
    decoder.push("data:   template_name: \"检定\"\n\n");
    assert.deepStrictEqual(data, ['  template_name: "检定"']);
  });

  it("多行 data 以换行拼接，并支持 CRLF 分隔", () => {
    const events = [];
    const decoder = createSseEventDecoder(event => events.push(event));
    decoder.push("event: error\r\ndata: {\"code\":\"X\"}\r\n\r\n");
    assert.equal(events[0].type, "error");
    assert.equal(events[0].data, '{"code":"X"}');
  });

  it("响应结束时不派发截断事件", () => {
    const events = [];
    const decoder = createSseEventDecoder(event => events.push(event));
    decoder.push("data: event_details:");
    assert.equal(decoder.finish(), "data: event_details:");
    assert.deepStrictEqual(events, []);
  });
});

// ---------------------------------------------------------------------------
// 测试：RuntimeContractError 与服务器错误码对应
// ---------------------------------------------------------------------------

describe("错误码映射", () => {
  const KNOWN_ERROR_CODES = [
    "MISSING_FIELD",
    "FIELD_TYPE",
    "PACKAGE_CONTEXT_TYPE",
    "PACKAGE_CONTEXT_ENGINE",
    "PACKAGE_CONTEXT_WORLD",
    "PACKAGE_CONTEXT_DUNGEON",
    "PACKAGE_CONTEXT_ID",
    "PACKAGE_CONTEXT_VERSION",
    "STORY_STATE_TYPE",
    "STORY_STATE_COMPLETED_EVENTS",
    "STORY_STATE_FLAGS",
    "STORY_STATE_ROUTE",
    "STORY_STATE_ROUTE_INT",
    "STORY_STATE_SCENE",
    "STORY_STATE_VISITED",
    "STORY_STATE_NPC_STATES",
    "STORY_STATE_HOOKS",
    "STORY_STATE_NOTES",
    "STORY_STATE_RECENT",
    "STORY_STATE_ARCHETYPE",
    "STORY_STATE_MODIFIERS",
    "PENDING_TYPE",
    "PENDING_EVENT_ID",
    "PENDING_SCENE_ID",
    "CANDIDATES_TYPE",
    "CANDIDATE_TYPE",
    "CANDIDATE_ID",
    "CANDIDATE_WEIGHT",
    "CANDIDATE_DUPLICATE",
    "REQUEST_TYPE",
    "OPERATION_TYPE",
    "OPERATION_TEMPLATE_MISMATCH",
    "EXPECTED_TEMPLATE_NAME",
    "STATE_VERSION",
    "CURRENT_ROUND",
    "RUN_DIFFICULTY",
    "FORCED_EVENT_ID",
    "FORCED_EVENT_NOT_IN_CANDIDATES",
    "PENDING_REQUIRED",
    "PENDING_SCENE_MISMATCH",
    "STORY_STATE_SCENE_MISMATCH",
    "PROMPT_ASSEMBLY_FAILED",
    "UPSTREAM_ERROR",
    "HTTP_ERROR",
    "FETCH_ERROR",
    "READ_ERROR",
    "NO_READER",
    "CLIENT_ABORTED",
    "REQUEST_TOO_LARGE",
    "INVALID_JSON",
    "REQUEST_READ_FAILED",
    "SSE_ERROR",
    "METHOD_NOT_ALLOWED",
    "NOT_FOUND"
  ];

  it("所有已知错误码已定义", () => {
    const seen = new Set();
    const duplicates = KNOWN_ERROR_CODES.filter(code => {
      if (seen.has(code)) return true;
      seen.add(code);
      return false;
    });
    assert.deepStrictEqual(duplicates, []);
  });

  it("错误码符合大写下划线规范", () => {
    const pattern = /^[A-Z][A-Z0-9_]+$/;
    for (const code of KNOWN_ERROR_CODES) {
      assert.ok(pattern.test(code), `错误码 "${code}" 不符合规范`);
    }
  });
});

// ---------------------------------------------------------------------------
// 测试：端到端协议验证
// ---------------------------------------------------------------------------

describe("协议端到端验证", () => {
  it("最小有效 start 请求", async () => {
    const { validateRequest } = await import("./runtime_contract.mjs");
    const req = {
      runtime_yaml: "template: 新一轮事件\nuser_input: test",
      operation: { type: "start", request_id: "req-001", expected_template_name: "新一轮事件" },
      state_version: 1,
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
        completed_events: [],
        story_flags: [],
        route_scores: { combat: 0, scheme: 0, cleanse: 0 },
        current_scene_id: "scene_village",
        visited_scene_ids: [],
        npc_states: [],
        unresolved_hooks: [],
        memory_notes: [],
        recent_event_ids: [],
        run_archetype: "balanced",
        run_modifier_ids: ["mod1", "mod2"]
      }
    };

    const result = validateRequest(req);
    assert.strictEqual(result.operationType, "start");
    assert.strictEqual(result.expectedTemplateName, "新一轮事件");
    assert.strictEqual(result.currentRound, 1);
  });

  it("缺少必需字段抛出对应错误码", async () => {
    const { validateRequest, RuntimeContractError } = await import("./runtime_contract.mjs");
    const req = {
      runtime_yaml: "test: yaml",
      // 缺少 operation 字段
      state_version: 1,
      current_round: 1,
      current_scene_id: "scene1",
      story_state: {
        completed_events: [], story_flags: [], route_scores: { combat: 0, scheme: 0, cleanse: 0 },
        current_scene_id: "scene1", visited_scene_ids: [], npc_states: [],
        unresolved_hooks: [], memory_notes: [], recent_event_ids: [],
        run_archetype: "balanced", run_modifier_ids: ["mod1", "mod2"]
      }
    };

    try {
      validateRequest(req);
      assert.fail("应抛出 RuntimeContractError");
    } catch (err) {
      assert.ok(err instanceof RuntimeContractError);
      assert.strictEqual(err.code, "MISSING_FIELD");
    }
  });

  it("无效 operation.type 抛出 OPERATION_TYPE 错误", async () => {
    const { validateRequest, RuntimeContractError } = await import("./runtime_contract.mjs");
    const req = {
      runtime_yaml: "test: yaml",
      operation: { type: "invalid_op", request_id: "req-002", expected_template_name: "新一轮事件" },
      state_version: 1,
      current_round: 1,
      current_scene_id: "scene1",
      story_state: {
        completed_events: [], story_flags: [], route_scores: { combat: 0, scheme: 0, cleanse: 0 },
        current_scene_id: "scene1", visited_scene_ids: [], npc_states: [],
        unresolved_hooks: [], memory_notes: [], recent_event_ids: [],
        run_archetype: "balanced", run_modifier_ids: ["mod1", "mod2"]
      }
    };

    try {
      validateRequest(req);
      assert.fail("应抛出 RuntimeContractError");
    } catch (err) {
      assert.ok(err instanceof RuntimeContractError);
      assert.strictEqual(err.code, "OPERATION_TYPE");
    }
  });

  it("current_round < 1 抛出 CURRENT_ROUND 错误", async () => {
    const { validateRequest, RuntimeContractError } = await import("./runtime_contract.mjs");
    const req = {
      runtime_yaml: "test: yaml",
      operation: { type: "start", request_id: "req-003", expected_template_name: "新一轮事件" },
      state_version: 1,
      current_round: 0,
      current_scene_id: "scene1",
      story_state: {
        completed_events: [], story_flags: [], route_scores: { combat: 0, scheme: 0, cleanse: 0 },
        current_scene_id: "scene1", visited_scene_ids: [], npc_states: [],
        unresolved_hooks: [], memory_notes: [], recent_event_ids: [],
        run_archetype: "balanced", run_modifier_ids: ["mod1", "mod2"]
      }
    };

    try {
      validateRequest(req);
      assert.fail("应抛出 RuntimeContractError");
    } catch (err) {
      assert.ok(err instanceof RuntimeContractError);
      assert.strictEqual(err.code, "CURRENT_ROUND");
    }
  });
});

// ---------------------------------------------------------------------------
// 测试：提示词黑名单过滤
// ---------------------------------------------------------------------------

describe("提示词黑名单过滤", () => {
  it("runtime_yaml 中的 user_input 被黑名单词命中后替换", async () => {
    const { buildBlacklistPatch, applyYamlFilterPatch } = await import("./runtime_contract.mjs");

    // findStringScalarsByName 只匹配带缩进的字段行：<indent><field_name>: "<value>"
    const yaml = `template: 新一轮事件
  user_input: "用户想输入敏感词进行测试"
`;

    const patch = buildBlacklistPatch(yaml, ["敏感词"]);
    assert.strictEqual(patch.length, 1);
    assert.strictEqual(patch[0].value, "[内容已屏蔽]");

    const filtered = applyYamlFilterPatch(yaml, patch);
    assert.ok(filtered.includes("[内容已屏蔽]"));
    assert.ok(!filtered.includes("敏感词"));
  });

  it("空黑名单不产生 patch", async () => {
    const { buildBlacklistPatch } = await import("./runtime_contract.mjs");
    const yaml = `template: 新一轮事件
  user_input: "正常内容"
`;
    const patch = buildBlacklistPatch(yaml, []);
    assert.deepStrictEqual(patch, []);
  });

  it("不区分大小写的命中", async () => {
    const { buildBlacklistPatch } = await import("./runtime_contract.mjs");
    const yaml = `template: 新一轮事件
  user_input: "SENSITIVE word"
`;
    const patch = buildBlacklistPatch(yaml, ["sensitive"]);
    assert.strictEqual(patch.length, 1);
  });
});
