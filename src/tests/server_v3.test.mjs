// v3 通道的 HTTP 端到端测试。
//
// 覆盖：
//   1. POST /api/adventure/transition（create / continue / view / restart）
//   2. POST /api/chat 的 v3 分流（event: state + request_guard）
//
// ⚠️ 这里用「假模型」返回合法 YAML，验证协议链路；不验证模型质量。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig } from "../server/config.mjs";
import { createApp } from "../server/routes.mjs";
import * as R from "../engine/vendor/v3/src/runtime.mjs";
import * as A from "../engine/vendor/v3/src/adventure.mjs";
import { V3_PACKAGE_VERSION } from "../engine/v3_adapter.mjs";

const copy = x => structuredClone(x);
const ATTRIBUTE_KEYS = [
  "strength", "agility", "intelligence", "constitution", "physique", "dexterity",
  "perception", "knowledge", "survival", "social", "authority", "deception"
];

function fixtureTeam() {
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, 20]));
  return ["星穹法师", "熔岩矮人王", "花岗岩像鬼", "实习牧师"].map((name, index) => ({
    instance_id: `qa_${index}`,
    card_id: `card_${index}`,
    name,
    quality: 4,
    profession: ["法师", "战士", "坦克", "法师"][index],
    gender: "男",
    race: "人族",
    personality: "睿智",
    attributes
  }));
}

function newCampaign() {
  const adventure = A.createAdventure("e2e_campaign_001");
  return A.continueAdventure(adventure, {
    expectedRevision: adventure.revision,
    runId: "e2e_run_001",
    seed: 1001,
    team: fixtureTeam(),
    gold: 1000,
    diamond: 0,
    relics: [],
    rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "e2e_cycle" })
  });
}

/** 构造合法的新一轮事件输出（与服务端 packages/tests/simulation.mjs 一致）。 */
function newEventOutput(runtime, event) {
  const scene = R.assets.scenes[event.asset_scope.scenes[0]].name;
  const templateByType = { check: "检定", battle: "战斗事件", direct: "结算" };
  return {
    event_details: {
      template_name: "新一轮事件",
      event_id: event.event_id,
      current_round: runtime.current_round,
      supply_value: runtime.supply_value,
      corruption_value: runtime.corruption_value,
      current_theme: event.title,
      current_type: "主线事件",
      scene_name: scene,
      steps: [{ narration: "队伍来到场景。" }],
      options: event.options.map(option => ({
        text: option.text,
        id: option.id,
        template_name: templateByType[option.resolution_type],
        visible: true,
        available: R.optionAvailable(runtime, option),
        ...(option.resolution_type === "check"
          ? { check_type: "常规检定", check_difficulty: Math.min(20, option.base_difficulty) }
          : {})
      }))
    }
  };
}

function startTestServer({ client } = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    CLIENT_ORIGINS: "http://client.test"
  });
  const modelClient = client || {
    chat: {
      completions: {
        create: async function* () {
          yield { choices: [{ delta: { content: "event_details:\n  template_name: \"新一轮事件\"\n" } }] };
        }
      }
    }
  };
  const app = createApp({ config, modelClient });
  const server = http.createServer((req, res) => app(req, res));
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

