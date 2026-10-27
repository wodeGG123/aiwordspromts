/**
 * 五模板输出约束校验器。
 *
 * 与服务端同源：约束规格来自 01_共享积木/五模板输出约束_20260904.yaml，
 * 也就是渲染进 system prompt 的那一份。这里做的事是把这同一份规格反向执行一遍，
 * 检查 AI 输出是否真的符合它被告知的结构。
 *
 * 服务端不解析 AI 输出（保持纯转发），所以本模块供客户端在流式解析完成后调用。
 * 典型用法：
 *
 *   const result = validateTemplateOutput(parsed, {
 *     expectedTemplateName: "战斗事件",
 *     expectedSceneName: pending.scene_name,
 *     flags: { gold_policy_enabled: false, diamond_policy_enabled: false }
 *   });
 *   if (!result.ok) throw new Error(result.errors.map(e => e.message).join("\n"));
 *
 * 校验内容：根层键集合与顺序、对象键顺序、未知字段、必填与条件必填、
 * 类型、枚举、整数区间、数组长度、互斥组、以及 event_id / scene_name / template_name 的取值一致性。
 */

import { buildFieldTree, getTemplateSpec, listTemplateNames } from "../00_源包/输出约束Schema_20260904.mjs";

export { listTemplateNames };

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function addError(errors, path, code, message) {
  errors.push(Object.freeze({ path, code, message: `${path} ${message}` }));
}

/**
 * 求值机器可读条件。
 * self 是当前容器对象（用于读同级字段），index 是当前元素在其数组中的下标。
 */
function evalCondition(condition, { self, index, flags }) {
  if (condition === undefined || condition === null) return true;
  switch (condition.kind) {
    case "all":
      return condition.all.every(item => evalCondition(item, { self, index, flags }));
    case "index_equals":
      return index === condition.value;
    case "index_not":
      return index === undefined ? true : index !== condition.value;
    case "sibling_equals":
      return isPlainObject(self) && self[condition.sibling] === condition.value;
    case "sibling_not":
      return !isPlainObject(self) || self[condition.sibling] !== condition.value;
    case "context_flag":
      return flags?.[condition.flag] === true;
    default:
      return true;
  }
}

/**
 * 校验单个值的类型，以及容器类型的长度约束。
 * 返回 true 表示类型正确；枚举与整数区间由调用方紧接着调 checkDomain 处理。
 * 容器类型的子键递归不在这里做，避免把「类型对不对」和「要不要下钻」两件事混在一个返回值里。
 */
function checkValue(spec, value, path, errors) {
  const actual = typeName(value);
  switch (spec.type) {
    case "object":
      if (!isPlainObject(value)) {
        addError(errors, path, "TYPE", `必须是object，实际是${actual}`);
        return false;
      }
      return true;
    case "array": {
      if (!Array.isArray(value)) {
        addError(errors, path, "TYPE", `必须是array，实际是${actual}`);
        return false;
      }
      if (spec.length !== undefined) {
        const [min, max] = spec.length;
        if (min !== null && value.length < min) {
          addError(errors, path, "ARRAY_TOO_SHORT", `至少需要 ${min} 项，实际 ${value.length} 项`);
        }
        if (max !== null && value.length > max) {
          addError(errors, path, "ARRAY_TOO_LONG", `至多 ${max} 项，实际 ${value.length} 项`);
        }
      }
      // 标量数组没有子字段规格，靠 item_type 约束元素类型
      if (spec.item_type !== undefined) {
        for (let index = 0; index < value.length; index += 1) {
          const item = value[index];
          if (spec.item_type === "string" && typeof item !== "string") {
            addError(errors, `${path}[${index}]`, "TYPE", `必须是string，实际是${typeName(item)}`);
          } else if (spec.item_type === "integer" && !Number.isSafeInteger(item)) {
            addError(errors, `${path}[${index}]`, "TYPE", `必须是整数，实际是${typeName(item)}`);
          }
        }
      }
      return true;
    }
    case "string":
      if (typeof value !== "string") {
        addError(errors, path, "TYPE", `必须是string，实际是${actual}`);
        return false;
      }
      return true;
    case "integer":
      if (!Number.isSafeInteger(value)) {
        addError(errors, path, "TYPE", `必须是整数，实际是${actual}`);
        return false;
      }
      return true;
    case "boolean":
      if (typeof value !== "boolean") {
        addError(errors, path, "TYPE", `必须是boolean，实际是${actual}`);
        return false;
      }
      return true;
    default:
      return false;
  }
}

