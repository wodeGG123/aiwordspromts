/**
 * 运行态请求协议：把 HTTP /api/chat 请求体映射到模块化提示词装配入口的参数，
 * 并校验 operation、模板、轮数、场景、事件、pending 的一致性。
 *
 * 该模块只描述协议映射，不直接调用 AI；调用方负责把 prepareAdventurePrompt
 * 返回的 prompt 交给上游模型，再把原始 YAML 流回传给客户端。
 */

import { prepareAiMessages } from "../数据拆分包_20260904/腐化魔王危机_预切片积木入口_20260904.mjs";
import { contextIndex, packageContext } from "../数据拆分包_20260904/00_源包/腐化魔王危机_模块化入口_20260904_v5.js";

const { eventAssetIndex, eventScheduleIndex, eventDefinitions, sceneNameById } = contextIndex;

const sceneIdByName = Object.freeze(Object.fromEntries(
  Object.entries(sceneNameById).map(([sceneId, sceneName]) => [sceneName, sceneId])
));

const SUPPORTED_EVENT_PACKAGE_VERSIONS = Object.freeze(new Set([
  packageContext.dungeon.version,
  contextIndex.eventDefinitionSchemaVersion
]));

export const OPERATION_TYPES = Object.freeze([
  "start",
  "next_round",
  "choose",
  "settle_check",
  "battle_result",
  "finale"
]);

export const EXPECTED_TEMPLATES = Object.freeze([
  "新一轮事件",
  "战斗事件",
  "检定",
  "结算",
  "终章"
]);

export const SUPPORTED_PROVIDER_MODES = Object.freeze(["delta_text", "cumulative_text"]);

const OPERATION_TO_DEFAULT_TEMPLATE = Object.freeze({
  start: "新一轮事件",
  next_round: "新一轮事件",
  settle_check: "结算",
  battle_result: "结算",
  finale: "终章"
});

const TEMPLATE_REQUIRES_PENDING = Object.freeze(new Set(["结算"]));
const TEMPLATE_REQUIRES_STORY_STATE = Object.freeze(
  new Set(["新一轮事件", "战斗事件", "结算"])
);