async function transition(base, body) {
  const response = await fetch(`${base}/api/adventure/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

/** 解析 SSE 文本，取出 event: state 的 JSON 载荷。 */
function extractState(sseText) {
  const blocks = sseText.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.includes("event: state")) continue;
    const dataLines = block
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart());
    return JSON.parse(dataLines.join("\n"));
  }
  return null;
}

describe("v3 控制通道 HTTP", () => {
  it("create → continue → view 全链路可用", async () => {
    const { server, base } = await startTestServer();
    try {
      const created = await transition(base, {
        package_version: V3_PACKAGE_VERSION,
        action: "create",
        args: { campaignId: "http_campaign_001" }
      });
      assert.equal(created.status, 200);
      assert.equal(created.payload.adventure.schema_version, 3);
      assert.equal(created.payload.adventure.revision, 0);
      assert.equal(created.payload.view.chapter_cards.length, 8);

      const continued = await transition(base, {
        package_version: V3_PACKAGE_VERSION,
        adventure: created.payload.adventure,
        action: "continue",
        args: {
          runId: "http_run_001",
          seed: 1001,
          team: fixtureTeam(),
          gold: 1000,
          diamond: 0,
          relics: [],
          rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "http_cycle" })
        }
      });
      assert.equal(continued.status, 200);
      assert.equal(continued.payload.adventure.runtime.chapter_id, "CH01");
      assert.equal(continued.payload.adventure.runtime.current_round, 1);
      assert.equal(continued.payload.adventure.revision, 1);

      const viewed = await transition(base, {
        package_version: V3_PACKAGE_VERSION,
        adventure: continued.payload.adventure,
        action: "view",
        args: {}
      });
      assert.equal(viewed.status, 200);
      assert.equal(viewed.payload.adventure.revision, 1);
      assert.equal(viewed.payload.view.chapter_cards[0].state, "in_progress");
    } finally { await close(server); }
  });

  it("拒绝存档内部不一致（campaign.revision 与 runtime 不匹配）", async () => {
    const { server, base } = await startTestServer();
    try {
      const campaign = newCampaign();
      // 篡改 campaign.revision：runtime.campaign_revision 不再匹配。
      const tampered = copy(campaign);
      tampered.campaign.revision = campaign.campaign.revision + 5;
      const result = await transition(base, {
        package_version: V3_PACKAGE_VERSION,
        adventure: tampered,
        action: "view",
        args: {}
      });
      assert.equal(result.status, 400);
      assert.equal(result.payload.error.code, "V3_CONTRACT_INVALID");
      assert.match(result.payload.error.message, /活动run不属于当前冒险/);
    } finally { await close(server); }
  });

  it("拒绝跨章游标错位的存档", async () => {
    const { server, base } = await startTestServer();
    try {
      const campaign = newCampaign();
      // 伪造一条 CH01 章节记录：runtime 仍在 CH01 → 游标应为 1。
      const tampered = copy(campaign);
      tampered.campaign.chapter_results = [
        {
          chapter_id: "CH01",
          run_id: "fake",
          outcome: "cleared",
          flags: [],
          recap: "",
          recap_source: "fallback"
        }
      ];
      const result = await transition(base, {
        package_version: V3_PACKAGE_VERSION,
        adventure: tampered,
        action: "view",
        args: {}
      });
      assert.equal(result.status, 400);
      assert.equal(result.payload.error.code, "V3_CONTRACT_INVALID");
      assert.match(result.payload.error.message, /活动章游标错误/);
    } finally { await close(server); }
  });

  it("拒绝不匹配的包版本", async () => {
    const { server, base } = await startTestServer();
    try {
      const result = await transition(base, {
        package_version: "2026.09.04.1",
        action: "create",
        args: { campaignId: "x" }
      });
      assert.equal(result.status, 400);
      assert.match(result.payload.error.message, /包版本不匹配/);
    } finally { await close(server); }
  });
});

describe("v3 AI 通道 HTTP", () => {
  it("start 请求下发 event: state，含下一版 adventure 与 request_guard", async () => {
    const campaign = newCampaign();
    const event = R.events.CH01_E001;
    const document = newEventOutput(campaign.runtime, event);
    const client = {
      chat: {
        completions: {
          create: async function* () {
            yield { choices: [{ delta: { content: R.yaml(document) } }] };
          }
        }
      }
    };
    const { server, base } = await startTestServer({ client });
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_version: V3_PACKAGE_VERSION,
          adventure: campaign,
          operation: {
            request_id: "http-start-001",
            type: "start",
            expected_template_name: "新一轮事件"
          }
        })
      });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.match(text, /data: \[DONE\]/);

      const state = extractState(text);
      assert.ok(state, "必须下发 event: state");
      assert.equal(state.adventure.schema_version, 3);
      assert.equal(state.adventure.revision, campaign.revision + 1);
      assert.equal(state.adventure.runtime.pending_interaction.phase, "awaiting_choice");
      assert.equal(state.adventure.runtime.pending_interaction.event_id, event.event_id);
      assert.equal(state.request_guard.session_revision, campaign.revision);
      assert.equal(state.request_guard.run_id, campaign.runtime.run_id);
      // ⚠️ state 事件必须带上服务端权威校验过的 AI 文档，
      //    客户端直接展示它，不必再自行解析 YAML。
      assert.ok(state.output, "state 事件必须带 output");
      assert.equal(state.output.event_details.template_name, "新一轮事件");
      assert.equal(state.output.event_details.event_id, event.event_id);
    } finally { await close(server); }
  });

  it("AI 输出非法时不推进状态且返回错误", async () => {
    const campaign = newCampaign();
    const client = {
      chat: {
        completions: {
          create: async function* () {
            yield { choices: [{ delta: { content: "event_details:\n  template_name: \"战斗事件\"\n" } }] };
          }
        }
      }
    };
    const { server, base } = await startTestServer({ client });
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_version: V3_PACKAGE_VERSION,
          adventure: campaign,
          operation: {
            request_id: "http-start-bad-001",
            type: "start",
            expected_template_name: "新一轮事件"
          }
        })
      });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.match(text, /event: error/);
      assert.match(text, /V3_OUTPUT_INVALID/);
      assert.equal(extractState(text), null, "失败输出不得下发 state");
    } finally { await close(server); }
  });

  it("choose 请求：服务端预迁移 selectOption 并回传 state_version +1", async () => {
    const campaign = newCampaign();
    // 先用引擎造出 awaiting_choice 的 pending。
    const runtime = R.acceptNewEvent(campaign.runtime, newEventOutput(campaign.runtime, R.events.CH01_E001));
    const pending = { ...campaign, runtime };
    const selectedOption = copy(pending.runtime.pending_interaction.event_output.event_details.options[0]);

    const client = {
      chat: {
        completions: {
          create: async function* () {
            yield {
              choices: [{
                delta: {
                  content: R.yaml({
                    event_details: {
                      template_name: "检定",
                      analysis: "队伍完成了这次尝试。",
                      result: "成功"
                    }
                  })
                }
              }]
            };
          }
        }
      }
    };
    const { server, base } = await startTestServer({ client });
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_version: V3_PACKAGE_VERSION,
          adventure: pending,
          operation: {
            request_id: "http-choose-001",
            type: "choose",
            expected_template_name: "检定",
            event_id: "CH01_E001",
            option_id: 1,
            selected_option: selectedOption
          }
        })
      });
      const text = await response.text();
      assert.equal(response.status, 200);
      const state = extractState(text);
      assert.ok(state);
      assert.equal(
        state.adventure.runtime.pending_interaction.phase,
        "awaiting_settlement_commit"
      );
      // selectOption(+1) + acceptResolution(+1)
      assert.equal(
        state.adventure.runtime.state_version,
        pending.runtime.state_version + 2
      );
    } finally { await close(server); }
  });

  it("selected_option 与引擎快照不一致时直接拒绝", async () => {
    const campaign = newCampaign();
    const runtime = R.acceptNewEvent(campaign.runtime, newEventOutput(campaign.runtime, R.events.CH01_E001));
    const pending = { ...campaign, runtime };

    const { server, base } = await startTestServer();
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_version: V3_PACKAGE_VERSION,
          adventure: pending,
          operation: {
            request_id: "http-choose-bad-001",
            type: "choose",
            expected_template_name: "检定",
            event_id: "CH01_E001",
            option_id: 1,
            selected_option: { id: 1, text: "自己编的文案" }
          }
        })
      });
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(payload.error.code, "V3_CONTRACT_INVALID");
    } finally { await close(server); }
  });

  // ── 回归（2026-11-09 线上事故）：AI 在结算里自造 NPC 状态 ──────────
  //
  // 事故现象：结算提交被引擎拒绝（「NPC变化未获授权」），state 事件不下发，
  // 玩家卡在当前轮无法继续。这里从 HTTP 层验证修复后的行为：
  //   1. 结算**必须**成功下发 state；
  //   2. 下发给客户端的 output 必须是**归一化后**的版本。
  it("结算里自造 NPC 状态时仍能提交，并下发归一化后的 output", async () => {
    const campaign = newCampaign();
    const event = R.events.CH01_E001;
    let runtime = R.acceptNewEvent(campaign.runtime, newEventOutput(campaign.runtime, event));
    runtime = R.selectOption(runtime, 1);
    runtime = R.acceptResolution(runtime, {
      event_details: { template_name: "检定", analysis: "队伍完成了这次尝试。", result: "成功" }
    });
    const pending = { ...campaign, runtime };

    // 构造一个「自造 NPC 状态」的结算输出（授权为 []，AI 却写了信任）。
    const settlement = {
      event_details: {
        template_name: "结算",
        event_id: event.event_id,
        current_round: runtime.current_round,
        supply_value: runtime.supply_value,
        corruption_value: runtime.corruption_value,
        current_theme: event.title,
        current_type: "主线事件结算",
        scene_name: runtime.pending_interaction.scene_name,
        steps: [{ narration: "行动有了结果。" }],
        summary: [{ summary: "无物品或数值变化" }],
        story_patch: {
          completed_event_id: event.event_id,
          selected_option_id: 1,
          outcome: "success",
          run_archetype: runtime.story_state.run_archetype,
          run_modifier_ids: copy(runtime.story_state.run_modifier_ids),
          add_flags: ["CH01_N1_RESOLVED"],
          remove_flags: [],
          route_delta: { combat: 0, scheme: 1, cleanse: 0 },
          npc_state_updates: [{ npc: "村长艾德", state: "trusted" }],
          memory_notes: [],
          unresolved_hooks_added: [],
          unresolved_hooks_resolved: []
        },
        final_chapter: false
      }
    };

    const client = {
      chat: {
        completions: {
          create: async function* () {
            yield { choices: [{ delta: { content: R.yaml(settlement) } }] };
          }
        }
      }
    };
    const { server, base } = await startTestServer({ client });
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_version: V3_PACKAGE_VERSION,
          adventure: pending,
          operation: {
            request_id: "http-settle-npc-bad-001",
            type: "settle_check",
            expected_template_name: "结算",
            event_id: event.event_id,
            option_id: 1,
            check_result: "成功"
          }
        })
      });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.doesNotMatch(text, /NPC变化未获授权/);

      const state = extractState(text);
      assert.ok(state, "修复后结算必须成功下发 state");
      assert.equal(state.adventure.runtime.pending_interaction, null);
      assert.equal(state.adventure.runtime.story_state.completed_events.length, 1);
      // 自造的 NPC 状态不得进入存档。
      assert.deepEqual(state.adventure.runtime.story_state.npc_states, []);
      // 下发给客户端的 output 必须是归一化后的版本。
      assert.deepEqual(
        state.output.event_details.story_patch.npc_state_updates,
        []
      );
    } finally { await close(server); }
  });
});
