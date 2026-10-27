/**
 * 五模板输出约束 schema 的加载与渲染。
 *
 * 本模块是「约束规格 -> 提示词文本」的唯一转换点。
 * 五模板输出约束_20260904.yaml 同时被三处消费：
 *   1. 引擎包 buildEngineContext 渲染逐字段约束文本，替换旧的模板 demo；
 *   2. 04_验证工具/输出约束校验器.mjs 读取同一份规格校验 AI 输出；
 *   3. 研发同学直接阅读该 YAML 即可知道每个模板的确切结构。
 *
 * 同步加载：buildEngineContext 是同步函数，不能改成 async。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_FILE = path.resolve(HERE, "../01_共享积木/五模板输出约束_20260904.yaml");

const VALID_TYPES = new Set(["object", "array", "string", "integer", "boolean"]);
const VALID_REQUIRED = new Set([true, false, "conditional"]);

const CONDITION_KINDS = new Set([
  "index_equals", "index_not", "sibling_equals", "sibling_not", "context_flag", "all"
]);

// condition 是给校验器用的机器可读条件；when 是给 AI 看的中文说明，两者并存。
// 没有 condition 的字段一律视为条件恒真（例如「有变化才输出」这类由业务层决定的字段）。
function assertCondition(condition, templateName, path) {
  if (condition === undefined) return;
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
    throw new TypeError(`模板${templateName}的${path}的condition必须是object`);
  }
  if (!CONDITION_KINDS.has(condition.kind)) {
    throw new TypeError(`模板${templateName}的${path}的condition.kind非法: ${condition.kind}`);
  }
  if (condition.kind === "all") {
    if (!Array.isArray(condition.all) || condition.all.length === 0) {
      throw new TypeError(`模板${templateName}的${path}的condition.all必须是非空array`);
    }
    for (const item of condition.all) assertCondition(item, templateName, path);
    return;
  }
  if (condition.kind === "sibling_equals" || condition.kind === "sibling_not") {
    if (typeof condition.sibling !== "string" || condition.sibling.length === 0) {
      throw new TypeError(`模板${templateName}的${path}的condition.sibling必须是非空string`);
    }
    return;
  }
  if (condition.kind === "context_flag") {
    if (typeof condition.flag !== "string" || condition.flag.length === 0) {
      throw new TypeError(`模板${templateName}的${path}的condition.flag必须是非空string`);
    }
  }
}

function freezeDeep(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
  if (value !== null && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeDeep(item)])
    ));
  }
  return value;
}

function assertSchema(schema) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("输出约束schema必须是object");
  }
  if (typeof schema.schema_version !== "string") throw new TypeError("schema缺少schema_version");
  if (!Array.isArray(schema.templates) || schema.templates.length === 0) {
    throw new TypeError("schema缺少templates");
  }
  for (const template of schema.templates) {
    if (typeof template.name !== "string" || template.name.length === 0) {
      throw new TypeError("模板缺少name");
    }
    if (!Array.isArray(template.root_keys) || template.root_keys.length === 0) {
      throw new TypeError(`模板${template.name}缺少root_keys`);
    }
    if (!Array.isArray(template.fields)) throw new TypeError(`模板${template.name}缺少fields`);
    template.fields = template.fields.map(rawField => {
      // required 省略即视为可选（steps[].narration / steps[].dialogues 这类二选一字段走这条）
      const field = rawField.required === undefined ? { ...rawField, required: false } : rawField;
      if (typeof field.path !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)*$/.test(field.path)) {
        throw new TypeError(`模板${template.name}的字段path非法: ${field.path}`);
      }
      if (!VALID_TYPES.has(field.type)) {
        throw new TypeError(`模板${template.name}的${field.path}类型非法: ${field.type}`);
      }
      if (!VALID_REQUIRED.has(field.required)) {
        throw new TypeError(`模板${template.name}的${field.path}的required非法: ${field.required}`);
      }
      if (field.required === "conditional" && (typeof field.when !== "string" || field.when.length === 0)) {
        throw new TypeError(`模板${template.name}的${field.path}是条件必填但缺少when`);
      }
      if (field.enum !== undefined && !Array.isArray(field.enum)) {
        throw new TypeError(`模板${template.name}的${field.path}的enum必须是array`);
      }
      if (field.range !== undefined && (!Array.isArray(field.range) || field.range.length !== 2)) {
        throw new TypeError(`模板${template.name}的${field.path}的range必须是长度为2的array`);
      }
      if (field.length !== undefined && (!Array.isArray(field.length) || field.length.length !== 2)) {
        throw new TypeError(`模板${template.name}的${field.path}的length必须是长度为2的array`);
      }
      assertCondition(field.condition, template.name, field.path);
      return field;
    });
  }
}

let cached = null;

/** 读取并冻结 schema。结果缓存，重复调用不会重复读盘。 */
export function loadOutputContractSchema() {
  if (cached) return cached;
  const text = readFileSync(SCHEMA_FILE, "utf8");
  const parsed = YAML.parse(text);
  assertSchema(parsed);
  const byName = new Map();
  for (const template of parsed.templates) {
    if (byName.has(template.name)) throw new TypeError(`模板名重复: ${template.name}`);
    byName.set(template.name, template);
  }
  // _byName 是 Map，freezeDeep 不处理 Map，所以先冻结纯数据，再连同索引一起冻结外层对象
  const frozenData = freezeDeep({
    ...parsed,
    templates: Object.freeze(parsed.templates)
  });
  cached = Object.freeze({ ...frozenData, _byName: byName });
  return cached;
}

