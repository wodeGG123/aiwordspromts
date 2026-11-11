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
import {
  applyAuthoritativeFill,
  authorityPromptBlock,
  buildAuthority
} from "./v3_authoritative.mjs";

export const V3_PACKAGE_VERSION = R.version;

/**
 * 奖励周期标识（D6）：按自然日 `daily:YYYY-MM-DD`。
 *
 * ⚠️ 以**服务端**日期为准（R9：客户端时区可能与服务端不一致），
 *    客户端也可以在 `args.rewardCycleId` 里显式覆盖（例如离线补登时
 *    需要与账号服务端对齐时区）。
 */
export function dailyRewardCycleId(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `daily:${year}-${month}-${day}`;
}

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
 * 归一化客户端回传的 runtime，补齐「缺失但引擎按严格 null 判定」的字段。
 *
 * ⚠️ 背景（2026-11-09 线上事故）：
 *    v3 引擎 `runtime.mjs#validateRequest` 用
 *    `r.pending_interaction === null` 判断「当前没有待处理交互」。
 *    Dart 端早期实现把 null 字段整个 key 省略，回传后该字段变成
 *    `undefined`，严格比较失败 → `start` / `next_round` 被误判为
 *    「新事件状态非法」，且错误信息完全指不到真实原因。
 *
 *    服务端是权威方，不应该因为客户端少写了一个 null key 就拒绝请求，
 *    因此在信任边界统一补齐。
 */
function normalizeRuntime(runtime) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    return runtime;
  }
  const next = { ...runtime };
  // pending_interaction：缺失 / undefined → 显式 null。
  if (!("pending_interaction" in next) || next.pending_interaction === undefined) {
    next.pending_interaction = null;
  }
  // applied_request_ids：缺失 → 空数组（幂等键表）。
  if (!("applied_request_ids" in next) || next.applied_request_ids === undefined) {
    next.applied_request_ids = [];
  }
  // reward_requests：缺失 → 空数组（章节关闭前检查 pending 预留）。
  if (!("reward_requests" in next) || next.reward_requests === undefined) {
    next.reward_requests = [];
  }
  return next;
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
  // 归一化 runtime：补齐客户端可能省略的 null 字段（见 normalizeRuntime 注释）。
  if (adventure.runtime !== undefined && adventure.runtime !== null) {
    asObject(adventure.runtime, "adventure.runtime");
    adventure.runtime = normalizeRuntime(adventure.runtime);
  }

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

  // ── 硬失败短路（P0-2）────────────────────────────────────────
  // ⚠️ 背景：`next_round` 预迁移会执行 `nextRound()`，它在补给耗尽 /
  //    腐化拉满 / 全队失能时把 `run_status` 置为 `failed`。
  //    此时若继续装配提示词，引擎的 `validateRequest` 会因
  //    `run_status !== 'ongoing'` 抛「新事件状态非法」（400），
  //    服务端**不会下发任何状态**，客户端存档永远停在 `ongoing`，
  //    玩家点多少次重试都没用 —— 永久卡死。
  //
  //    按每章补给曲线（normal 难度每轮 -1），每章第 16~17 轮起都可能硬失败，
  //    属于常规玩法路径，不是边缘情况。
  //
  //    正确做法：硬失败时**跳过模型调用**，直接下发终局状态，
  //    让客户端走章末流程（终章回顾 → close_chapter → failCampaign）。
  if (pre.migrated && pre.runtime.run_status !== "ongoing") {
    return {
      messages: Object.freeze([]),
      systemPrompt: "",
      userPrompt: "",
      contextScope: null,
      requestGuard: buildRequestGuard(adventure),
      requestId: operation.request_id,
      operationType: operation.type,
      expectedTemplateName: operation.expected_template_name,
      chapterId: adventure.runtime.chapter_id,
      premigratedAdventure: pre.adventure,
      premigrated: true,
      // ⚠️ 硬失败标记：路由层据此跳过模型调用，直接下发状态。
      hardFail: {
        run_status: pre.runtime.run_status,
        reason: "chapter_hard_failed"
      },
      authority: null,
      fingerprintSource: buildFingerprintSource(adventure, operation)
    };
  }

  let prepared;
  try {
    prepared = A.prepareAdventureMessages(pre.adventure, operation, {
      expectedRevision: adventure.revision
    });
  } catch (error) {
    fail(error.message, { adventure_revision: adventure.revision });
  }

  // ── 权威填空表（Part 2 方案 A：提示词注入）────────────────────
  // ⚠️ 必须在预迁移之后计算：next_round 的轮数/补给、choose 的选中选项、
  //    battle_result 的战斗结果都只有在预迁移后的 runtime 上才是真值。
  const authority = buildAuthority(pre.runtime, operation);
  const authorityBlock = authorityPromptBlock(authority);
  const userPrompt = authorityBlock
    ? `${prepared.userPrompt}\n\n${authorityBlock}`
    : prepared.userPrompt;

  const messages = Object.freeze([
    Object.freeze({ role: "system", content: prepared.systemPrompt }),
    Object.freeze({ role: "user", content: userPrompt })
  ]);

  return {
    messages,
    systemPrompt: prepared.systemPrompt,
    userPrompt,
    contextScope: prepared.contextScope,
    requestGuard: prepared.requestGuard,
    requestId: operation.request_id,
    operationType: operation.type,
    expectedTemplateName: operation.expected_template_name,
    chapterId: adventure.runtime.chapter_id,
    // 预迁移后的 adventure（含 state_version 变化），装配阶段必须与推进阶段保持一致。
    premigratedAdventure: pre.adventure,
    premigrated: pre.migrated,
    // 权威填空表（供日志观察，也供服务端归一化复用同一真值来源）。
    authority,
    // 供日志/指纹使用；不含 reward_requests 等内部字段。
    fingerprintSource: buildFingerprintSource(adventure, operation)
  };
}

