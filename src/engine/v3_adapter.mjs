// v3（连续八章冒险）协议适配层。
//
// 职责边界（D1：客户端持存档 + 服务端权威计算）：
//   - 客户端持有完整 adventure/runtime 存档，负责持久化、串行提交、拦截过期回包；
//   - 服务端不落盘、不代管状态，但**持有 v3 引擎**，负责：
//     1. 校验请求（包版本、存档 revision、campaign 游标、operation 与模板匹配）；
//     2. 按 operation 做必要的预迁移（choose / battle_result / next_round）；
//     3. 用 v3 引擎装配提示词（system/user）；
//     4. 走原有 SSE 流式转发；
//     5. AI 输出通过校验后推进状态，返回下一版 adventure。
//
// 旧版（数据拆分包_20260904 / runtime_yaml 字符串）通道保留在 runtime_contract.mjs，
// 由请求体是否携带 `adventure` 字段来分流。
//
// ── 时序结论（2026-11-08 实测，见 V3_MIGRATION_PLAN_20261108.md 附录 9）──
//
//   operation      │ 装配前必须完成的服务端迁移            │ AI 输出后的推进
//   ───────────────┼──────────────────────────────────────┼──────────────────────────
//   start          │ 无                                    │ acceptNewEvent
//   next_round     │ nextRound()（推进轮数、扣补给）        │ acceptNewEvent
//   choose         │ selectOption()                        │ acceptResolution
//   choose(直选)   │ selectOption()                        │ commitSettlement
//   settle_check   │ 无（resolution_output 已在存档中）      │ commitSettlement
//   battle_result  │ acceptBattleResult()                  │ commitSettlement
//   finale         │ 无                                    │ 不改状态（归档走控制通道）
//
// ⚠️ direct（直选结算）选项走 `choose` + 结算模板，必须**直接** commitSettlement。
//    若误走 acceptResolution，phase 会被置为 awaiting_battle_result 而卡死。
//    判定依据：operation.expected_template_name === '结算' 且不是 settle_check。
//
// ⚠️ nextRound 由服务端在 next_round 请求的装配前执行：它会 current_round+1、
//    supply 扣减并可能触发硬失败。客户端不持有引擎，无法自行推进。
import * as R from "./vendor/v3/src/runtime.mjs";
import * as A from "./vendor/v3/src/adventure.mjs";
import * as E from "./vendor/v3/src/economy.mjs";
import { parseRestrictedYaml, validateAdventureTemplate } from "./vendor/v3/parser/adventure_yaml_stream_parser.mjs";

export const V3_PACKAGE_VERSION = R.version;

const OPERATION_TYPES = Object.freeze([
  "start",
  "next_round",
  "choose",
  "settle_check",
  "battle_result",
  "finale"
]);

const TEMPLATE_NAMES = Object.freeze(["新一轮事件", "战斗事件", "检定", "结算", "终章"]);

/** v3 operation → 允许的模板（对齐 runtime.mjs 的 matrix）。 */
const OPERATION_TEMPLATES = Object.freeze({
  start: Object.freeze(["新一轮事件"]),
  next_round: Object.freeze(["新一轮事件"]),
  choose: Object.freeze(["检定", "战斗事件", "结算"]),
  settle_check: Object.freeze(["结算"]),
  battle_result: Object.freeze(["结算"]),
  finale: Object.freeze(["终章"])
});

export class V3ContractError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "V3ContractError";
    this.code = "V3_CONTRACT_INVALID";
    this.details = details;
  }
}

export class V3OutputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "V3OutputError";
    this.code = "V3_OUTPUT_INVALID";
    this.details = details;
  }
}

function fail(message, details) {
  throw new V3ContractError(message, details);
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label}必须是对象`);
  }
  return value;
}

function asString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label}必须是非空字符串`);
  }
  return value;
}

/**
 * 校验并规范化 v3 请求体。
 *
 * 请求体形状：
 * {
 *   "package_version": "2026.11.01.3",
 *   "adventure": { schema_version, revision, campaign, runtime, retired_campaign_ids, used_run_ids },
 *   "operation": { request_id, type, expected_template_name, ... }
 * }
 */
