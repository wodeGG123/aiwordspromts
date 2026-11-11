// v3 权威填空表（Authoritative Fill Table）。
//
// ── 问题背景 ────────────────────────────────────────────────
//   v3 引擎对「结算」输出做的是**严格 JSON 全等**比较：
//     - story_patch.add_flags / remove_flags 必须与事件表授权完全一致；
//     - story_patch.route_delta 必须与授权对象逐键一致；
//     - story_patch.npc_state_updates 必须逐条一致（顺序敏感）；
//     - story_patch.run_archetype / run_modifier_ids 必须原样回传；
//     - summary 里的 item 列表与 player_attr 必须与有效结果完全一致；
//     - current_round / supply_value / corruption_value 必须等于结算前快照；
//     - final_chapter 必须等于「叠加本次资源变化后的硬终局判定」。
//
//   这些字段**全部是程序可预先算出的确定值**，让模型去「猜」它们没有任何意义，
//   却正是线上「NPC变化未获授权」「未按事件授权添加flag」「结算前状态快照错误」
//   「章节结束标记错误」等拒绝的主要来源。
//
// ── 本模块的方案（两段式）────────────────────────────────────
//   A. **提示词注入**：把程序预计算的机器字段以「权威填空表」形式注入提示词，
//      模型只需「抄写」而不是「推断」。
//   B. **服务端归一化**：AI 输出先做权威填充（machine fields 全部替换为程序真值），
//      再交给 schema 校验与引擎推进。
//      注意：归一化发生在 **schema 校验之前**，因此模型写错字段类型/多写字段/
//      少写字段都能被救回；只有叙事字段（steps / analysis / content / 记忆）保留模型值。
//
// ── 边界 ────────────────────────────────────────────────────
//   1. 只覆盖**程序 100% 可推导**的机器字段；叙事字段一律不动。
//   2. 事件选择仍由模型决定（引擎允许在候选内自选），但会校验候选合法性；
//      非法候选会被替换为程序按同一公式算出的合法候选，并留痕。
//   3. 每次归一化都会产生 repairs 记录，供服务端日志观察模型服从度。
import * as R from "./vendor/v3/src/runtime.mjs";

const copy = (x) => structuredClone(x);

/** 属性键 → 玩家可见中文名（与引擎提示词一致）。 */
export const ATTRIBUTE_LABELS = Object.freeze({
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  constitution: "体力",
  physique: "体魄",
  dexterity: "灵巧",
  perception: "感知",
  knowledge: "学识",
  survival: "生存",
  social: "社交",
  authority: "威严",
  deception: "狡诈"
});

/** 档位 → 检定难度修正（引擎提示词：normal+0 / hard+2 / nightmare+4）。 */
const DIFFICULTY_MODIFIER = Object.freeze({ normal: 0, hard: 2, nightmare: 4 });

/** 事件表内部检定模式 → 输出协议 check_type。 */
const CHECK_TYPE_BY_MODE = Object.freeze({
  standard_fixed: "常规检定",
  standard_auto: "常规检定",
  hidden_attribute: "隐藏检定",
  hidden_context: "隐藏检定"
});

/** 事件表内部 resolution_type → 输出协议 template_name。 */
const TEMPLATE_BY_RESOLUTION = Object.freeze({
  check: "检定",
  battle: "战斗事件",
  direct: "结算"
});

/** 检定结果（中文） → story_patch.outcome。 */
const OUTCOME_BY_CHECK_RESULT = Object.freeze({
  大成功: "great_success",
  成功: "success",
  失败: "failure"
});

const CURRENT_TYPE_BY_KIND = Object.freeze({
  main: "主线事件",
  hidden: "隐藏事件",
  random: "随机事件"
});