/**
 * 构造 request_guard（客户端用来丢弃过期回包）。
 *
 * 与引擎 `adventure.mjs#prepareAdventureMessages` 的口径保持一致。
 */
function buildRequestGuard(adventure) {
  return {
    session_revision: adventure.revision,
    campaign_id: adventure.campaign.campaign_id,
    run_id: adventure.runtime.run_id,
    state_version: adventure.runtime.state_version
  };
}

/**
 * 构造幂等指纹来源（不含 reward_requests 等内部字段）。
 */
function buildFingerprintSource(adventure, operation) {
  return {
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
  };
}

/**
 * 预解析容错：把「裸键 + 无子节点」的空集合键补成内联空数组/空对象。
 *
 * ⚠️ 背景（2026-11-09 线上事故，Round 24 `choose`）：
 *    模型把空列表写成裸键：
 *        remove_flags:
 *        unresolved_hooks_added:
 *    受限 YAML 子集里，键后面没有值、也没有缩进子节点时，
 *    `parseRestrictedYaml` 直接抛 `YAML_CHILD_INDENT`
 *    （`键remove_flags缺少缩进为6的子节点`），**整份输出被丢弃**。
 *    而这一步发生在权威归一化**之前**，归一化根本没有机会救回来。
 *
 *    正确写法是内联空数组：`remove_flags: []`。
 *
 * 处理策略（保守）：
 *   1. 只处理「键后面既没有值、后面也没有任何子节点」的情况；
 *   2. 只在已知可能为空的机器字段白名单里补，且只补成 **空数组 `[]`**；
 *      不认识的裸键一律不动，让 schema 校验按原样报错（避免掩盖真实缺陷）；
 *   3. 补完仍然解析不了 → 原样抛出原始错误，不吞。
 *
 * @returns {{yaml: string, repaired: string[]}} 修复后的 YAML 与被修复的键名
 */
const REPAIRABLE_EMPTY_LIST_KEYS = new Set([
  "add_flags",
  "remove_flags",
  "run_modifier_ids",
  "npc_state_updates",
  "memory_notes",
  "unresolved_hooks_added",
  "unresolved_hooks_resolved",
  "permanent_rewards"
]);

export function repairBareEmptyListKeys(rawYaml) {
  if (typeof rawYaml !== "string" || !rawYaml.includes(":")) {
    return { yaml: rawYaml, repaired: [] };
  }
  const lines = rawYaml.split(/\r?\n/);
  const repaired = [];
  const output = lines.map((line, index) => {
    // 只匹配「整行只有一个裸键」：`  remove_flags:`
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*$/);
    if (!match) return line;
    const [, indent, key] = match;
    if (!REPAIRABLE_EMPTY_LIST_KEYS.has(key)) return line;
    // 下一行若存在且缩进更深，说明本来就有子节点，不是空集合 → 不动。
    const next = lines[index + 1];
    if (next !== undefined) {
      const nextIndent = next.match(/^ */)[0].length;
      const nextIsBlank = next.trim() === "";
      if (!nextIsBlank && nextIndent > indent.length) return line;
    }
    repaired.push(key);
    return `${indent}${key}: []`;
  });
  return { yaml: output.join("\n"), repaired };
}