/** 在类型正确的前提下校验枚举与整数区间。 */
function checkDomain(spec, value, path, errors) {
  if (spec.enum !== undefined && !spec.enum.includes(value)) {
    addError(errors, path, "ENUM", `取值必须是 ${spec.enum.map(item => JSON.stringify(item)).join(" / ")} 之一，实际是 ${JSON.stringify(value)}`);
  }
  if (spec.range !== undefined && typeof value === "number") {
    const [min, max] = spec.range;
    if (min !== null && value < min) addError(errors, path, "RANGE", `不得小于 ${min}，实际 ${value}`);
    if (max !== null && value > max) addError(errors, path, "RANGE", `不得大于 ${max}，实际 ${value}`);
  }
}

/**
 * 条件里是否用到上下文开关（context_flag）。
 *
 * 开关来自运行时（gold_policy_enabled 等），调用方不一定传。
 * 这类条件不参与「字段存在但条件不成立」的判定，
 * 否则没传开关时会把合法的 gold / diamond 误判为非法输出。
 */
function conditionUsesContextFlag(condition) {
  if (condition === undefined || condition === null) return false;
  if (condition.kind === "all") return condition.all.some(conditionUsesContextFlag);
  return condition.kind === "context_flag";
}

/**
 * 校验一个容器对象的键集合、键顺序与必填情况，然后递归下钻。
 * arrayIndex 是本容器作为数组元素时的下标，用于 index_equals / index_not 条件。
 */
function checkContainer(node, container, path, arrayIndex, flags, errors) {
  const actualKeys = Object.keys(container);
  const declaredOrder = [...node.children.keys()];

  for (const key of actualKeys) {
    if (!node.children.has(key)) {
      addError(errors, `${path}.${key}`, "UNKNOWN_FIELD", "不在输出约束声明的字段中，禁止输出");
    }
  }

  // 键顺序：声明顺序里越靠前的，实际出现顺序也必须越靠前
  let cursor = -1;
  for (const key of actualKeys) {
    const position = declaredOrder.indexOf(key);
    if (position === -1) continue;
    if (position < cursor) {
      addError(errors, `${path}.${key}`, "KEY_ORDER", `字段顺序错误，必须排在 ${declaredOrder[cursor]} 之后`);
    }
    cursor = position;
  }

  for (const [key, child] of node.children) {
    const childPath = `${path}.${key}`;
    const present = Object.prototype.hasOwnProperty.call(container, key);
    const conditionTrue = evalCondition(child.spec?.condition, { self: container, index: arrayIndex, flags });

    if (!present) {
      if (child.spec?.required === true) {
        addError(errors, childPath, "MISSING_REQUIRED", "是必填字段但没有输出");
        continue;
      }
      if (child.spec?.required === "conditional" && conditionTrue) {
        addError(errors, childPath, "MISSING_CONDITIONAL", `条件成立时必须输出（当${child.spec.when}）`);
      }
      continue;
    }

    const value = container[key];
    if (child.spec === null) continue;

    // 条件字段「存在但条件不成立」：例如非检定选项却输出了 check_type。
    // 这类字段在 schema 里声明过，所以不算未知字段，但确实违反条件，必须报错。
    if (child.spec.condition !== undefined && !conditionTrue && !conditionUsesContextFlag(child.spec.condition)) {
      addError(errors, childPath, "UNEXPECTED_FIELD",
        `当前条件下不允许输出本字段（当${child.spec.when ?? child.spec.condition.kind}）`);
      continue;
    }

    if (!checkValue(child.spec, value, childPath, errors)) continue;
    checkDomain(child.spec, value, childPath, errors);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (child.children.size === 0) continue;
        if (!isPlainObject(item)) {
          addError(errors, `${childPath}[${index}]`, "TYPE", "数组元素必须是object");
          continue;
        }
        checkContainer(child, item, `${childPath}[${index}]`, index, flags, errors);
      }
    } else if (isPlainObject(value) && child.children.size > 0) {
      checkContainer(child, value, childPath, undefined, flags, errors);
    }
  }
}

/** 互斥组：steps 每一项必须恰好命中 narration / dialogues 之一。 */
function checkExclusiveGroups(groups, root, pathOf, errors) {
  for (const group of groups) {
    const target = pathOf(root, group.path);
    if (!Array.isArray(target)) continue;
    for (let index = 0; index < target.length; index += 1) {
      const item = target[index];
      if (!isPlainObject(item)) continue;
      const hits = group.keys.filter(key => Object.prototype.hasOwnProperty.call(item, key));
      if (group.mode === "exactly_one" && hits.length !== 1) {
        addError(
          errors,
          `${group.path}[${index}]`,
          "EXCLUSIVE",
          `必须在 ${group.keys.join(" 与 ")} 中恰好输出一个，实际输出了 ${hits.length === 0 ? "零个" : hits.join(" 与 ")}`
        );
      }
    }
  }
}