function textOr(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// ── 检定基础计算 ────────────────────────────────────────────

/** 检定难度：base_difficulty + 档位修正，限制 0-20。 */
export function checkDifficultyFor(runtime, option) {
  const base = Number.isInteger(option?.base_difficulty) ? option.base_difficulty : 10;
  const modifier = DIFFICULTY_MODIFIER[runtime?.run_difficulty] ?? 0;
  return Math.min(20, Math.max(0, base + modifier));
}

/** 检定后缀：常规显示属性名，隐藏显示「（隐藏检定）」。 */
export function checkSuffixFor(option) {
  const mode = option?.check_mode ?? "standard_fixed";
  if (mode === "hidden_attribute" || mode === "hidden_context") return "（隐藏检定）";
  const label = ATTRIBUTE_LABELS[option?.attribute];
  return label ? `（${label}检定）` : "";
}

/** 事件表选项 → 权威选项块（字段顺序与协议完全一致）。 */
export function authoritativeOptionBlock(runtime, event) {
  return event.options.map((option) => {
    const block = {
      text: `${option.text}${option.resolution_type === "check" ? checkSuffixFor(option) : ""}`,
      id: option.id,
      template_name: TEMPLATE_BY_RESOLUTION[option.resolution_type],
      visible: true,
      available: R.optionAvailable(runtime, option)
    };
    if (option.resolution_type === "check") {
      block.check_type = CHECK_TYPE_BY_MODE[option.check_mode] ?? "常规检定";
      block.check_difficulty = checkDifficultyFor(runtime, option);
    }
    return block;
  });
}

/** 事件目标场景名（程序锁定，模型不得自造）。 */
export function sceneNameForEvent(event) {
  const sceneId = event?.asset_scope?.scenes?.[0];
  const scene = sceneId ? R.assets.scenes[sceneId] : null;
  return scene?.name ?? "";
}

/** 事件 → current_type。 */
export function currentTypeForEvent(event) {
  return CURRENT_TYPE_BY_KIND[event?.kind] ?? "主线事件";
}

// ── 候选事件 ────────────────────────────────────────────────

/** 本次请求允许的候选事件 ID（强制 > 客户端候选 > 引擎排期）。 */
export function candidateEventIds(runtime, operation) {
  if (isNonEmptyString(operation?.forced_event_id)) return [operation.forced_event_id];
  if (Array.isArray(operation?.event_candidates) && operation.event_candidates.length > 0) {
    return operation.event_candidates.map((candidate) => candidate?.event_id).filter(isNonEmptyString);
  }
  return R.getScheduledEventIds(runtime);
}

/**
 * 过滤掉「引擎会当场拒绝」的候选。
 *
 * ⚠️ 引擎 `acceptNewEvent` 对隐藏事件额外要求：
 *    - `requires.all_flags` 全部已获得；
 *    - 本章隐藏事件额度未用尽。
 *  排期函数不做这两项过滤，模型若选中隐藏事件会被引擎直接拒绝，
 *  因此这里提前剔除，避免「隐藏前置不足」这类确定性失败。
 */
export function validCandidateEventIds(runtime, eventIds) {
  const flags = new Set(runtime?.story_state?.story_flags ?? []);
  const hiddenUsed = (runtime?.story_state?.completed_events ?? []).some(
    (entry) => R.events?.[entry?.event_id]?.kind === "hidden"
  );
  return eventIds.filter((eventId) => {
    const event = R.events?.[eventId];
    if (!event) return false;
    if (event.kind !== "hidden") return true;
    if (hiddenUsed) return false;
    return (event.requires?.all_flags ?? []).every((flag) => flags.has(flag));
  });
}

/**
 * 程序侧的确定性事件选取（与引擎提示词给出的公式一致）。
 * 仅在模型给出非法候选时作为兜底。
 */
export function deterministicEventPick(runtime, eventIds) {
  if (!eventIds.length) return null;
  const seed = Math.abs(Number(runtime?.run_seed) || 0);
  const round = Number(runtime?.current_round) || 1;
  const completed = (runtime?.story_state?.completed_events ?? []).length;
  const point = (seed + round * 11 + completed * 7) % eventIds.length;
  return eventIds[point] ?? eventIds[0];
}

// ── 各模板的权威事实 ────────────────────────────────────────

/** 新一轮事件：候选事件 + 各自的选项块。 */
export function buildNewEventAuthority(runtime, operation) {
  const all = candidateEventIds(runtime, operation);
  const valid = validCandidateEventIds(runtime, all);
  const candidates = valid.map((eventId) => {
    const event = R.events[eventId];
    return {
      event_id: eventId,
      current_type: currentTypeForEvent(event),
      scene_name: sceneNameForEvent(event),
      options: authoritativeOptionBlock(runtime, event)
    };
  });
  return {
    template_name: "新一轮事件",
    current_round: runtime.current_round,
    supply_value: runtime.supply_value,
    corruption_value: runtime.corruption_value,
    candidates,
    /** 兜底选中值（模型给出非法候选时使用）。 */
    fallback_event_id: deterministicEventPick(runtime, valid)
  };
}

/** 检定：把引擎公式需要的全部输入算好，模型只做「优势判定 + 归一」。 */
export function buildCheckAuthority(runtime) {
  const pending = runtime?.pending_interaction ?? null;
  const event = pending ? R.events[pending.event_id] : null;
  const option = event?.options?.find((o) => o.id === pending?.option_id) ?? null;
  const team = runtime?.current_team ?? [];
  const attributeValues = {};
  for (const member of team) {
    for (const [key, value] of Object.entries(member?.attributes ?? {})) {
      if (!Number.isInteger(value)) continue;
      const current = attributeValues[key];
      if (!current || value > current.value) {
        attributeValues[key] = { value, actor: member.name };
      }
    }
  }
  const seed = Math.abs(Number(runtime?.run_seed) || 0);
  const round = Number(runtime?.current_round) || 1;
  const optionId = Number(pending?.option_id) || 0;
  const roll = (seed + round * 7 + optionId * 13) % 21;
  const corruption = Number(runtime?.corruption_value) || 0;
  const corruptionPenalty = corruption < 40 ? 0 : corruption < 60 ? 1 : corruption < 80 ? 2 : 3;
  const difficulty = option ? checkDifficultyFor(runtime, option) : null;
  return {
    template_name: "检定",
    event_id: pending?.event_id ?? null,
    option_id: pending?.option_id ?? null,
    attribute: option?.attribute ?? null,
    attribute_values: attributeValues,
    roll,
    corruption_penalty: corruptionPenalty,
    difficulty,
    success_threshold: difficulty,
    great_success_threshold: difficulty === null ? null : difficulty + 10
  };
}

/** 战斗事件：敌人名单由事件表锁定。 */
export function buildBattleAuthority(runtime) {
  const pending = runtime?.pending_interaction ?? null;
  const event = pending ? R.events[pending.event_id] : null;
  let enemies = Array.isArray(event?.enemy_names) ? event.enemy_names.slice(0, 4) : [];
  if (!enemies.length) {
    const role = event?.asset_scope?.roles?.[0];
    if (role) enemies = [role];
  }
  return {
    template_name: "战斗事件",
    event_id: pending?.event_id ?? null,
    scene_name: pending?.scene_name ?? sceneNameForEvent(event),
    current_round: runtime.current_round,
    supply_value: runtime.supply_value,
    corruption_value: runtime.corruption_value,
    enemies
  };
}

/** 结算：outcome 与全部机器字段都是程序可推导的确定值。 */
export function buildSettlementAuthority(runtime, operation) {
  const pending = runtime?.pending_interaction ?? null;
  if (!pending) return null;
  const event = R.events[pending.event_id];
  const option = event?.options?.find((o) => o.id === pending.option_id) ?? null;
  if (!event || !option) return null;

  const outcome = resolveOutcome(runtime, option);
  if (!outcome) return null;

  let effect = null;
  try {
    effect = R.settlementEffect(runtime, outcome).effect;
  } catch {
    // 授权本身取不到（道具/金币不足等）→ 不做归一化，让引擎按自己的错误说明问题。
    return null;
  }

  const resources = effect.resources ?? {};
  const items = Array.isArray(effect.items) ? effect.items : [];
  const currentFlags = runtime.story_state.story_flags ?? [];
  const addFlags = (effect.add_flags ?? []).filter((flag) => !currentFlags.includes(flag));
  const removeFlags = (effect.remove_flags ?? []).filter((flag) => currentFlags.includes(flag));

  const corruptionAfter = Math.max(0, (runtime.corruption_value ?? 0) + (resources.corruption ?? 0));
  const supplyAfter = Math.min(100, (runtime.supply_value ?? 0) + (resources.supply ?? 0));
  const hardFailure =
    corruptionAfter >= 100 ||
    supplyAfter <= 0 ||
    (runtime.team_status ?? "active") === "defeated";
  const status = hardFailure ? "failed" : effect.finish;

  return {
    template_name: "结算",
    event_id: event.event_id,
    event_title: event.title,
    selected_option_id: pending.option_id,
    scene_name: pending.scene_name ?? sceneNameForEvent(event),
    current_round: runtime.current_round,
    supply_value: runtime.supply_value,
    corruption_value: runtime.corruption_value,
    outcome,
    run_archetype: runtime.story_state.run_archetype,
    run_modifier_ids: [...(runtime.story_state.run_modifier_ids ?? [])],
    add_flags: addFlags,
    remove_flags: removeFlags,
    route_delta: copy(effect.route_delta ?? { combat: 0, scheme: 0, cleanse: 0 }),
    npc_state_updates: copy(effect.npc_updates ?? []),
    items,
    resources,
    final_chapter: status !== "ongoing"
  };
}

/** 由 pending 快照推导本次结算的 outcome。 */
export function resolveOutcome(runtime, option) {
  const pending = runtime?.pending_interaction ?? null;
  if (!pending || !option) return null;
  if (option.resolution_type === "direct") return "resolved";
  if (option.resolution_type === "battle") {
    return isNonEmptyString(pending.battle_result) ? pending.battle_result : null;
  }
  const result = pending.resolution_output?.event_details?.result;
  return OUTCOME_BY_CHECK_RESULT[result] ?? null;
}

/** 统一入口：按 operation 生成权威事实。 */
export function buildAuthority(runtime, operation) {
  switch (operation?.expected_template_name) {
    case "新一轮事件":
      return buildNewEventAuthority(runtime, operation);
    case "检定":
      return buildCheckAuthority(runtime);
    case "战斗事件":
      return buildBattleAuthority(runtime);
    case "结算":
      return buildSettlementAuthority(runtime, operation);
    default:
      return null;
  }
}

// ── 提示词注入 ──────────────────────────────────────────────

/**
 * 生成「权威填空表」文本，注入到 user prompt 末尾。
 *
 * ⚠️ 只输出机器字段与选项块，不含任何剧情内容，避免污染叙事。
 */
export function authorityPromptBlock(authority) {
  if (!authority) return "";
  const lines = [];
  lines.push("#本次权威填空表（程序已预计算）");
  lines.push("##下列字段是程序的唯一真值，必须逐字复制到输出对应位置，禁止改写、推断、增删或调整顺序。");
  lines.push("##你只需要撰写叙事部分（steps / analysis / content / memory_notes / unresolved_hooks），以及给 summary 的中文描述句。");

  if (authority.template_name === "新一轮事件") {
    lines.push("##本轮快照");
    lines.push(`current_round: ${authority.current_round}`);
    lines.push(`supply_value: ${authority.supply_value}`);
    lines.push(`corruption_value: ${authority.corruption_value}`);
    lines.push("##候选事件（必须整段复制其中一个候选的 event_id / current_type / scene_name / options）");
    for (const candidate of authority.candidates) {
      lines.push("###候选");
      lines.push(`event_id: "${candidate.event_id}"`);
      lines.push(`current_type: "${candidate.current_type}"`);
      lines.push(`scene_name: "${candidate.scene_name}"`);
      lines.push("options:");
      for (const option of candidate.options) {
        lines.push(`- text: "${option.text}"`);
        lines.push(`  id: ${option.id}`);
        lines.push(`  template_name: "${option.template_name}"`);
        lines.push(`  visible: ${option.visible}`);
        lines.push(`  available: ${option.available}`);
        if (option.template_name === "检定") {
          lines.push(`  check_type: "${option.check_type}"`);
          lines.push(`  check_difficulty: ${option.check_difficulty}`);
        }
      }
    }
    lines.push("##选项 text 可直接使用上面的文本，也可保留同样含义并保留同样的检定后缀；id / template_name / visible / available / check_type / check_difficulty 必须逐字一致。");
    return lines.join("\n");
  }

  if (authority.template_name === "检定") {
    lines.push("##检定算式输入（属性值、点数、腐化惩罚、难度阈值）");
    lines.push(`attribute: "${authority.attribute ?? ""}"`);
    lines.push(`roll: ${authority.roll}`);
    lines.push(`corruption_penalty: ${authority.corruption_penalty}`);
    lines.push(`difficulty: ${authority.difficulty ?? ""}`);
    lines.push(`success_threshold: ${authority.success_threshold ?? ""}`);
    lines.push(`great_success_threshold: ${authority.great_success_threshold ?? ""}`);
    lines.push("##属性最高值候选（primary_actor 只能从这里选）");
    for (const [key, info] of Object.entries(authority.attribute_values)) {
      lines.push(`- ${key}: ${info.value}（${info.actor}）`);
    }
    lines.push("##result 只能是大成功 / 成功 / 失败，且必须与你的 analysis 结论一致。");
    return lines.join("\n");
  }

  if (authority.template_name === "战斗事件") {
    lines.push("##战斗快照");
    lines.push(`current_round: ${authority.current_round}`);
    lines.push(`supply_value: ${authority.supply_value}`);
    lines.push(`corruption_value: ${authority.corruption_value}`);
    lines.push(`scene_name: "${authority.scene_name}"`);
    lines.push("##enemies（必须逐条复制，不得增删改名）");
    for (const enemy of authority.enemies) {
      lines.push(`- name: "${enemy}"`);
    }
    lines.push("##combat_start 必须是 true。");
    return lines.join("\n");
  }

  if (authority.template_name === "结算") {
    lines.push("##结算快照");
    lines.push(`event_id: "${authority.event_id}"`);
    lines.push(`current_round: ${authority.current_round}`);
    lines.push(`supply_value: ${authority.supply_value}`);
    lines.push(`corruption_value: ${authority.corruption_value}`);
    lines.push(`scene_name: "${authority.scene_name}"`);
    lines.push("##story_patch 机器字段（必须逐字复制）");
    lines.push(`completed_event_id: "${authority.event_id}"`);
    lines.push(`selected_option_id: ${authority.selected_option_id ?? ""}`);
    lines.push(`outcome: "${authority.outcome}"`);
    lines.push(`run_archetype: "${authority.run_archetype}"`);
    lines.push("run_modifier_ids:");
    for (const modifier of authority.run_modifier_ids) {
      lines.push(`- "${modifier}"`);
    }
    // ⚠️ 空数组必须**同行**写成 `key: []`。
    //    写成裸键 `remove_flags:`（后面不跟子节点）在受限 YAML 子集里会直接
    //    解析失败（YAML_CHILD_INDENT），整份输出被丢弃。
    //    参见 v3_adapter#parseV3Output 与 repairBareEmptyListKeys。
    if (!authority.add_flags.length) {
      lines.push("add_flags: []");
    } else {
      lines.push("add_flags:");
      for (const flag of authority.add_flags) lines.push(`- "${flag}"`);
    }
    if (!authority.remove_flags.length) {
      lines.push("remove_flags: []");
    } else {
      lines.push("remove_flags:");
      for (const flag of authority.remove_flags) lines.push(`- "${flag}"`);
    }
    lines.push("route_delta:");
    lines.push(`  combat: ${authority.route_delta.combat ?? 0}`);
    lines.push(`  scheme: ${authority.route_delta.scheme ?? 0}`);
    lines.push(`  cleanse: ${authority.route_delta.cleanse ?? 0}`);
    if (!authority.npc_state_updates.length) {
      // ⚠️ 必须是 `npc_state_updates: []`（同行），不能拆成两行：
      //    拆行后在受限 YAML 子集里会被当成「裸键缺子节点」而解析失败。
      lines.push("npc_state_updates: []");
    } else {
      lines.push("npc_state_updates:");
      for (const update of authority.npc_state_updates) {
        lines.push(`- npc: "${update.npc}"`);
        lines.push(`  state: "${update.state}"`);
      }
    }
    lines.push("##summary 细项（必须逐条复制，type/id/count 不可改）");
    if (!authority.items.length && !Object.keys(authority.resources).length) {
      lines.push("- summary: \"无物品或数值变化\"");
    } else {
      lines.push("- summary: \"（这一行请写本次变化的自然中文描述）\"");
      for (const item of authority.items) {
        lines.push(`- type: "item"`);
        lines.push(`  id: ${item.id}`);
        lines.push(`  count: ${item.count}`);
      }
      const resourceKeys = Object.keys(authority.resources);
      if (resourceKeys.length) {
        lines.push(`- type: "player_attr"`);
        for (const key of resourceKeys) {
          lines.push(`  ${key}: ${authority.resources[key]}`);
        }
      }
    }
    lines.push(`##final_chapter 必须是 ${authority.final_chapter}。`);
    lines.push("##memory_notes（0-3条）、unresolved_hooks_added（最多1条）、unresolved_hooks_resolved（只列已存在的悬念）由你撰写。");
    return lines.join("\n");
  }

  return "";
}

// ── 服务端权威归一化 ────────────────────────────────────────

function isValidStep(step) {
  if (!isPlainObject(step)) return false;
  const keys = Object.keys(step);
  if (keys.length !== 1) return false;
  if (keys[0] === "narration") return isNonEmptyString(step.narration);
  if (keys[0] !== "dialogues") return false;
  if (!Array.isArray(step.dialogues) || !step.dialogues.length) return false;
  return step.dialogues.every(
    (dialogue) =>
      isPlainObject(dialogue) &&
      Object.keys(dialogue).length === 2 &&
      isNonEmptyString(dialogue.npc) &&
      isNonEmptyString(dialogue.speech)
  );
}

/** 保留合法 steps，剔除非法项；全非法时给出兜底旁白。 */
export function sanitizeSteps(steps, fallbackText) {
  if (!Array.isArray(steps)) return [{ narration: fallbackText }];
  const valid = steps.filter(isValidStep);
  return valid.length ? valid : [{ narration: fallbackText }];
}

function sanitizeStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString).slice(0, limit);
}