/**
 * 解析并校验 AI 输出的 YAML 文档。
 *
 * 服务端做权威校验（capabilities.server_validates_output = true）：
 *   1. 受限 YAML 解析（v3 parser）；
 *   2. **权威归一化**（Part 2 方案 B）：把程序可推导的机器字段替换为真值；
 *   3. 五模板 Schema 校验；
 *   4. 模板名必须与 operation.expected_template_name 一致。
 *
 * ⚠️ 校验失败必须抛出，绝不能推进任何状态（v3 要求「失败输出不可作为成功缓存」）。
 *
 * @param {string} rawYaml AI 输出的原始 YAML
 * @param {object} operation 请求里的 operation
 * @param {object} [runtime] 预迁移后的 runtime；提供时会启用权威归一化。
 *        ⚠️ 必须是**预迁移后**的 runtime：next_round 的轮数、choose 的选中选项、
 *           battle_result 的战斗结果只有在预迁移后才确定。
 */
export function parseV3Output(rawYaml, operation, runtime = null) {
  const expectedTemplateName = operation.expected_template_name;

  // 预解析容错：先把「裸键空集合」补成内联 `[]`，再交给严格解析器。
  // ⚠️ 归一化在解析**之后**，因此这一步必须在前，否则空集合字段会让
  //    整份输出在 YAML 阶段就被丢掉（线上 Round 24 事故）。
  const repaired = repairBareEmptyListKeys(rawYaml);
  let document;
  try {
    document = parseRestrictedYaml(repaired.yaml);
  } catch (error) {
    throw new V3OutputError(`AI 输出不是合法协议文档：${error.message}`, {
      stage: "yaml_parse",
      cause: error.code ?? null,
      repaired_keys: repaired.repaired
    });
  }

  // 权威归一化：把机器字段换成程序真值，模型只需要写叙事。
  // ⚠️ 归一化失败（拿不到授权）时保持原样，交给后续 schema/引擎校验报错，
  //    不在这里吞掉真实缺陷。
  let repairs = [];
  if (runtime) {
    try {
      const filled = applyAuthoritativeFill(document, runtime, operation);
      document = filled.document;
      repairs = filled.repairs;
    } catch {
      document = parseRestrictedYaml(rawYaml);
    }
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
      cause: error.code ?? null,
      repairs
    });
  }

  if (repairs.length) {
    // ⚠️ 直接挂在根对象上：schema 校验已完成，后续引擎只读 event_details。
    validated.__repairs = repairs;
  }

  return validated;
}

/**
 * B 方案：把结算输出里的 `npc_state_updates` 强制对齐到事件表授权值。
 *
 * ⚠️ 背景（2026-11-09 线上事故，3 次 `NPC变化未获授权`）：
 *    引擎 `runtime.mjs#commitSettlement` 做的是**严格 JSON 全等**比较
 *    （`JSON.stringify(patch.npc_state_updates) === JSON.stringify(fx.npc_updates)`），
 *    顺序敏感、不允许任何偏差。而全库 1747 个 result 里 1717 个 `npc_updates` 为空数组，
 *    提示词却教 AI「关系阶梯」「移动一级」，结算模板示例本身还写了一个非空 NPC 变更，
 *    于是 AI 几乎必然写出非空数组 → 结算被拒 → 状态不推进 → 玩家卡在当前轮。
 *
 *    A 方案（收紧提示词）能降低发生概率，但**不能保证 0**：模型服从度不可控，
 *    而这一个字段的偏差会让整局冒险卡死。因此服务端在信任边界做权威归一化：
 *    以事件表 `options.results[outcome].npc_updates` 为唯一真值覆盖 AI 输出。
 *
 * 设计约束：
 *   1. **只改这一个字段**。其余字段（summary / flags / route_delta / memory_notes…）
 *      仍走引擎原有校验，AI 写错照样被拒——不做过度兜底，避免掩盖真实缺陷。
 *   2. **只覆盖，不合并**。引擎要求全等，合并语义不存在。
 *   3. **授权解析失败时不动手**。此时交给引擎抛出它自己的错误信息，
 *      避免用兜底逻辑掩盖「事件/选项/outcome 本身非法」这类更严重的问题。
 *   4. 归一化结果会回写给客户端（routes.mjs 下发的 `output`），
 *      保证服务端存档与客户端展示口径一致。
 *
 * @returns {{output: object, changed: boolean, repair: object|null}}
 */
