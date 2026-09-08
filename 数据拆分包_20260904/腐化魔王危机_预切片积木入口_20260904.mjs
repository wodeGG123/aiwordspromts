import { buildEngineContext, finalCheckPrompt, streamingDisplayContract } from "./00_源包/冒险模式_通用引擎包_20260904_v5.js";
import worldPrompt from "./00_源包/世界规则包_西方魔幻_20260904_v5.js";
import { buildDungeonContext, getScheduledEventIds } from "./00_源包/副本运行包_腐化魔王危机_20260904_v5.js";

export const OPERATION_TEMPLATE_MATRIX = Object.freeze({
  start: Object.freeze(["新一轮事件"]),
  next_round: Object.freeze(["新一轮事件"]),
  choose: Object.freeze(["检定", "战斗事件", "结算"]),
  settle_check: Object.freeze(["结算"]),
  battle_result: Object.freeze(["结算"]),
  finale: Object.freeze(["终章"])
});

function contextMode(templateName) {
  if (templateName === "新一轮事件") return "event_generation";
  if (templateName === "终章") return "finale";
  return "active_event";
}

export function prepareAiMessages({
  operationType,
  expectedTemplateName,
  runtimeYaml,
  currentRound,
  currentSceneId,
  completedEvents = [],
  forcedEventId,
  includedEventIds,
  activeEventId
}) {
  const allowed = OPERATION_TEMPLATE_MATRIX[operationType];
  if (!allowed?.includes(expectedTemplateName)) {
    throw new RangeError(`operationType=${operationType}不能期望${expectedTemplateName}`);
  }
  if (typeof runtimeYaml !== "string" || runtimeYaml.trim() === "") throw new TypeError("runtimeYaml不能为空");
  const mode = contextMode(expectedTemplateName);
  const dungeonContext = buildDungeonContext({
    mode, expectedTemplateName, currentRound, currentSceneId, completedEvents,
    forcedEventId, includedEventIds, activeEventId
  });
  const bricks = Object.freeze([
    Object.freeze({ id: `engine.${expectedTemplateName}`, content: buildEngineContext(expectedTemplateName) }),
    Object.freeze({ id: "world.full", content: worldPrompt }),
    Object.freeze({ id: `dungeon.${mode}.${activeEventId ?? includedEventIds?.join("+") ?? forcedEventId ?? "scheduled"}`, content: dungeonContext.prompt }),
    Object.freeze({ id: "engine.final_check", content: finalCheckPrompt })
  ]);
  const systemPrompt = bricks.map(brick => brick.content).join("\n\n");
  const userPrompt = "#本次程序运行态输入\n" + runtimeYaml.trim();
  return Object.freeze({
    systemPrompt,
    userPrompt,
    fullPrompt: systemPrompt + "\n\n" + userPrompt,
    bricks,
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

export { getScheduledEventIds, streamingDisplayContract };
