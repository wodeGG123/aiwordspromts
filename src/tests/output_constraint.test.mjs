/**
 * 服务端约束传递回归测试
 *
 * 测试目标：保证服务端只把「结构约束」交给 AI，绝不带任何模板 demo / 示例角色
 * / 示例事件 / reward ID 等具体内容；保证 `buildEngineContext(expectedTemplateName)`
 * 真的按模板裁剪，而不是把全部规则一股脑塞进 prompt。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEngineContext } from "../../数据拆分包_20260904/00_源包/冒险模式_通用引擎包_20260904_v5.js";
import {
  listTemplateNames,
  renderTemplateConstraint
} from "../../数据拆分包_20260904/00_源包/输出约束Schema_20260904.mjs";
import {
  validateTemplateOutput,
  formatValidationErrors
} from "../../数据拆分包_20260904/04_验证工具/输出约束校验器.mjs";

// 历史上曾经在 enginePrompt 里出现过的 demo / 示例字符串。
// 这些字符串绝不能再出现在任何一个 buildEngineContext() 输出里——
// 一旦被 AI 看到，AI 会把它们当成"参考内容"原样复用。
// 注意：`BEGIN_*_TEMPLATE` / `END_*_TEMPLATE` 等围栏标记若以「泛指」形式出现
// （例如 explicit_refuse 段描述「禁止复用围栏标记占位符」），属于正常红线描述；
// 但若以"具体 demo 整段 YAML"出现，仍可由更深一层的"检查每行缩进是否构成合法 YAML"挡掉。
// 这里只保留真正的实例化示例内容。围栏标记名改放在对 `forbidden sentinel matches` 的
// 独立检查里，专门验证它没被当成 demo 引用。
const FORBIDDEN_DEMO_FRAGMENTS = Object.freeze([
  "村长艾德",
  "星穹法师",
  "熔岩矮人王",
  "花岗岩像鬼",
  "猎魔人，粮仓里还有人",
  "推倒旧货车封住狭巷"
]);

// 围栏标记只能以「禁止复用」的元话语形式存在，不应以「可作为 YAML 字段值」的实体形式出现。
// 我们用一个"小写 + 紧跟 \": 字符"的模式来检查它有没有被实例化为 YAML 字段。
const FORBIDDEN_SENTINEL_PATTERN = /(?:^|\n)\s*(?:begin_new_event_template|end_new_event_template|begin_battle_template|end_battle_template|begin_check_template|end_check_template|begin_settle_template|end_settle_template|begin_finale_template|end_finale_template)\s*:/i;

// 每模板应有的 header gate 标记（来自 streamingDisplayContract.header_gate_paths_by_template）
const EXPECTED_HEADER_GATE_MARKERS = Object.freeze({
  "新一轮事件": ["template_name", "event_id", "scene_name"],
  "战斗事件": ["template_name", "scene_name"],
  "检定": ["template_name"],
  "结算": ["template_name", "event_id", "scene_name"],
  "终章": ["template_name"]
});

describe("buildEngineContext: 5 个模板各自的输出约束文本", () => {
  const templates = listTemplateNames();

  it("listTemplateNames 返回五模板正确顺序", () => {
    assert.deepStrictEqual(templates, [
      "新一轮事件",
      "战斗事件",
      "检定",
      "结算",
      "终章"
    ]);
  });

  for (const templateName of templates) {
    describe(`模板 ${templateName}`, () => {
      it("renderTemplateConstraint 末尾追加一段「输出约束：<模板名>」", () => {
        const constraint = renderTemplateConstraint(templateName);
        assert.ok(constraint.startsWith(`#输出约束：${templateName}`), `${templateName} 的约束文本必须以自身名为头`);
        assert.ok(constraint.includes(`##输出顺序（根层键，严格按此先后）`), `${templateName} 的约束文本必须声明根层键顺序`);
      });

      it("buildEngineContext 拼接后，含 #输出约束：<模板名>", () => {
        const engineContext = buildEngineContext(templateName);
        assert.ok(engineContext.includes(`#输出约束：${templateName}`),
          `${templateName} 的引擎积木必须包含自身约束文本`);
      });

      it("buildEngineContext 不含任何 demo / 示例片段", () => {
        const engineContext = buildEngineContext(templateName);
        const hits = FORBIDDEN_DEMO_FRAGMENTS.filter(fragment => engineContext.includes(fragment));
        assert.deepStrictEqual(hits, [],
          `${templateName} 残留 demo 片段：${hits.join(" / ")}`);
      });

      it("buildEngineContext 不存在「围栏标记当 YAML 字段」的实例化（仅允许元话语）", () => {
        const engineContext = buildEngineContext(templateName);
        assert.equal(FORBIDDEN_SENTINEL_PATTERN.test(engineContext), false,
          `${templateName} 把 begin_*/end_*_template 当 YAML 字段实例化了（视为 demo 残留）`);
      });

      it(`buildEngineContext 含 header_gate 关键词`, () => {
        const engineContext = buildEngineContext(templateName);
        for (const marker of EXPECTED_HEADER_GATE_MARKERS[templateName]) {
          assert.ok(engineContext.includes(marker),
            `${templateName} 应提及 header gate 字段 ${marker}`);
        }
      });

      it(`buildEngineContext 末尾追加 explicit_refuse 红线`, () => {
        const engineContext = buildEngineContext(templateName);
        assert.ok(engineContext.includes("explicit_refuse"),
          `${templateName} 必须包含 explicit_refuse 拒绝复用 demo 的红线段`);
      });
    });
  }
});

describe("buildEngineContext: 模板裁剪", () => {
  it("不同模板产出不同 constraint 段（互不相同）", () => {
    const newEventCtx = buildEngineContext("新一轮事件");
    const checkCtx = buildEngineContext("检定");
    const settleCtx = buildEngineContext("结算");
    assert.notStrictEqual(newEventCtx.length, checkCtx.length);
    assert.notStrictEqual(checkCtx.length, settleCtx.length);
    assert.ok(newEventCtx.includes("#输出约束：新一轮事件"));
    assert.ok(checkCtx.includes("#输出约束：检定"));
    assert.ok(settleCtx.includes("#输出约束：结算"));
  });

  it("单个模板的积木长度显著小于「五模板拼接」（证明按模板裁剪，不是全量）", () => {
    const concatenated = listTemplateNames()
      .map(name => buildEngineContext(name))
      .join("\n\n");
    for (const templateName of listTemplateNames()) {
      const single = buildEngineContext(templateName);
      assert.ok(single.length < concatenated.length,
        `${templateName} 单独输出（${single.length} 字符）必须小于五模板拼接（${concatenated.length} 字符）`);
    }
  });

  it("终章 / 检定这类精简模板的 section 数明显少于新一轮事件", () => {
    const newEventLen = buildEngineContext("新一轮事件").length;
    const finaleLen = buildEngineContext("终章").length;
    const checkLen = buildEngineContext("检定").length;
    assert.ok(finaleLen < newEventLen, "终章应显著短于新一轮事件");
    assert.ok(checkLen < newEventLen, "检定应显著短于新一轮事件");
  });
});

describe("服务端传递链路 (sanity check)", () => {
  it("五模板期望的 expected_template_name 全部能被 buildEngineContext 接收", () => {
    for (const templateName of listTemplateNames()) {
      assert.doesNotThrow(() => buildEngineContext(templateName),
        `${templateName} 必须是合法参数`);
    }
  });

  it("不支持的 expected_template_name 抛错", () => {
    assert.throws(() => buildEngineContext("无效模板名"), RangeError);
    assert.throws(() => buildEngineContext(""), RangeError);
    assert.throws(() => buildEngineContext("begin_new_event_template"), RangeError);
  });
});

// ── 输出约束校验器 ──────────────────────────────────────────────────

/** 一份结构完全合法的新一轮事件输出，测试都在它上面做单点破坏。 */
function validNewEventOutput() {
  return {
    event_details: {
      template_name: "新一轮事件",
      event_id: "M01",
      current_round: 1,
      supply_value: 100,
      corruption_value: 10,
      current_theme: "边境求援",
      current_type: "主线事件",
      scene_name: "艾德村庄",
      steps: [
        { narration: "你们赶到村口时，粮仓方向传来木板折断的闷响。" },
        { dialogues: [{ npc: "村长艾德", speech: "粮仓里还有人！" }] }
      ],
      options: [
        {
          text: "先救粮仓里的人（力量检定）",
          id: 1,
          template_name: "检定",
          visible: true,
          available: true,
          check_type: "常规检定",
          check_difficulty: 12
        },
        { text: "绕到村后查看井沟", id: 2, template_name: "结算", visible: true, available: true }
      ]
    }
  };
}

/** 一份结构完全合法的结算输出。 */
function validSettlementOutput() {
  return {
    event_details: {
      template_name: "结算",
      event_id: "M01",
      current_round: 1,
      supply_value: 100,
      corruption_value: 10,
      current_theme: "危机暂歇",
      current_type: "主线事件结算",
      scene_name: "艾德村庄",
      steps: [
        { narration: "你们把最后一股黏液压在了车轮下。" },
        { narration: "村民从清出的窄道里撤了出来。" },
        { dialogues: [{ npc: "村长艾德", speech: "你们救了他们。" }] }
      ],
      summary: [{ summary: "获得粘液核心x1" }],
      story_patch: {
        completed_event_id: "M01",
        selected_option_id: 2,
        outcome: "success",
        run_archetype: "corruption_hunt",
        run_modifier_ids: ["MOD_GHOST_TIDE", "MOD_FRACTURED_TRUST"],
        add_flags: ["M01_SCHEME"],
        remove_flags: [],
        route_delta: { combat: 0, scheme: 1, cleanse: 0 },
        npc_state_updates: [],
        memory_notes: [],
        unresolved_hooks_added: [],
        unresolved_hooks_resolved: []
      },
      final_chapter: false
    }
  };
}

function codesOf(result) {
  return result.errors.map(error => error.code);
}

describe("输出约束校验器", () => {
  it("结构合法的新一轮事件输出通过校验", () => {
    const result = validateTemplateOutput(validNewEventOutput(), { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, true, formatValidationErrors(result));
  });

  it("结构合法的结算输出通过校验", () => {
    const result = validateTemplateOutput(validSettlementOutput(), { expectedTemplateName: "结算" });
    assert.equal(result.ok, true, formatValidationErrors(result));
  });

  it("未声明的字段被拒", () => {
    const output = validNewEventOutput();
    output.event_details.reward_id = "R_900050";
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("UNKNOWN_FIELD"));
  });

  it("根层多出键被拒", () => {
    const output = validNewEventOutput();
    output.reward_state = {};
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("ROOT_KEYS"));
  });

  it("字段顺序错乱被拒", () => {
    const output = validNewEventOutput();
    const details = output.event_details;
    const options = details.options;
    delete details.options;
    details.options = options;
    // 把 options 挪到 steps 之前：声明顺序里 options 在 steps 之后
    const rebuilt = { template_name: details.template_name, event_id: details.event_id, current_round: details.current_round, supply_value: details.supply_value, corruption_value: details.corruption_value, current_theme: details.current_theme, current_type: details.current_type, scene_name: details.scene_name, options: details.options, steps: details.steps };
    output.event_details = rebuilt;
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("KEY_ORDER"));
  });

  it("枚举越界被拒", () => {
    const output = validNewEventOutput();
    output.event_details.current_type = "随机事件";
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("ENUM"));
  });

  it("整数越界被拒", () => {
    const output = validNewEventOutput();
    output.event_details.supply_value = 180;
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("RANGE"));
  });

  it("缺必填字段被拒", () => {
    const output = validNewEventOutput();
    delete output.event_details.event_id;
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("MISSING_REQUIRED"));
  });

  it("steps 同一项同时有 narration 与 dialogues 被拒", () => {
    const output = validNewEventOutput();
    output.event_details.steps[0].dialogues = [{ npc: "村长艾德", speech: "快走！" }];
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("EXCLUSIVE"));
  });

  it("非检定选项输出 check_type 被拒", () => {
    const output = validNewEventOutput();
    output.event_details.options[1].check_type = "常规检定";
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("UNEXPECTED_FIELD"));
  });

  it("检定选项缺 check_difficulty 被拒", () => {
    const output = validNewEventOutput();
    delete output.event_details.options[0].check_difficulty;
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("MISSING_CONDITIONAL"));
  });

  it("template_name 与程序要求不一致被拒", () => {
    const output = validNewEventOutput();
    output.event_details.template_name = "战斗事件";
    const result = validateTemplateOutput(output, { expectedTemplateName: "新一轮事件" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("TEMPLATE_MISMATCH"));
  });

  it("event_id 与程序锁定值不一致被拒", () => {
    const output = validSettlementOutput();
    const result = validateTemplateOutput(output, { expectedTemplateName: "结算", expectedEventId: "M09" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("EVENT_ID_MISMATCH"));
  });

  it("scene_name 与程序锁定值不一致被拒", () => {
    const output = validSettlementOutput();
    const result = validateTemplateOutput(output, { expectedTemplateName: "结算", expectedSceneName: "魔王大厅" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("SCENE_MISMATCH"));
  });

  it("player_attr 只输出实际变化的键时通过校验（未变化的键可省略）", () => {
    const output = validSettlementOutput();
    output.event_details.summary = [
      { summary: "补给消耗 1 点" },
      { type: "player_attr", supply: -1 }
    ];
    const result = validateTemplateOutput(output, { expectedTemplateName: "结算" });
    assert.equal(result.ok, true, formatValidationErrors(result));
  });

  it("item 明细缺 count 被拒", () => {
    const output = validSettlementOutput();
    output.event_details.summary = [
      { summary: "获得粘液核心x1" },
      { type: "item", id: 900004 }
    ];
    const result = validateTemplateOutput(output, { expectedTemplateName: "结算" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("MISSING_CONDITIONAL"));
  });

  it("item 明细带 count 合法", () => {
    const output = validSettlementOutput();
    output.event_details.summary = [
      { summary: "获得粘液核心x1" },
      { type: "item", id: 900004, count: 1 }
    ];
    const result = validateTemplateOutput(output, { expectedTemplateName: "结算" });
    assert.equal(result.ok, true, formatValidationErrors(result));
  });

  it("不是五模板之一的期望模板名直接判失败", () => {
    const result = validateTemplateOutput(validNewEventOutput(), { expectedTemplateName: "开场动画" });
    assert.equal(result.ok, false);
    assert.ok(codesOf(result).includes("TEMPLATE_NAME"));
  });
});