export function normalizeSettlementNpcUpdates(runtime, output) {
  const patch = output?.event_details?.story_patch;
  if (!patch || !Array.isArray(patch.npc_state_updates)) {
    return { output, changed: false, repair: null };
  }

  let authorized;
  try {
    authorized = R.settlementEffect(runtime, patch.outcome).effect.npc_updates ?? [];
  } catch {
    // 授权本身取不到（事件/选项/outcome 不合法）→ 不归一化，让引擎按原逻辑报错。
    return { output, changed: false, repair: null };
  }

  const current = patch.npc_state_updates;
  if (JSON.stringify(current) === JSON.stringify(authorized)) {
    return { output, changed: false, repair: null };
  }

  const normalized = structuredClone(output);
  normalized.event_details.story_patch.npc_state_updates = structuredClone(authorized);
  return {
    output: normalized,
    changed: true,
    repair: {
      field: "story_patch.npc_state_updates",
      outcome: patch.outcome,
      event_id: patch.completed_event_id ?? null,
      ai_value: current,
      authorized_value: authorized
    }
  };
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

  // B 方案：结算类操作先做 npc_state_updates 权威归一化，再交给引擎校验。
  // ⚠️ 归一化只作用于「结算」模板；新事件/检定/战斗模板没有这个字段。
  let effectiveOutput = aiOutput;
  let repair = null;
  if (operation.expected_template_name === "结算") {
    const normalized = normalizeSettlementNpcUpdates(runtime, aiOutput);
    effectiveOutput = normalized.output;
    repair = normalized.repair;
  }

  let nextRuntime;
  switch (operation.type) {
    case "start":
    case "next_round": {
      // ── 硬失败短路（P0-2）────────────────────────────────────
      // ⚠️ `next_round` 的预迁移（`nextRound()`）可能把 `run_status` 置为
      //    `failed`（补给耗尽 / 腐化拉满 / 全队失能）。
      //    此时 `acceptNewEvent` 会抛「已有交互或章节已结束」，客户端拿不到
      //    任何状态 → 永久卡死。
      //
      //    正确做法：直接接受预迁移后的 runtime（它已经带着 failed 状态），
      //    不生成新事件，让客户端走章末流程。
      //
      //    ⚠️ 这里**不能**走 `A.updateAdventure`：它的 `state_version` 必须
      //    **严格大于**旧值，而预迁移后的 runtime 与旧 runtime 是同一份
      //    （nextRound 已在预迁移阶段自增过 state_version），会抛
      //    「重复或过期运行态，不允许回滚」。因此这里只推进 adventure.revision。
      if (runtime.run_status !== "ongoing") {
        return {
          adventure: { ...premigratedAdventure, revision: premigratedAdventure.revision + 1 },
          changed: true,
          output: null,
          repair
        };
      }
      nextRuntime = R.acceptNewEvent(runtime, effectiveOutput);
      break;
    }
    case "choose": {
      // 直选（direct）选项的结算模板本身就是结算输出，必须直接 commitSettlement。
      // 走 acceptResolution 会把 phase 置为 awaiting_battle_result 并卡死。
      if (operation.expected_template_name === "结算") {
        nextRuntime = R.commitSettlement(runtime, effectiveOutput, {
          requestId: operation.request_id,
          expectedVersion: runtime.state_version
        });
      } else {
        nextRuntime = R.acceptResolution(runtime, effectiveOutput);
      }
      break;
    }
    case "settle_check": {
      nextRuntime = R.commitSettlement(runtime, effectiveOutput, {
        requestId: operation.request_id,
        expectedVersion: runtime.state_version
      });
      break;
    }
    case "battle_result": {
      nextRuntime = R.commitSettlement(runtime, effectiveOutput, {
        requestId: operation.request_id,
        expectedVersion: runtime.state_version
      });
      break;
    }
    case "finale": {
      // 终章不改变进度，只作为归档素材。归档由 close_chapter 动作触发。
      return {
        adventure: premigratedAdventure,
        changed: false,
        output: stripInternalFields(effectiveOutput),
        repair
      };
    }
    default:
      fail(`未知 operation.type：${operation.type}`);
  }

  const next = A.updateAdventure(premigratedAdventure, nextRuntime, {
    expectedRevision: premigratedAdventure.revision
  });
  return { adventure: next, changed: true, output: stripInternalFields(effectiveOutput), repair };
}