export class RuntimeContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RuntimeContractError";
    this.code = code;
    this.details = details;
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new RuntimeContractError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isInteger(value) {
  return Number.isSafeInteger(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeSceneId(value) {
  if (!isString(value) || value.length === 0) return value;
  return sceneNameById[value] === undefined ? (sceneIdByName[value] ?? value) : value;
}

function normalizeStoryStateSceneIds(storyState) {
  return {
    ...storyState,
    current_scene_id: normalizeSceneId(storyState.current_scene_id),
    visited_scene_ids: storyState.visited_scene_ids.map(normalizeSceneId)
  };
}

function normalizePendingSceneId(pendingInteraction) {
  if (pendingInteraction === null) return null;
  return { ...pendingInteraction, scene_id: normalizeSceneId(pendingInteraction.scene_id) };
}

function requireField(object, key, label, type) {
  invariant(hasOwn(object, key), "MISSING_FIELD", `${label}缺少字段${key}`);
  const value = object[key];
  if (type === "object") invariant(isObject(value), "FIELD_TYPE", `${label}.${key}必须是object`);
  else if (type === "string") invariant(isString(value) && value.length > 0, "FIELD_TYPE", `${label}.${key}必须是非空字符串`);
  else if (type === "integer") invariant(isInteger(value), "FIELD_TYPE", `${label}.${key}必须是安全整数`);
  else if (type === "string|null") invariant(value === null || (isString(value) && value.length > 0), "FIELD_TYPE", `${label}.${key}必须是string或null`);
  else if (type === "array") invariant(Array.isArray(value), "FIELD_TYPE", `${label}.${key}必须是array`);
  return value;
}

function validatePackageContext(value) {
  invariant(isObject(value), "PACKAGE_CONTEXT_TYPE", "package_context必须是object");
  invariant(hasOwn(value, "engine") && isObject(value.engine), "PACKAGE_CONTEXT_ENGINE", "package_context.engine缺失");
  invariant(hasOwn(value, "world") && isObject(value.world), "PACKAGE_CONTEXT_WORLD", "package_context.world缺失");
  invariant(hasOwn(value, "dungeon") && isObject(value.dungeon), "PACKAGE_CONTEXT_DUNGEON", "package_context.dungeon缺失");
  for (const key of ["engine", "world", "dungeon"]) {
    invariant(isString(value[key].id) && value[key].id.length > 0, "PACKAGE_CONTEXT_ID", `package_context.${key}.id缺失`);
    invariant(isString(value[key].version) && value[key].version.length > 0, "PACKAGE_CONTEXT_VERSION", `package_context.${key}.version缺失`);
  }
  return value;
}

function validateStoryState(value) {
  invariant(isObject(value), "STORY_STATE_TYPE", "story_state必须是object");
  invariant(Array.isArray(value.completed_events), "STORY_STATE_COMPLETED_EVENTS", "story_state.completed_events必须是array");
  invariant(Array.isArray(value.story_flags), "STORY_STATE_FLAGS", "story_state.story_flags必须是array");
  invariant(isObject(value.route_scores), "STORY_STATE_ROUTE", "story_state.route_scores必须是object");
  for (const key of ["combat", "scheme", "cleanse"]) {
    invariant(isInteger(value.route_scores[key]), "STORY_STATE_ROUTE_INT", `story_state.route_scores.${key}必须是整数`);
  }
  invariant(isString(value.current_scene_id) && value.current_scene_id.length > 0, "STORY_STATE_SCENE", "story_state.current_scene_id缺失");
  invariant(Array.isArray(value.visited_scene_ids), "STORY_STATE_VISITED", "story_state.visited_scene_ids必须是array");
  invariant(Array.isArray(value.npc_states), "STORY_STATE_NPC_STATES", "story_state.npc_states必须是array");
  invariant(Array.isArray(value.unresolved_hooks), "STORY_STATE_HOOKS", "story_state.unresolved_hooks必须是array");
  invariant(Array.isArray(value.memory_notes), "STORY_STATE_NOTES", "story_state.memory_notes必须是array");
  invariant(Array.isArray(value.recent_event_ids), "STORY_STATE_RECENT", "story_state.recent_event_ids必须是array");
  invariant(isString(value.run_archetype) && value.run_archetype.length > 0, "STORY_STATE_ARCHETYPE", "story_state.run_archetype缺失");
  invariant(Array.isArray(value.run_modifier_ids) && value.run_modifier_ids.length === 2, "STORY_STATE_MODIFIERS", "story_state.run_modifier_ids必须恰为2项");
  return value;
}

function validatePending(value) {
  invariant(isObject(value), "PENDING_TYPE", "pending_interaction必须是object");
  invariant(isString(value.event_id) && value.event_id.length > 0, "PENDING_EVENT_ID", "pending_interaction.event_id缺失");
  invariant(isString(value.scene_id) && value.scene_id.length > 0, "PENDING_SCENE_ID", "pending_interaction.scene_id缺失");
  return value;
}

function validateCandidates(value) {
  if (!hasOwn(arguments[0], "event_candidates")) return [];
  const candidates = arguments[0].event_candidates;
  if (candidates === undefined) return [];
  invariant(Array.isArray(candidates), "CANDIDATES_TYPE", "event_candidates必须是array");
  const ids = new Set();
  for (const [index, item] of candidates.entries()) {
    invariant(isObject(item), "CANDIDATE_TYPE", `event_candidates[${index}]必须是object`);
    invariant(isString(item.event_id) && item.event_id.length > 0, "CANDIDATE_ID", `event_candidates[${index}].event_id缺失`);
    invariant(isInteger(item.weight) && item.weight > 0, "CANDIDATE_WEIGHT", `event_candidates[${index}].weight必须是正整数`);
    invariant(!ids.has(item.event_id), "CANDIDATE_DUPLICATE", `event_candidates[${index}].event_id重复`);
    ids.add(item.event_id);
  }
  return candidates;
}

function validateEventContext(request, operationType, expectedTemplateName, currentRound, currentSceneId, pendingInteraction) {
  const context = request.event_context;
  invariant(isObject(context), "EVENT_CONTEXT_REQUIRED", "event_context必须是object");
  const eventPackageVersion = context.event_package_version;
  const dungeonPackageVersion = context.dungeon_package_version
    ?? (eventPackageVersion === packageContext.dungeon.version ? eventPackageVersion : undefined);
  invariant(SUPPORTED_EVENT_PACKAGE_VERSIONS.has(eventPackageVersion), "EVENT_PACKAGE_VERSION", "事件包版本不匹配");
  invariant(dungeonPackageVersion === packageContext.dungeon.version, "DUNGEON_PACKAGE_VERSION", "副本包版本不匹配");
  const templateContract = context.template_contract ?? context.template_contract_version;
  invariant(templateContract === undefined || (isString(templateContract) && templateContract.startsWith("five-template-v3")), "TEMPLATE_CONTRACT", "模板协议版本不受支持");

  const candidateIds = context.candidate_event_ids;
  invariant(Array.isArray(candidateIds) && candidateIds.length > 0, "EVENT_CONTEXT_CANDIDATES", "candidate_event_ids必须是非空array");

  const isGenerationOperation = operationType === "start" || operationType === "next_round";
  // 新一轮操作允许把候选集合交给 AI 选择；forced_event_id 只在客户端已经锁定事件时提供。
  const eventId = context.event_id
    ?? (isGenerationOperation
      ? (context.forced_event_id ?? (candidateIds.length === 1 ? candidateIds[0] : undefined))
      : pendingInteraction?.event_id);
  if (!isGenerationOperation || eventId !== undefined) {
    invariant(isString(eventId) && eventId.length > 0, "EVENT_CONTEXT_ID", "event_context.event_id缺失");
  }
  if (!isGenerationOperation && context.event_id !== undefined) {
    invariant(context.event_id === pendingInteraction?.event_id, "EVENT_CONTEXT_PENDING", "活动事件必须与pending事件一致");
  }

  const scheduled = new Set(Object.entries(eventScheduleIndex)
    .filter(([, rule]) => currentRound >= rule.round_min && currentRound <= rule.round_max && (!rule.fixed || currentRound === rule.round_min))
    .map(([id]) => id));
  invariant(candidateIds.every(id => eventDefinitions[id] && scheduled.has(id)), "EVENT_CONTEXT_CANDIDATES", "候选事件不属于当前轮调度范围");
  if (eventId !== undefined) {
    invariant(candidateIds.includes(eventId), "EVENT_CONTEXT_CANDIDATES", "选定事件不在候选集合中");
  }
  if (isGenerationOperation) {
    invariant(context.forced_event_id === undefined || context.forced_event_id === eventId, "EVENT_CONTEXT_SELECTION", "forced_event_id必须与选定事件一致");
  } else {
    invariant(pendingInteraction?.event_id === eventId, "EVENT_CONTEXT_PENDING", "活动事件必须与pending事件一致");
  }

  const allowedRoleNames = new Set(candidateIds.flatMap(id => eventAssetIndex[id].role_names));
  const allowedSceneIds = new Set(candidateIds.flatMap(id => eventAssetIndex[id].scene_ids));
  const npcNames = context.npc_names ?? (Array.isArray(context.associated_roles) ? context.associated_roles.map(item => item?.name) : undefined);
  const sceneIds = context.scene_ids ?? (Array.isArray(context.associated_scenes) ? context.associated_scenes.map(item => item?.id) : undefined);
  invariant(Array.isArray(npcNames) && npcNames.every(name => allowedRoleNames.has(name)), "EVENT_CONTEXT_NPC", "NPC不属于候选事件资产范围");
  invariant(Array.isArray(sceneIds) && sceneIds.every(id => allowedSceneIds.has(id) || id === currentSceneId), "EVENT_CONTEXT_SCENE", "场景不属于候选事件资产范围");
  return eventId === undefined ? { ...context } : { ...context, event_id: eventId };
}

function normalizeTextScalar(value) {
  if (isString(value)) return value;
  if (isInteger(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  return null;
}

function yamlEscapeScalar(text) {
  let escaped = "";
  for (const char of text) {
    if (char === "\\") escaped += "\\\\";
    else if (char === '"') escaped += '\\"';
    else if (char === "\n") escaped += "\\n";
    else if (char === "\r") escaped += "\\r";
    else if (char === "\t") escaped += "\\t";
    else escaped += char;
  }
  return `"${escaped}"`;
}

function toYamlScalar(text) {
  return yamlEscapeScalar(text);
}

export function serializeYamlFilterPatch(patch) {
  const lines = [];
  for (const { path: fieldPath, value } of patch) {
    lines.push(`${fieldPath}: ${toYamlScalar(value)}`);
  }
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}

export function applyYamlFilterPatch(runtimeYaml, patch) {
  if (!patch || patch.length === 0) return runtimeYaml;

  // patch 格式：[{ path: "  user_input", value: "[内容已屏蔽]" }]
  // path 包含缩进 + 字段名（不含冒号），需要匹配 "  user_input: "原始值""
  const lines = runtimeYaml.split(/\r?\n/);
  const pathSet = new Set(patch.map(p => p.path));

  // 构建新行：如果路径匹配则替换，否则保留原行
  const newLines = lines.map(line => {
    for (const { path, value } of patch) {
      // 匹配 "  user_input: ..." 格式的行，缩进 + 字段名 + 冒号
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${escapedPath}:\\s+".*"(?=\\s*$)`);
      if (pattern.test(line)) {
        // 用新值替换整行
        return `${path}: ${toYamlScalar(value)}`;
      }
    }
    return line;
  });

  return newLines.join("\n");
}

function findStringScalarsByName(yamlText, fieldName) {
  if (typeof yamlText !== "string") return [];
  const lines = yamlText.split(/\r?\n/);
  const matches = [];
  for (const line of lines) {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s+"(.*)"$/);
    if (!match) continue;
    if (match[2] !== fieldName) continue;
    const indent = match[1].length;
    if (indent === 0) continue;
    matches.push({ line, indent, decoded: match[3] });
  }
  return matches;
}

const FILTERABLE_FIELD_NAMES = Object.freeze(["user_input", "player_text", "free_text", "narration_user"]);

export function buildBlacklistPatch(runtimeYaml, blacklist) {
  if (!Array.isArray(blacklist) || blacklist.length === 0) return [];
  const patch = [];
  const seen = new Set();
  for (const fieldName of FILTERABLE_FIELD_NAMES) {
    for (const occurrence of findStringScalarsByName(runtimeYaml, fieldName)) {
      const lower = occurrence.decoded.toLowerCase();
      const hit = blacklist.some((word) => word.length > 0 && lower.includes(word.toLowerCase()));
      if (!hit) continue;
      const indent = " ".repeat(occurrence.indent);
      const path = `${indent}${fieldName}`;
      if (seen.has(path + ":" + occurrence.decoded)) continue;
      seen.add(path + ":" + occurrence.decoded);
      patch.push({ path: `${indent}${fieldName}`, value: "[内容已屏蔽]" });
    }
  }
  return patch;
}

/**
 * 校验请求体并返回 prepareAdventurePrompt 所需的上下文对象。
 *
 * 输入 schema（顶级）：
 *   runtime_yaml: string 必填
 *   operation: { type, request_id, expected_template_name, ... }
 *   state_version: integer 必填
 *   current_round: integer 必填
 *   current_scene_id: string 必填
 *   story_state: object 必填
 *   pending_interaction: object | null
 *   event_candidates: array 可选
 *   run_difficulty: string 可选
 *   validate_business: bool 可选（运行时仅用于审计）
 */
export function validateRequest(request) {
  invariant(isObject(request), "REQUEST_TYPE", "请求体必须是object");
  const runtimeYaml = requireField(request, "runtime_yaml", "request", "string");

  const operation = requireField(request, "operation", "request", "object");
  const operationType = requireField(operation, "type", "operation", "string");
  invariant(OPERATION_TYPES.includes(operationType), "OPERATION_TYPE", `operation.type必须是${OPERATION_TYPES.join("/")}之一`);

  const requestId = requireField(operation, "request_id", "operation", "string");
  const expectedTemplateName = requireField(operation, "expected_template_name", "operation", "string");
  invariant(EXPECTED_TEMPLATES.includes(expectedTemplateName), "EXPECTED_TEMPLATE_NAME", `expected_template_name必须是五模板之一`);

  const defaultForOperation = OPERATION_TO_DEFAULT_TEMPLATE[operationType];
  if (defaultForOperation !== undefined) {
    if (operationType === "choose") {
      invariant(
        expectedTemplateName === "检定" || expectedTemplateName === "战斗事件" || expectedTemplateName === "结算",
        "OPERATION_TEMPLATE_MISMATCH",
        "choose的expected_template_name必须是检定/战斗事件/结算"
      );
    } else {
      invariant(expectedTemplateName === defaultForOperation, "OPERATION_TEMPLATE_MISMATCH", `${operationType}必须对应模板${defaultForOperation}`);
    }
  }

  const stateVersion = requireField(request, "state_version", "request", "integer");
  invariant(stateVersion >= 0, "STATE_VERSION", "state_version必须>=0");

  const currentRound = requireField(request, "current_round", "request", "integer");
  invariant(currentRound >= 1, "CURRENT_ROUND", "current_round必须>=1");

  const requestedCurrentSceneId = requireField(request, "current_scene_id", "request", "string");
  const currentSceneId = normalizeSceneId(requestedCurrentSceneId);
  invariant(sceneNameById[currentSceneId] !== undefined, "CURRENT_SCENE_ID", "current_scene_id必须是已知场景ID或名称");

  const requestedStoryState = requireField(request, "story_state", "request", "object");
  validateStoryState(requestedStoryState);
  const storyState = normalizeStoryStateSceneIds(requestedStoryState);

  const candidates = validateCandidates(request);
  if (candidates.length > 0 && hasOwn(operation, "forced_event_id")) {
    const forcedEventId = operation.forced_event_id;
    invariant(isString(forcedEventId), "FORCED_EVENT_ID", "forced_event_id必须是string");
    invariant(candidates.some(item => item.event_id === forcedEventId), "FORCED_EVENT_NOT_IN_CANDIDATES", "forced_event_id不在event_candidates中");
  }

  let pendingInteraction = null;
  if (hasOwn(request, "pending_interaction") && request.pending_interaction !== null) {
    const requestedPendingInteraction = requireField(request, "pending_interaction", "request", "object");
    validatePending(requestedPendingInteraction);
    pendingInteraction = normalizePendingSceneId(requestedPendingInteraction);
    invariant(pendingInteraction.scene_id === currentSceneId, "PENDING_SCENE_MISMATCH", "pending_interaction.scene_id必须与current_scene_id一致");
  }

  const eventContext = validateEventContext(request, operationType, expectedTemplateName, currentRound, currentSceneId, pendingInteraction);

  if (TEMPLATE_REQUIRES_PENDING.has(expectedTemplateName)) {
    invariant(pendingInteraction !== null, "PENDING_REQUIRED", `${expectedTemplateName}必须提供pending_interaction`);
  }
  if (TEMPLATE_REQUIRES_STORY_STATE.has(expectedTemplateName)) {
    invariant(storyState.current_scene_id === currentSceneId, "STORY_STATE_SCENE_MISMATCH", "story_state.current_scene_id必须与current_scene_id一致");
  }

  if (hasOwn(request, "run_difficulty")) {
    const runDifficulty = request.run_difficulty;
    invariant(["normal", "hard", "nightmare"].includes(runDifficulty), "RUN_DIFFICULTY", "run_difficulty必须是normal/hard/nightmare");
  }

  return {
    runtimeYaml,
    operation,
    requestId,
    operationType,
    expectedTemplateName,
    stateVersion,
    currentRound,
    currentSceneId,
    storyState,
    pendingInteraction,
    candidates,
    eventContext
  };
}

/**
 * 校验后准备提示词，返回 prepareAdventurePrompt 上下文以及可选的过滤后 runtime_yaml。
 */
export function preparePromptFromRequest(request, options = {}) {
  const normalized = validateRequest(request);
  const completedEvents = normalized.storyState.completed_events;
  const includedEventIds = normalized.eventContext.candidate_event_ids;
  const forcedEventId = normalized.operation.forced_event_id || normalized.eventContext.forced_event_id || normalized.eventContext.event_id;
  const activeEventId = normalized.pendingInteraction ? normalized.pendingInteraction.event_id : undefined;

  let runtimeYaml = normalized.runtimeYaml;
  if (options.blacklist) {
    const patch = buildBlacklistPatch(runtimeYaml, options.blacklist);
    if (patch.length > 0) {
      runtimeYaml = applyYamlFilterPatch(runtimeYaml, patch);
    }
  }

  const prepared = prepareAiMessages({
    operationType: normalized.operationType,
    runtimeYaml,
    expectedTemplateName: normalized.expectedTemplateName,
    currentRound: normalized.currentRound,
    currentSceneId: normalized.currentSceneId,
    completedEvents,
    forcedEventId,
    includedEventIds,
    activeEventId
  });

  return {
    systemPrompt: prepared.systemPrompt,
    userPrompt: prepared.userPrompt,
    messages: Object.freeze([
      Object.freeze({ role: "system", content: prepared.systemPrompt }),
      Object.freeze({ role: "user", content: prepared.userPrompt })
    ]),
    contextScope: prepared.contextScope,
    requestId: normalized.requestId,
    operationType: normalized.operationType,
    expectedTemplateName: normalized.expectedTemplateName,
    runtimeYaml
  };
}