export function validateV3Request(body) {
  asObject(body, "请求体");
  const packageVersion = asString(body.package_version, "package_version");
  if (packageVersion !== V3_PACKAGE_VERSION) {
    fail(
      `包版本不匹配：服务端为 ${V3_PACKAGE_VERSION}，请求为 ${packageVersion}`,
      { expected: V3_PACKAGE_VERSION, received: packageVersion }
    );
  }

  const adventure = asObject(body.adventure, "adventure");
  if (adventure.schema_version !== 3) {
    fail("adventure.schema_version 必须是 3", { received: adventure.schema_version });
  }
  if (!Number.isInteger(adventure.revision) || adventure.revision < 0) {
    fail("adventure.revision 非法");
  }
  asObject(adventure.campaign, "adventure.campaign");

  const operation = asObject(body.operation, "operation");
  asString(operation.request_id, "operation.request_id");
  if (!OPERATION_TYPES.includes(operation.type)) {
    fail(`非法 operation.type：${operation.type}`, { allowed: OPERATION_TYPES });
  }
  const templateName = asString(operation.expected_template_name, "operation.expected_template_name");
  if (!TEMPLATE_NAMES.includes(templateName)) {
    fail(`非法 operation.expected_template_name：${templateName}`, { allowed: TEMPLATE_NAMES });
  }
  if (!OPERATION_TEMPLATES[operation.type].includes(templateName)) {
    fail(`operation 与模板不匹配：${operation.type} 不能使用「${templateName}」`, {
      operation: operation.type,
      expected_template_name: templateName,
      allowed: OPERATION_TEMPLATES[operation.type]
    });
  }

  return { packageVersion, adventure, operation };
}

/**
 * 按 operation 做装配提示词前的预迁移。
 *
 * v3 引擎的 validateRequest 会校验 pending 快照与 operation 的一致性，
 * 因此部分操作必须先在 runtime 上落一步迁移，否则直接装配会被拒绝。
 *
 * 返回 { adventure, runtime, migrated }：
 *   - migrated 标记本次是否改变了 runtime（choose / battle_result / next_round 会改变）。
 *   - 改变后的 runtime 必须原样回传客户端，客户端不能自行推算 state_version。
 */
export function premigrateV3(adventure, operation) {
  const runtime = adventure.runtime;
  if (!runtime) {
    fail("当前没有活动章节，无法发起请求");
  }
  const pending = runtime.pending_interaction ?? null;
  const phase = pending?.phase ?? null;

  // ⚠️ 引擎抛的是原生 Error，统一包装成 V3ContractError，
  //    让上层能区分「参数非法」与「服务端故障」。
  try {
    switch (operation.type) {
      case "choose": {
        // 已是 awaiting_settlement_commit：说明选项已选过，引擎会自行校验快照一致性。
        if (phase !== "awaiting_choice") {
          return { adventure, runtime, migrated: false };
        }
        const selected = R.selectOption(runtime, operation.option_id);
        return {
          adventure: { ...adventure, runtime: selected },
          runtime: selected,
          migrated: true
        };
      }
      case "battle_result": {
        if (phase === "awaiting_battle_result") {
          const after = R.acceptBattleResult(runtime, operation.battle_result);
          return {
            adventure: { ...adventure, runtime: after },
            runtime: after,
            migrated: true
          };
        }
        return { adventure, runtime, migrated: false };
      }
      case "next_round": {
        // nextRound 会推进轮数、扣减补给并可能触发硬失败，必须由服务端执行。
        if (runtime.run_status !== "ongoing" || pending !== null) {
          return { adventure, runtime, migrated: false };
        }
        const advanced = R.nextRound(runtime);
        return {
          adventure: { ...adventure, runtime: advanced },
          runtime: advanced,
          migrated: true
        };
      }
      default:
        return { adventure, runtime, migrated: false };
    }
  } catch (error) {
    if (error instanceof V3ContractError) throw error;
    fail(error.message, { operation: operation.type, cause: error.name ?? "Error" });
  }
}

