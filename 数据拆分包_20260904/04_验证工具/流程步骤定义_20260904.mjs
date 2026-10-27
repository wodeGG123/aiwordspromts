/**
 * 研发包内部流程定义（预切片目录 + 完整流程模拟步骤）。
 *
 * 「重新生成预切片与模拟」和「验证完整模拟」共用这一份定义，
 * 避免两处各写一遍参数后悄悄漂移。
 *
 * 这里的参数就是 prepareAiMessages 需要的上下文参数：
 *   - 预切片：每个 operation 一个目录，引擎积木按 expected_template_name 渲染；
 *   - 完整流程模拟：7 次真实请求，逐步推进同一个副本。
 */

// 02_按状态预切片：目录名 -> 该状态用到的引擎模板。
// 引擎积木内容由 buildEngineContext(templateName) 生成，与「完整流程模拟」里的 system prompt 同一来源。
export const SLICE_TEMPLATES = Object.freeze([
  Object.freeze({ folder: "01_开局_start", templateName: "新一轮事件" }),
  Object.freeze({ folder: "02_新一轮_next_round", templateName: "新一轮事件" }),
  Object.freeze({ folder: "03_选择检定_choose", templateName: "检定" }),
  Object.freeze({ folder: "04_检定后结算_settle_check", templateName: "结算" }),
  Object.freeze({ folder: "05_选择战斗_choose", templateName: "战斗事件" }),
  Object.freeze({ folder: "06_战斗后结算_battle_result", templateName: "结算" }),
  Object.freeze({ folder: "07_选择直接结算_choose_direct", templateName: "结算" }),
  Object.freeze({ folder: "08_终章_finale", templateName: "终章" })
]);

// 03_完整流程模拟：7 次请求，覆盖五模板与六种 operation。
export const SIMULATION_STEPS = Object.freeze([
  Object.freeze({
    id: "01_开局_start",
    options: Object.freeze({
      operationType: "start",
      expectedTemplateName: "新一轮事件",
      currentRound: 1,
      currentSceneId: "scene_village",
      completedEvents: Object.freeze([]),
      forcedEventId: "M01",
      includedEventIds: Object.freeze(["M01"])
    })
  }),
  Object.freeze({
    id: "02_选择检定_choose",
    options: Object.freeze({
      operationType: "choose",
      expectedTemplateName: "检定",
      activeEventId: "M01"
    })
  }),
  Object.freeze({
    id: "03_检定后结算_settle_check",
    options: Object.freeze({
      operationType: "settle_check",
      expectedTemplateName: "结算",
      activeEventId: "M01"
    })
  }),
  Object.freeze({
    id: "04_新一轮_next_round",
    options: Object.freeze({
      operationType: "next_round",
      expectedTemplateName: "新一轮事件",
      currentRound: 24,
      currentSceneId: "scene_castle",
      completedEvents: Object.freeze(["M01", "M02", "M03", "M04", "M05"]),
      forcedEventId: "M06",
      includedEventIds: Object.freeze(["M06"])
    })
  }),
  Object.freeze({
    id: "05_选择战斗_choose",
    options: Object.freeze({
      operationType: "choose",
      expectedTemplateName: "战斗事件",
      activeEventId: "M06"
    })
  }),
  Object.freeze({
    id: "06_战斗后结算_battle_result",
    options: Object.freeze({
      operationType: "battle_result",
      expectedTemplateName: "结算",
      activeEventId: "M06"
    })
  }),
  Object.freeze({
    id: "07_终章_finale",
    options: Object.freeze({
      operationType: "finale",
      expectedTemplateName: "终章"
    })
  })
]);