/** 按 path 语法取出实际值，供互斥组使用。 */
function pathOf(root, path) {
  let current = root;
  for (const segment of path.split(".")) {
    const isArray = segment.endsWith("[]");
    const name = isArray ? segment.slice(0, -2) : segment;
    if (!isPlainObject(current)) return undefined;
    current = current[name];
    if (isArray && !Array.isArray(current)) return undefined;
  }
  return current;
}

/**
 * 校验一份已解析的 AI 输出。
 *
 * @param {object} parsed AI 输出的 YAML 解析对象
 * @param {object} options
 * @param {string} options.expectedTemplateName 本次 operation.expected_template_name
 * @param {string} [options.expectedEventId] 结算模板要求 event_id 与之逐字一致
 * @param {string} [options.expectedSceneName] 战斗与结算模板要求 scene_name 与 pending 锁定场景逐字一致
 * @param {object} [options.flags] 运行时开关，例如 gold_policy_enabled
 * @returns {{ok: boolean, templateName: string, errors: Array<{path: string, code: string, message: string}>}}
 */
export function validateTemplateOutput(parsed, options = {}) {
  const templateName = options.expectedTemplateName;
  const errors = [];

  if (typeof templateName !== "string" || !listTemplateNames().includes(templateName)) {
    addError(errors, "expectedTemplateName", "TEMPLATE_NAME", `不是五模板之一：${JSON.stringify(templateName)}`);
    return { ok: false, templateName: templateName ?? null, errors };
  }

  const { spec, root, exclusiveGroups } = buildFieldTree(templateName);

  if (!isPlainObject(parsed)) {
    addError(errors, "$", "TYPE", `整份输出必须是object，实际是${typeName(parsed)}`);
    return { ok: false, templateName, errors };
  }

  // 根层键：必须与 root_keys 完全一致且顺序相同
  const actualRootKeys = Object.keys(parsed);
  if (actualRootKeys.length !== spec.root_keys.length) {
    addError(errors, "$", "ROOT_KEYS", `根层键必须是 ${spec.root_keys.join("、")} 共 ${spec.root_keys.length} 个，实际是 ${actualRootKeys.join("、") || "空"}`);
  } else {
    for (let index = 0; index < spec.root_keys.length; index += 1) {
      if (actualRootKeys[index] !== spec.root_keys[index]) {
        addError(errors, "$", "ROOT_KEYS", `根层第 ${index + 1} 个键必须是 ${spec.root_keys[index]}，实际是 ${actualRootKeys[index]}`);
        break;
      }
    }
  }

  checkContainer(root, parsed, "$", undefined, options.flags ?? {}, errors);
  checkExclusiveGroups(exclusiveGroups, parsed, pathOf, errors);

  // 模板名一致性：AI 自报的 template_name 必须等于程序要求的
  const declared = parsed.event_details?.template_name;
  if (declared !== undefined && declared !== templateName) {
    addError(errors, "event_details.template_name", "TEMPLATE_MISMATCH", `必须逐字使用 ${JSON.stringify(templateName)}，实际是 ${JSON.stringify(declared)}`);
  }
  if (declared === undefined && getTemplateSpec(templateName).root_keys.includes("event_details")) {
    addError(errors, "event_details.template_name", "MISSING_REQUIRED", "是必填字段但没有输出");
  }

  if (options.expectedEventId !== undefined) {
    const actualEventId = parsed.event_details?.event_id;
    if (actualEventId !== options.expectedEventId) {
      addError(errors, "event_details.event_id", "EVENT_ID_MISMATCH", `必须逐字使用 pending 的 ${JSON.stringify(options.expectedEventId)}，实际是 ${JSON.stringify(actualEventId)}`);
    }
  }
  if (options.expectedSceneName !== undefined) {
    const actualSceneName = parsed.event_details?.scene_name;
    if (actualSceneName !== options.expectedSceneName) {
      addError(errors, "event_details.scene_name", "SCENE_MISMATCH", `必须逐字使用 pending 锁定的 ${JSON.stringify(options.expectedSceneName)}，实际是 ${JSON.stringify(actualSceneName)}`);
    }
  }

  return { ok: errors.length === 0, templateName, errors };
}

/** 返回人类可读的多行错误文本，便于直接展示或塞进日志。 */
export function formatValidationErrors(result) {
  if (result.ok) return "";
  return result.errors.map(error => `[${error.code}] ${error.message}`).join("\n");
}