/**
 * 装配 v3 提示词。
 *
 * 复用 v3 引擎的 adventure.mjs#prepareAdventureMessages，因此：
 *   - check() 会校验存档 revision、campaign 章节游标、run 归属；
 *   - runtime.mjs#prepareAiMessages 会校验 operation 与 pending 的一致性；
 *   - prompt 组装按模式裁剪（event_generation / active_event / finale）。
 */
export function prepareV3Prompt(body) {
  const { adventure, operation } = validateV3Request(body);
  if (!adventure.runtime) {
    fail("当前没有活动章节，无法发起请求");
  }

  // 先预迁移，再装配（见 premigrateV3 注释）
  const pre = premigrateV3(adventure, operation);

  let prepared;
  try {
    prepared = A.prepareAdventureMessages(pre.adventure, operation, {
      expectedRevision: adventure.revision
    });
  } catch (error) {
    fail(error.message, { adventure_revision: adventure.revision });
  }

  const messages = Object.freeze([
    Object.freeze({ role: "system", content: prepared.systemPrompt }),
    Object.freeze({ role: "user", content: prepared.userPrompt })
  ]);

  return {
    messages,
    systemPrompt: prepared.systemPrompt,
    userPrompt: prepared.userPrompt,
    contextScope: prepared.contextScope,
    requestGuard: prepared.requestGuard,
    requestId: operation.request_id,
    operationType: operation.type,
    expectedTemplateName: operation.expected_template_name,
    chapterId: adventure.runtime.chapter_id,
    // 预迁移后的 adventure（含 state_version 变化），装配阶段必须与推进阶段保持一致。
    premigratedAdventure: pre.adventure,
    premigrated: pre.migrated,
    // 供日志/指纹使用；不含 reward_requests 等内部字段。
    fingerprintSource: {
      campaign_id: adventure.campaign.campaign_id,
      campaign_revision: adventure.campaign.revision,
      adventure_revision: adventure.revision,
      run_id: adventure.runtime.run_id,
      chapter_id: adventure.runtime.chapter_id,
      state_version: adventure.runtime.state_version,
      operation: {
        type: operation.type,
        request_id: operation.request_id,
        event_id: operation.event_id ?? null,
        option_id: operation.option_id ?? null,
        forced_event_id: operation.forced_event_id ?? null
      }
    }
  };
}

/**
 * 解析并校验 AI 输出的 YAML 文档。
 *
 * 服务端做权威校验（capabilities.server_validates_output = true）：
 *   1. 受限 YAML 解析（v3 parser）；
 *   2. 五模板 Schema 校验；
 *   3. 模板名必须与 operation.expected_template_name 一致。
 *
 * ⚠️ 校验失败必须抛出，绝不能推进任何状态（v3 要求「失败输出不可作为成功缓存」）。
 */
export function parseV3Output(rawYaml, operation) {
  const expectedTemplateName = operation.expected_template_name;
  let document;
  try {
    document = parseRestrictedYaml(rawYaml);
  } catch (error) {
    throw new V3OutputError(`AI 输出不是合法协议文档：${error.message}`, {
      stage: "yaml_parse",
      cause: error.code ?? null
    });
  }

  let validated;
  try {
    validated = validateAdventureTemplate(document, {
      expectedTemplateName,
      expectedEventId: operation.event_id ?? undefined
    });
  } catch (error) {
    throw new V3OutputError(`AI 输出未通过模板校验：${error.message}`, {
      stage: "schema_validate",
      cause: error.code ?? null
    });
  }

  return validated;
}

/**
 * AI 输出通过校验后推进状态，返回下一版 adventure。
 *
 * ⚠️ 必须在 AI 输出完全合法时调用；非法输出绝不能推进任何状态
 *    （v3 要求「失败输出不可作为成功缓存」）。
 *
 * @param {object} premigratedAdventure prepareV3Prompt 返回的 premigratedAdventure
 */