/**
 * 剥掉服务端内部字段（`__repairs`）后再下发给客户端。
 *
 * ⚠️ 客户端只展示与落盘协议文档，不应看到服务端的修复痕迹。
 */
function stripInternalFields(output) {
  if (!output || typeof output !== "object") return output;
  if (!("__repairs" in output)) return output;
  const next = { ...output };
  delete next.__repairs;
  return next;
}

/**
 * 为 `continue` 动作构造权威的 reward_state。
 *
 * ⚠️ 为什么必须服务端构造（D10 + D6）：
 *   - 客户端事件目录是 schedule-only，**没有**章节 economy 配置，
 *     无法算出 `gold_gain_cap` / 各 `*_slots` 额度；
 *   - `createRewardState` 要求 `cycle_id` 是自然日周期（D6），
 *     客户端与服务端时区可能不一致（R9），以服务端为准。
 *
 * 返回 null 表示「不需要注入」（例如只是续玩同一个进行中的 run，
 * 引擎会直接返回副本，reward_state 原样保留）。
 */
function buildRewardStateForContinue(current, args) {
  const runtime = current.runtime;
  // 续玩进行中的 run：引擎走 copy(s) 分支，不需要新账本。
  if (runtime && runtime.run_status === "ongoing") return null;

  // 目标章节 = 已归档章数（+ 本次将被归档的 cleared 章）。
  const records = current.campaign.chapter_results?.length ?? 0;
  const targetIndex = runtime && runtime.run_status === "cleared" ? records + 1 : records;
  const chapter = R.chapters[targetIndex];
  if (!chapter) return null;

  const cycleId = typeof args.rewardCycleId === "string" && args.rewardCycleId
    ? args.rewardCycleId
    : dailyRewardCycleId();

  // 账本继承（D6 + 同周期不重置）：
  //   - **跨周期**：用 previous 保留 lifetime 领取键（引擎的 createRewardState
  //     只在周期不同时接受 previous）。
  //   - **同周期**（例如玩家当天失败后「从第一章重开」）：**必须**保留原账本的
  //     claimed_reward_keys 与剩余额度，否则玩家可以反复重开刷同一章的
  //     材料/圣物/金币额度（协议：「换run_id、换seed、换campaign_id都不能
  //     恢复同周期额度」）。
  //
  // ⚠️ 引擎的 `createRewardState` 硬性要求 `previous.cycle_id !== cycleId`，
  //    同周期直接传 previous 会被它拒绝（`已有周期账本不能被重新初始化`）。
  //    因此同周期走「就地修正」：新建一份当前周期的账本，但继承原账本的
  //    领取键与剩余额度。
  const previous = args.previousRewardState;
  const sameCycle =
    previous &&
    previous.chapter_id === chapter.id &&
    previous.cycle_id === cycleId;

  if (sameCycle) {
    return reuseSameCycleRewardState(previous, chapter, cycleId);
  }

  // 跨周期重建：客户端可回传上一周期的账本用于保留 lifetime 键。
  // ⚠️ createRewardState 要求 previous.chapter_id === chapterId 且周期不同，
  //    不满足时直接忽略 previous（宁可新建也不让引擎抛错）。
  const usablePrevious = previous
    && previous.chapter_id === chapter.id
    && previous.cycle_id !== cycleId
    ? previous
    : null;

  try {
    return E.createRewardState({
      chapterId: chapter.id,
      cycleId,
      ...(usablePrevious ? { previous: usablePrevious } : {})
    });
  } catch {
    // 构造失败时不注入，让引擎用自己的错误信息说明缺什么。
    return null;
  }
}