/**
 * 权威归一化：把 AI 输出的机器字段全部替换为程序真值。
 *
 * ⚠️ 必须在 schema 校验**之前**调用：
 *    模型写错字段类型 / 多写字段 / 少写字段都能在这里被救回；
 *    只有叙事字段保留模型值。
 *
 * @returns {{document: object, repairs: Array<{field: string, reason: string}>}}
 */
export function applyAuthoritativeFill(document, runtime, operation) {
  const repairs = [];
  const expected = operation?.expected_template_name;
  const details = document?.event_details;
  // 模板名不匹配不是「字段偏差」，直接交给 schema 校验报错。
  if (!isPlainObject(details) || details.template_name !== expected) {
    return { document, repairs };
  }

  switch (expected) {
    case "新一轮事件":
      return { document: fillNewEvent(document, runtime, operation, repairs), repairs };
    case "检定":
      return { document: fillCheck(document, runtime, repairs), repairs };
    case "战斗事件":
      return { document: fillBattle(document, runtime, repairs), repairs };
    case "结算":
      return { document: fillSettlement(document, runtime, operation, repairs), repairs };
    default:
      return { document, repairs };
  }
}

/**
 * 保留模型的选项文案，但**强制补回检定后缀**。
 *
 * ⚠️ 检定后缀（`（社交检定）` / `（隐藏检定）`）是**玩法关键信息**：
 *    玩家要靠它判断该用哪个属性。模型自造文案时很容易漏掉后缀，
 *    导致玩家看不到该走哪条属性。
 *
 * 规则：
 *   1. AI 没写文案 → 用事件表原文（已带后缀）；
 *   2. AI 写了但缺后缀 → 补上后缀；
 *   3. AI 写了但带了**不同**的后缀 → 以事件表为准（属性是程序决定的）。
 */