export function advanceV3(premigratedAdventure, operation, aiOutput) {
  const runtime = premigratedAdventure.runtime;
  if (!runtime) {
    fail("当前没有活动章节，无法推进状态");
  }

  let nextRuntime;
  switch (operation.type) {
    case "start":
    case "next_round": {
      nextRuntime = R.acceptNewEvent(runtime, aiOutput);
      break;
    }
    case "choose": {
      // 直选（direct）选项的结算模板本身就是结算输出，必须直接 commitSettlement。
      // 走 acceptResolution 会把 phase 置为 awaiting_battle_result 并卡死。
      if (operation.expected_template_name === "结算") {
        nextRuntime = R.commitSettlement(runtime, aiOutput, {
          requestId: operation.request_id,
          expectedVersion: runtime.state_version
        });
      } else {
        nextRuntime = R.acceptResolution(runtime, aiOutput);
      }
      break;
    }
    case "settle_check": {
      nextRuntime = R.commitSettlement(runtime, aiOutput, {
        requestId: operation.request_id,
        expectedVersion: runtime.state_version
      });
      break;
    }
    case "battle_result": {
      nextRuntime = R.commitSettlement(runtime, aiOutput, {
        requestId: operation.request_id,
        expectedVersion: runtime.state_version
      });
      break;
    }
    case "finale": {
      // 终章不改变进度，只作为归档素材。归档由 close_chapter 动作触发。
      return { adventure: premigratedAdventure, changed: false };
    }
    default:
      fail(`未知 operation.type：${operation.type}`);
  }

  const next = A.updateAdventure(premigratedAdventure, nextRuntime, {
    expectedRevision: premigratedAdventure.revision
  });
  return { adventure: next, changed: true };
}

/**
 * 非 AI 状态迁移（控制通道）。这些动作不请求模型，只做纯状态推进。
 *
 * action 取值：
 *   create        → 创建新 adventure（campaignId）
 *   continue      → 进入/续玩唯一合法章
 *   close_chapter → 章节归档（finaleOutput 可选，缺失时按真实事实兜底）
 *   restart       → 整次重开（全新 campaignId）
 *   confirm_reward→ 永久奖励回执确认
 *   view          → 只读视图（不改变存档）
 */
