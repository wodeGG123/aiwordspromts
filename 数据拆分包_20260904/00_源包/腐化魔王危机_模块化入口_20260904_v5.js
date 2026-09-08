import enginePrompt, {
  buildEngineContext,
  finalCheckPrompt,
  packageMeta as engineMeta,
  streamingDisplayContract
} from "./冒险模式_通用引擎包_20260904_v5.js";
import worldPrompt, { packageMeta as worldMeta } from "./世界规则包_西方魔幻_20260904_v5.js";
import dungeonPrompt, {
  buildDungeonContext,
  eventAssetIndex,
  eventDefinitions,
  eventDefinitionSchemaVersion,
  eventPromptById,
  eventScheduleIndex,
  getScheduledEventIds,
  packageMeta as dungeonMeta,
  roleAssetByName,
  sceneAssetByName,
  sceneNameById
} from "./副本运行包_腐化魔王危机_20260904_v5.js";

function runtimeIdentity(meta) {
  return Object.freeze({ id: meta.package_id, version: meta.package_version });
}

function requireRuntimeYaml(runtimeYaml) {
  if (typeof runtimeYaml !== "string" || runtimeYaml.trim().length === 0) {
    throw new TypeError("runtimeYaml必须是非空YAML字符串");
  }
  return runtimeYaml.trim();
}

function inferContextMode(expectedTemplateName) {
  if (expectedTemplateName === "新一轮事件") return "event_generation";
  if (expectedTemplateName === "终章") return "finale";
  if (["战斗事件", "检定", "结算"].includes(expectedTemplateName)) return "active_event";
  throw new RangeError(`不支持的expectedTemplateName: ${expectedTemplateName}`);
}

export const packageContext = Object.freeze({
  engine: runtimeIdentity(engineMeta),
  world: runtimeIdentity(worldMeta),
  dungeon: runtimeIdentity(dungeonMeta)
});

export { streamingDisplayContract };

export const contextIndex = Object.freeze({
  eventDefinitionSchemaVersion,
  eventDefinitions,
  eventScheduleIndex,
  eventAssetIndex,
  eventIds: Object.freeze(Object.keys(eventPromptById)),
  roleNames: Object.freeze(Object.keys(roleAssetByName)),
  sceneNames: Object.freeze(Object.keys(sceneAssetByName)),
  sceneNameById
});

export function prepareAdventurePrompt({
  runtimeYaml,
  expectedTemplateName,
  currentRound,
  currentSceneId,
  completedEvents = [],
  forcedEventId,
  includedEventIds,
  activeEventId
}) {
  const normalizedRuntime = requireRuntimeYaml(runtimeYaml);
  const mode = inferContextMode(expectedTemplateName);
  const engineContext = buildEngineContext(expectedTemplateName);
  const dungeonContext = buildDungeonContext({
    mode,
    expectedTemplateName,
    currentRound,
    currentSceneId,
    completedEvents,
    forcedEventId,
    includedEventIds,
    activeEventId
  });
  const prompt = [
    engineContext,
    worldPrompt,
    dungeonContext.prompt,
    finalCheckPrompt,
    "#本次程序运行态输入\n" + normalizedRuntime
  ].join("\n\n");

  return Object.freeze({
    prompt,
    contextScope: Object.freeze({
      mode,
      expectedTemplateName,
      stage: dungeonContext.stage,
      includedEventIds: dungeonContext.includedEventIds,
      includedRoleIds: dungeonContext.includedRoleIds ?? Object.freeze([]),
      includedRoleNames: dungeonContext.includedRoleNames ?? Object.freeze([]),
      includedSceneIds: dungeonContext.includedSceneIds ?? Object.freeze([]),
      includedSceneNames: dungeonContext.includedSceneNames ?? Object.freeze([]),
      activeEventId: activeEventId ?? null
    })
  });
}

export function composeAdventurePrompt(options) {
  return prepareAdventurePrompt(options).prompt;
}

export function composeFullFallbackPrompt(runtimeYaml) {
  return [
    enginePrompt,
    worldPrompt,
    dungeonPrompt,
    finalCheckPrompt,
    "#本次程序运行态输入\n" + requireRuntimeYaml(runtimeYaml)
  ].join("\n\n");
}

// 兼容旧接入；新代码应调用composeAdventurePrompt或prepareAdventurePrompt。
export const composeDungeon1Prompt = composeFullFallbackPrompt;
export { getScheduledEventIds };

export default composeAdventurePrompt;