export function normalizeOptionText(aiText, option) {
  const suffix = option.template_name === "检定" ? checkSuffixFor(option) : "";
  const fallback = `${option.text}${suffix}`;
  if (!isNonEmptyString(aiText)) return fallback;
  const trimmed = aiText.trim();
  if (!suffix) return trimmed;
  // 已带正确后缀 → 原样保留。
  if (trimmed.endsWith(suffix)) return trimmed;
  // 带了别的检定后缀 → 剥离后按真值补。
  const stripped = trimmed.replace(/（[^）]*检定）\s*$/u, '').trim();
  return `${stripped}${suffix}`;
}

function fillNewEvent(document, runtime, operation, repairs) {
  const authority = buildNewEventAuthority(runtime, operation);
  if (!authority || !authority.candidates.length) return document;

  const allowedIds = authority.candidates.map((candidate) => candidate.event_id);
  const aiEventId = document.event_details.event_id;
  let chosen = authority.candidates.find((candidate) => candidate.event_id === aiEventId) ?? null;
  if (!chosen) {
    chosen = authority.candidates.find(
      (candidate) => candidate.event_id === authority.fallback_event_id
    ) ?? authority.candidates[0];
    repairs.push({
      field: "event_details.event_id",
      reason: "模型选择的事件不在合法候选内，已替换为程序候选"
    });
  }

  const options = chosen.options.map((option) => {
    const aiOption = Array.isArray(document.event_details.options)
      ? document.event_details.options.find((candidate) => candidate?.id === option.id)
      : null;
    const block = {
      text: normalizeOptionText(aiOption?.text, option),
      id: option.id,
      template_name: option.template_name,
      visible: option.visible,
      available: option.available
    };
    if (option.template_name === "检定") {
      block.check_type = option.check_type;
      block.check_difficulty = option.check_difficulty;
    }
    return block;
  });

  if (Array.isArray(document.event_details.options) && document.event_details.options.length !== options.length) {
    repairs.push({ field: "event_details.options", reason: "选项数量与事件表不一致，已按事件表补齐" });
  }

  return {
    event_details: {
      template_name: "新一轮事件",
      event_id: chosen.event_id,
      current_round: authority.current_round,
      supply_value: authority.supply_value,
      corruption_value: authority.corruption_value,
      current_theme: textOr(document.event_details.current_theme, chosen.current_type),
      current_type: chosen.current_type,
      scene_name: chosen.scene_name,
      steps: sanitizeSteps(document.event_details.steps, `你们来到${chosen.scene_name}，眼前的情况还需要进一步确认。`),
      options
    }
  };
}