export function transitionV3(body) {
  asObject(body, "请求体");
  const packageVersion = asString(body.package_version, "package_version");
  if (packageVersion !== V3_PACKAGE_VERSION) {
    fail(
      `包版本不匹配：服务端为 ${V3_PACKAGE_VERSION}，请求为 ${packageVersion}`,
      { expected: V3_PACKAGE_VERSION, received: packageVersion }
    );
  }
  const action = asString(body.action, "action");
  const args = body.args ?? {};

  let next;
  // ⚠️ v3 引擎抛的是原生 Error（无 code）。统一包装成 V3ContractError，
  //    否则控制通道的错误码会退化成 TRANSITION_FAILED，客户端无法区分
  //    「参数非法」与「存档过期」。
  try {
    switch (action) {
      case "create": {
        const campaignId = asString(args.campaignId, "args.campaignId");
        next = A.createAdventure(campaignId);
        break;
      }
      case "continue": {
        const current = asObject(body.adventure, "adventure");
        // ⚠️ 必须把 args 原样透传给引擎，由引擎负责拒绝选章参数 / replay 等非法入口。
        //    若在适配层白名单过滤，客户端传 chapterId 就会被静默忽略。
        const continueArgs = Object.fromEntries(
          Object.entries(args).filter(([, value]) => value !== undefined)
        );
        next = A.continueAdventure(current, {
          ...continueArgs,
          expectedRevision: current.revision
        });
        break;
      }
      case "close_chapter": {
        const current = asObject(body.adventure, "adventure");
        next = A.closeAdventureChapter(current, {
          expectedRevision: current.revision,
          ...(args.finaleOutput ? { finaleOutput: args.finaleOutput } : {})
        });
        break;
      }
      case "restart": {
        const current = asObject(body.adventure, "adventure");
        const campaignId = asString(args.campaignId, "args.campaignId");
        next = A.restartAdventure(current, {
          campaignId,
          expectedRevision: current.revision
        });
        break;
      }
      case "confirm_reward": {
        const current = asObject(body.adventure, "adventure");
        const runtime = current.runtime;
        if (!runtime) fail("当前没有活动章节，无法确认奖励");
        const claimKey = asString(args.claim_key, "args.claim_key");
        const status = asString(args.status, "args.status");
        const nextRuntime = E.confirmPermanentReward(runtime, {
          claim_key: claimKey,
          status,
          ...(args.reward ? { reward: args.reward } : {})
        });
        next = A.updateAdventure(current, nextRuntime, {
          expectedRevision: current.revision
        });
        break;
      }
      case "view": {
        // 只读视图：返回八章卡状态，不改变存档。
        const current = asObject(body.adventure, "adventure");
        next = { adventure: current };
        break;
      }
      default:
        fail(`未知 action：${action}`);
    }
  } catch (error) {
    if (error instanceof V3ContractError) throw error;
    fail(error.message, { action, cause: error.name ?? "Error" });
  }

  const adventure = next.adventure ?? next;
  let view;
  try {
    view = A.getAdventureView(adventure);
  } catch (error) {
    // getAdventureView 也会跑 check()（存档一致性），失败必须包装成契约错误。
    if (error instanceof V3ContractError) throw error;
    fail(error.message, { action, stage: "view", cause: error.name ?? "Error" });
  }
  return {
    adventure,
    view,
    ...(next.pending_reward_requests
      ? { pending_reward_requests: next.pending_reward_requests }
      : {}),
    ...(next.archive ? { archive: next.archive } : {})
  };
}

/**
 * 供服务端做影子校验（不改变流）：用 v3 引擎复核 AI 输出。
 * 违规只记录日志，由客户端决定如何处理。
 */
export function shadowValidateOutput(adventure, operation, output) {
  const runtime = adventure?.runtime;
  if (!runtime || !output) return { ok: false, reason: "缺少runtime或输出" };
  try {
    switch (operation.type) {
      case "start":
      case "next_round": {
        const next = R.acceptNewEvent(runtime, output);
        return { ok: true, stateVersion: next.state_version };
      }
      case "choose": {
        const selected = R.selectOption(runtime, operation.option_id);
        if (operation.expected_template_name === "结算") {
          const next = R.commitSettlement(selected, output, {
            requestId: operation.request_id,
            expectedVersion: selected.state_version
          });
          return { ok: true, stateVersion: next.state_version };
        }
        const next = R.acceptResolution(selected, output);
        return { ok: true, stateVersion: next.state_version };
      }
      case "battle_result": {
        const accepted = R.acceptBattleResult(runtime, operation.battle_result);
        const next = R.commitSettlement(accepted, output, {
          requestId: operation.request_id,
          expectedVersion: accepted.state_version
        });
        return { ok: true, stateVersion: next.state_version };
      }
      case "settle_check": {
        const next = R.commitSettlement(runtime, output, {
          requestId: operation.request_id,
          expectedVersion: runtime.state_version
        });
        return { ok: true, stateVersion: next.state_version };
      }
      case "finale": {
        return { ok: true, stateVersion: runtime.state_version };
      }
      default:
        return { ok: false, reason: `未知 operation.type：${operation.type}` };
    }
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** 章节清单，供 /api/capabilities 与客户端对齐。 */
export function chapterSummaries() {
  return R.chapters.map(chapter => ({
    id: chapter.id,
    index: chapter.index,
    name: chapter.name,
    count: chapter.count,
    gold_gain_cap: chapter.economy.gold_gain_cap,
    material_slots: chapter.economy.material_slots,
    relic_slots: chapter.economy.relic_slots,
    bond_slots: chapter.economy.bond_slots,
    equipment_slots: chapter.economy.equipment_slots
  }));
}