/**
 * 同周期重开时的账本继承。
 *
 * 场景：玩家当天在 CH01 领过材料/圣物/金币额度 → 失败 → 「从第一章重开」。
 * 若此时新建一份满额账本，玩家可以在同一天把八章的永久奖励无限刷一遍。
 *
 * 做法：新建当前周期的账本（额度按章节配置初始化），然后把**原账本已消耗的
 * 部分**继承过来：
 *   - `claimed_reward_keys`：原样继承（已领过的键不能再领）；
 *   - 各 `*_slots_remaining`：取「新建值」与「原值」的较小者（已消耗的额度不恢复）；
 *   - `gold_gain_remaining`：同上；
 *   - `revealed_pending_rewards` / `granted_permanent_rewards`：原样继承。
 *
 * ⚠️ 为什么不在这里做「服务端权威持久化」：账本的唯一存储方是客户端存档
 *    （D1：客户端持存档），服务端不落盘。客户端每次 `continue` 都会回传
 *    `previousRewardState`，因此这条路径等价于「客户端把账本还回来」。
 *    若客户端没回传（例如旧版本客户端），这里会退化成新建满额账本 ——
 *    属于旧客户端的兼容缺口，不是本函数的行为问题。
 *
 * @param {object} previous 原账本（同一章、同一周期）
 * @param {object} chapter 章节配置
 * @param {string} cycleId 当前奖励周期
 * @returns {object|null} 当前周期的账本；构造失败返回 null
 */
function reuseSameCycleRewardState(previous, chapter, cycleId) {
  try {
    const fresh = E.createRewardState({
      chapterId: chapter.id,
      cycleId
    });

    const slotFields = [
      "gold_gain_remaining",
      "material_reward_slots_remaining",
      "relic_reward_slots_remaining",
      "bond_reward_slots_remaining",
      "equipment_reward_slots_remaining"
    ];

    const next = { ...fresh };
    for (const field of slotFields) {
      const remaining = Number(previous[field]);
      if (!Number.isSafeInteger(remaining) || remaining < 0) continue;
      // 已消耗的额度不恢复：取两者较小者。
      if (remaining < next[field]) next[field] = remaining;
    }

    // 已领取的键原样继承（已领过的键不能再次发放）。
    const claimed = Array.isArray(previous.claimed_reward_keys)
      ? previous.claimed_reward_keys.filter(key => typeof key === "string")
      : [];
    next.claimed_reward_keys = [...new Set(claimed)];

    if (Array.isArray(previous.revealed_pending_rewards)) {
      next.revealed_pending_rewards = previous.revealed_pending_rewards;
    }
    if (Array.isArray(previous.granted_permanent_rewards)) {
      next.granted_permanent_rewards = previous.granted_permanent_rewards;
    }
    return next;
  } catch {
    // 构造失败时不注入，让引擎用自己的错误信息说明缺什么。
    return null;
  }
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
        // D10：客户端事件目录是 schedule-only，拿不到章节 economy 配置，
        //    因此 reward_state 由服务端按章节配置权威构造（D6 周期由服务端定）。
        if (continueArgs.rewardState === undefined) {
          const injected = buildRewardStateForContinue(current, continueArgs);
          if (injected) continueArgs.rewardState = injected;
        }
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
    // ⚠️ 与 advanceV3 保持同一口径：结算类输出先做 npc_state_updates 归一化，
    //    否则影子校验会因为同一个字段报「NPC变化未获授权」而与真实推进结果矛盾。
    let effective = output;
    if (operation.expected_template_name === "结算") {
      effective = normalizeSettlementNpcUpdates(runtime, output).output;
    }
    switch (operation.type) {
      case "start":
      case "next_round": {
        const next = R.acceptNewEvent(runtime, effective);
        return { ok: true, stateVersion: next.state_version };
      }
      case "choose": {
        const selected = R.selectOption(runtime, operation.option_id);
        if (operation.expected_template_name === "结算") {
          const next = R.commitSettlement(selected, effective, {
            requestId: operation.request_id,
            expectedVersion: selected.state_version
          });
          return { ok: true, stateVersion: next.state_version };
        }
        const next = R.acceptResolution(selected, effective);
        return { ok: true, stateVersion: next.state_version };
      }
      case "battle_result": {
        const accepted = R.acceptBattleResult(runtime, operation.battle_result);
        const next = R.commitSettlement(accepted, effective, {
          requestId: operation.request_id,
          expectedVersion: accepted.state_version
        });
        return { ok: true, stateVersion: next.state_version };
      }
      case "settle_check": {
        const next = R.commitSettlement(runtime, effective, {
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