function fillCheck(document, runtime, repairs) {
  const details = document.event_details;
  const result = isNonEmptyString(details.result) && ["大成功", "成功", "失败"].includes(details.result)
    ? details.result
    : "失败";
  if (result !== details.result) {
    repairs.push({ field: "event_details.result", reason: "检定结果非法，已按保守口径置为失败" });
  }
  const authority = buildCheckAuthority(runtime);
  const analysis = isNonEmptyString(details.analysis)
    ? details.analysis
    : `本次检定难度为${authority?.difficulty ?? "未知"}，但过程未能展开。`;
  if (!isNonEmptyString(details.analysis)) {
    repairs.push({ field: "event_details.analysis", reason: "检定描述缺失，已使用兜底文本" });
  }
  return {
    event_details: {
      template_name: "检定",
      analysis,
      result
    }
  };
}

function fillBattle(document, runtime, repairs) {
  const authority = buildBattleAuthority(runtime);
  if (!authority) return document;
  const aiEnemies = Array.isArray(document.enemies) ? document.enemies : [];
  if (aiEnemies.length !== authority.enemies.length) {
    repairs.push({ field: "enemies", reason: "敌人名单与事件表不一致，已按事件表替换" });
  }
  return {
    event_details: {
      template_name: "战斗事件",
      current_round: authority.current_round,
      supply_value: authority.supply_value,
      corruption_value: authority.corruption_value,
      current_theme: textOr(document.event_details.current_theme, "遭遇战"),
      current_type: textOr(document.event_details.current_type, "战斗"),
      scene_name: authority.scene_name,
      steps: sanitizeSteps(document.event_details.steps, "敌我接触，战斗随即展开。")
    },
    combat_start: true,
    enemies: authority.enemies.map((name) => ({ name }))
  };
}