/** 取出单个模板的规格；模板名不在五模板之内时抛错。 */
export function getTemplateSpec(templateName) {
  const schema = loadOutputContractSchema();
  const spec = schema._byName.get(templateName);
  if (!spec) throw new RangeError(`输出约束schema中没有模板: ${templateName}`);
  return spec;
}

/** 五个模板名，顺序与 TEMPLATES 常量一致。 */
export function listTemplateNames() {
  return Object.freeze(loadOutputContractSchema().templates.map(template => template.name));
}

function formatScalar(value) {
  if (typeof value === "string") return `"${value}"`;
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null) return "—";
  return String(value);
}

function formatRange(range) {
  const [min, max] = range;
  if (min !== null && max !== null) return `区间：${min}-${max}`;
  if (min !== null) return `至少：${min}`;
  if (max !== null) return `至多：${max}`;
  return "无区间限制";
}

function formatLength(length) {
  const [min, max] = length;
  if (min !== null && max !== null) return `长度：${min}-${max}`;
  if (min !== null) return `至少：${min} 项`;
  if (max !== null) return `至多：${max} 项`;
  return "长度不限";
}

/** 合法值列：把 enum / range / length 三类约束合成一列文本。 */
function formatAllowed(field) {
  const parts = [];
  if (field.enum !== undefined) {
    parts.push(`枚举：${field.enum.map(formatScalar).join("、")}`);
  }
  if (field.range !== undefined) parts.push(formatRange(field.range));
  if (field.length !== undefined) parts.push(formatLength(field.length));
  return parts.length > 0 ? parts.join("，") : "—";
}

/** 必填列：true / false / 条件必填三态。 */
function formatRequired(field) {
  if (field.required === true) return "必填";
  if (field.required === false) {
    // 可选但带条件说明时，把条件一起显示，AI才知道「什么情况下才允许出现」。
    return typeof field.when === "string" && field.when.length > 0 ? `可选（当${field.when}）` : "可选";
  }
  return `条件必填（当${field.when}）`;
}

/**
 * 渲染逐字段约束文本。
 *
 * 每一行是 `路径｜类型｜必填或条件｜合法值｜取值来源`，
 * 顺序与 schema 的 fields 数组一致，也就是 AI 的输出顺序。
 */
export function renderTemplateConstraint(templateName) {
  const schema = loadOutputContractSchema();
  const spec = getTemplateSpec(templateName);

  const lines = [];
  lines.push(`#输出约束：${spec.name}`);
  lines.push("##本节只声明结构契约，不含任何示例内容。所有字段值必须来自 runtime_yaml、世界规则包与副本运行包；禁止把字段名、类型名或占位文字写进任何输出值。");
  lines.push(`##输出顺序（根层键，严格按此先后）：${spec.root_keys.join(" → ")}`);
  lines.push(`##${schema.common_rules.root_forbidden}`);
  lines.push(`##${schema.common_rules.quoting}`);
  lines.push(`##${schema.common_rules.indent}`);
  lines.push(`##${schema.common_rules.atomic_position}`);
  lines.push(`##${schema.common_rules.no_audit_fields}`);
  lines.push(`##${schema.common_rules.no_tags}`);
  lines.push(`##字段约束（共 ${spec.fields.length} 条，按输出顺序排列）：`);
  for (const field of spec.fields) {
    const source = typeof field.source === "string" && field.source.length > 0 ? field.source : "—";
    lines.push(`##${field.path}｜${field.type}｜${formatRequired(field)}｜${formatAllowed(field)}｜${source}`);
  }
  return lines.join("\n");
}

/** 同时渲染多个模板的约束文本，用于需要跨模板比对的降级入口。 */
export function renderAllTemplateConstraints() {
  return listTemplateNames().map(renderTemplateConstraint).join("\n\n");
}

function parsePathSegments(path) {
  return path.split(".").map(segment => {
    const isArray = segment.endsWith("[]");
    return { name: isArray ? segment.slice(0, -2) : segment, isArray };
  });
}

/**
 * 把扁平的 fields 数组折成树，供校验器按容器逐层下钻。
 *
 * 节点的 children 是「该节点的值里允许出现的键」，Map 的插入顺序即声明顺序，
 * 也就是 AI 必须遵守的输出顺序，所以校验器可以直接拿它比对 Object.keys 的先后。
 */
export function buildFieldTree(templateName) {
  const spec = getTemplateSpec(templateName);
  const root = { name: null, isArray: false, children: new Map(), spec: null };

  for (const field of spec.fields) {
    const segments = parsePathSegments(field.path);
    let node = root;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLeaf = index === segments.length - 1;
      if (!node.children.has(segment.name)) {
        node.children.set(segment.name, {
          name: segment.name,
          isArray: segment.isArray,
          children: new Map(),
          spec: null
        });
      }
      node = node.children.get(segment.name);
      if (isLeaf) {
        node.spec = field;
        node.isArray = segment.isArray;
      }
    }
  }
  return { spec, root, exclusiveGroups: spec.exclusive_groups ?? [] };
}