function fillSettlement(document, runtime, operation, repairs) {
  const authority = buildSettlementAuthority(runtime, operation);
  if (!authority) return document;
  const details = document.event_details;
  const aiPatch = isPlainObject(details.story_patch) ? details.story_patch : {};

  // ── 记录模型偏差（供服务端日志观察服从度）────────────────────
  const compare = (field, aiValue, authValue) => {
    if (JSON.stringify(aiValue) !== JSON.stringify(authValue)) {
      repairs.push({ field, reason: "模型输出的机器字段与程序真值不一致，已按真值覆盖" });
    }
  };
  compare("event_details.event_id", details.event_id, authority.event_id);
  compare("event_details.current_round", details.current_round, authority.current_round);
  compare("event_details.supply_value", details.supply_value, authority.supply_value);
  compare("event_details.corruption_value", details.corruption_value, authority.corruption_value);
  compare("event_details.scene_name", details.scene_name, authority.scene_name);
  compare("event_details.final_chapter", details.final_chapter, authority.final_chapter);
  compare("story_patch.outcome", aiPatch.outcome, authority.outcome);
  compare("story_patch.selected_option_id", aiPatch.selected_option_id, authority.selected_option_id);
  compare("story_patch.run_archetype", aiPatch.run_archetype, authority.run_archetype);
  compare("story_patch.run_modifier_ids", aiPatch.run_modifier_ids, authority.run_modifier_ids);
  compare("story_patch.add_flags", aiPatch.add_flags, authority.add_flags);
  compare("story_patch.remove_flags", aiPatch.remove_flags, authority.remove_flags);
  compare("story_patch.route_delta", aiPatch.route_delta, authority.route_delta);
  compare("story_patch.npc_state_updates", aiPatch.npc_state_updates, authority.npc_state_updates);

  const memoryNotes = sanitizeStringArray(aiPatch.memory_notes, 3);
  const existingHooks = runtime.story_state?.unresolved_hooks ?? [];
  const resolvedHooks = sanitizeStringArray(aiPatch.unresolved_hooks_resolved, 3).filter((hook) =>
    existingHooks.includes(hook)
  );
  let addedHooks = sanitizeStringArray(aiPatch.unresolved_hooks_added, 1).filter(
    (hook) => !existingHooks.includes(hook) && !resolvedHooks.includes(hook)
  );
  const projectedHookCount = new Set([
    ...existingHooks.filter((hook) => !resolvedHooks.includes(hook)),
    ...addedHooks
  ]).size;
  if (projectedHookCount > 3) {
    addedHooks = [];
    repairs.push({ field: "story_patch.unresolved_hooks_added", reason: "悬念数量超限，已清空新增悬念" });
  }

  const aiSummaryText = Array.isArray(details.summary) && isPlainObject(details.summary[0])
    ? textOr(details.summary[0].summary, null)
    : null;

  const summaryEntries = [];
  const hasChanges = authority.items.length > 0 || Object.keys(authority.resources).length > 0;
  summaryEntries.push({
    summary: aiSummaryText ?? (hasChanges ? "本次行动带来了物品与资源变化。" : "无物品或数值变化")
  });
  for (const item of authority.items) {
    summaryEntries.push({ type: "item", id: item.id, count: item.count });
  }
  const resourceKeys = Object.keys(authority.resources);
  if (resourceKeys.length) {
    const attr = { type: "player_attr" };
    for (const key of resourceKeys) attr[key] = authority.resources[key];
    summaryEntries.push(attr);
  }

  return {
    event_details: {
      template_name: "结算",
      event_id: authority.event_id,
      current_round: authority.current_round,
      supply_value: authority.supply_value,
      corruption_value: authority.corruption_value,
      current_theme: textOr(details.current_theme, authority.event_title),
      current_type: textOr(details.current_type, "事件结算"),
      scene_name: authority.scene_name,
      steps: sanitizeSteps(details.steps, "行动的结果已经落定。"),
      summary: summaryEntries,
      story_patch: {
        completed_event_id: authority.event_id,
        selected_option_id: runtime.pending_interaction.option_id,
        outcome: authority.outcome,
        run_archetype: authority.run_archetype,
        run_modifier_ids: authority.run_modifier_ids,
        add_flags: authority.add_flags,
        remove_flags: authority.remove_flags,
        route_delta: authority.route_delta,
        npc_state_updates: authority.npc_state_updates,
        memory_notes: memoryNotes,
        unresolved_hooks_added: addedHooks,
        unresolved_hooks_resolved: resolvedHooks
      },
      final_chapter: authority.final_chapter
    }
  };
}
