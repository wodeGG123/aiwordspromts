/**
 * AI冒险模式五模板前端流式解析器
 * Contract: yaml-visible-fields-v3 / fixed_template_quoted_scalar_v1
 *
 * - 无第三方依赖，可直接作为浏览器ES Module使用。
 * - 网络分片不等于UI分片；只展示白名单字段或完整句子。
 * - rawYaml始终原样累积，流结束后才进行完整YAML与Schema校验。
 * - 业务状态、资源、pending与战斗启动必须在调用方完成最终校验后处理。
 */

export const STREAMING_CONTRACT_VERSION = "yaml-visible-fields-v3";

export const TEMPLATE_NAMES = Object.freeze([
  "新一轮事件",
  "战斗事件",
  "检定",
  "结算",
  "终章"
]);

export const PROVIDER_CHUNK_MODES = Object.freeze([
  "delta_text",
  "cumulative_text"
]);

export const EMIT_MODES = Object.freeze([
  "complete_visible_field",
  "sentence_inside_open_scalar"
]);

/** 与通用引擎导出的streamingDisplayContract逐字段一致，供集成测试阻止契约漂移。 */
export const PARSER_STREAMING_CONTRACT = Object.freeze({
  version: STREAMING_CONTRACT_VERSION,
  transport: "frontend_direct_raw_yaml_stream",
  framing: "fixed_template_quoted_scalar_v1",
  provider_chunk_modes: PROVIDER_CHUNK_MODES,
  required_emit_mode: "complete_visible_field",
  optional_emit_mode: "sentence_inside_open_scalar",
  visible_scalar_dialect: "json_compatible_yaml_double_quoted_v1",
  failure_mode: "disable_provisional_continue_raw_accumulation",
  provisional_until_full_validation: true,
  visible_field_paths: Object.freeze([
    "event_details.current_theme",
    "event_details.steps[].narration",
    "event_details.steps[].dialogues[].npc",
    "event_details.steps[].dialogues[].speech",
    "event_details.analysis",
    "event_details.content"
  ]),
  atomic_field_paths: Object.freeze([
    "event_details.options",
    "event_details.result",
    "combat_start",
    "enemies",
    "event_details.summary",
    "event_details.story_patch",
    "event_details.final_chapter"
  ]),
  header_gate_paths_by_template: Object.freeze({
    "新一轮事件": Object.freeze(["event_details.template_name", "event_details.event_id", "event_details.scene_name"]),
    "战斗事件": Object.freeze(["event_details.template_name", "event_details.scene_name"]),
    "检定": Object.freeze(["event_details.template_name"]),
    "结算": Object.freeze(["event_details.template_name", "event_details.event_id", "event_details.scene_name"]),
    "终章": Object.freeze(["event_details.template_name"])
  })
});

const HEADER_REQUIREMENTS = Object.freeze({
  "新一轮事件": Object.freeze(["template_name", "event_id", "scene_name"]),
  "战斗事件": Object.freeze(["template_name", "scene_name"]),
  "检定": Object.freeze(["template_name"]),
  "结算": Object.freeze(["template_name", "event_id", "scene_name"]),
  "终章": Object.freeze(["template_name"])
});

const ATOMIC_LINE_PREFIXES = Object.freeze([
  "  options:",
  "  result:",
  "combat_start:",
  "enemies:",
  "  summary:",
  "  story_patch:",
  "  final_chapter:"
]);

const VISIBLE_SPECS = Object.freeze([
  Object.freeze({
    prefix: "  current_theme: ",
    path: "event_details.current_theme",
    kind: "theme",
    templates: Object.freeze(["新一轮事件", "战斗事件", "结算"]),
    needsSteps: false,
    sentenceCapable: false
  }),
  Object.freeze({
    prefix: "    - narration: ",
    path: "event_details.steps[].narration",
    kind: "narration",
    templates: Object.freeze(["新一轮事件", "战斗事件", "结算"]),
    needsSteps: true,
    sentenceCapable: true
  }),
  Object.freeze({
    prefix: "      - npc: ",
    path: "event_details.steps[].dialogues[].npc",
    kind: "npc",
    templates: Object.freeze(["新一轮事件", "战斗事件", "结算"]),
    needsSteps: true,
    sentenceCapable: false
  }),
  Object.freeze({
    prefix: "        speech: ",
    path: "event_details.steps[].dialogues[].speech",
    kind: "dialogue",
    templates: Object.freeze(["新一轮事件", "战斗事件", "结算"]),
    needsSteps: true,
    sentenceCapable: true
  }),
  Object.freeze({
    prefix: "  analysis: ",
    path: "event_details.analysis",
    kind: "analysis",
    templates: Object.freeze(["检定"]),
    needsSteps: false,
    sentenceCapable: true
  }),
  Object.freeze({
    prefix: "  content: ",
    path: "event_details.content",
    kind: "content",
    templates: Object.freeze(["终章"]),
    needsSteps: false,
    sentenceCapable: true
  })
]);

const SENTENCE_ENDINGS = new Set(["。", "！", "？", "；"]);
const CHECK_RESULTS = new Set(["大成功", "成功", "失败"]);
const OPTION_TEMPLATES = new Set(["检定", "结算", "战斗事件"]);
const CHECK_TYPES = new Set(["常规检定", "隐藏检定"]);
const OUTCOMES = new Set([
  "great_success", "success", "failure", "victory", "defeat", "retreat", "resolved"
]);
const NPC_STATES = new Set([
  "met", "trusted", "cooperative", "neutral", "wary", "hostile", "departed", "dead"
]);
const PERMANENT_REWARD_TRIGGER_IDS = new Set([900050, 900060, 900061]);

export class AdventureStreamError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AdventureStreamError";
    this.code = code;
    this.details = details;
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new AdventureStreamError(code, message, details);
}

function noop() {}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isSafeInteger(value);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function decodeJsonCompatibleStringProgress(literal) {
  if (literal.length === 0) {
    return { invalid: false, closed: false, decoded: "" };
  }
  if (!literal.startsWith('"')) {
    return { invalid: true, reason: "value_must_start_with_double_quote" };
  }

  let decoded = "";
  let index = 1;
  while (index < literal.length) {
    const char = literal[index];

    if (char === '"') {
      const tail = literal.slice(index + 1);
      if (!/^\s*$/.test(tail)) {
        return { invalid: true, reason: "characters_after_closing_quote" };
      }
      let value;
      try {
        value = JSON.parse(literal.slice(0, index + 1));
      } catch (error) {
        return { invalid: true, reason: "json_string_parse_failed", cause: error };
      }
      return { invalid: false, closed: true, decoded: value, closingIndex: index };
    }

    if (char === "\\") {
      if (index + 1 >= literal.length) {
        return { invalid: false, closed: false, decoded };
      }
      const escape = literal[index + 1];
      const simple = { '"': '"', "\\": "\\", "/": "/" };
      if (own(simple, escape)) {
        decoded += simple[escape];
        index += 2;
        continue;
      }
      if (escape === "u") {
        if (index + 6 > literal.length) {
          return { invalid: false, closed: false, decoded };
        }
        const hex = literal.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return { invalid: true, reason: "invalid_unicode_escape" };
        }
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
      return { invalid: true, reason: "forbidden_or_yaml_only_escape", escape };
    }

    if (char.charCodeAt(0) < 0x20) {
      return { invalid: true, reason: "control_character_in_visible_string" };
    }
    decoded += char;
    index += 1;
  }

  return { invalid: false, closed: false, decoded };
}

function findVisibleSpec(line, expectedTemplateName, inSteps) {
  const spec = VISIBLE_SPECS.find(candidate => line.startsWith(candidate.prefix));
  if (!spec) return null;
  if (!spec.templates.includes(expectedTemplateName)) return { invalid: "field_not_allowed_for_template", spec };
  if (spec.needsSteps && !inSteps) return { invalid: "step_field_outside_steps", spec };
  return { spec };
}

function resemblesKnownVisibleField(line) {
  return /^(?:-\s+)?(?:current_theme|narration|npc|speech|analysis|content):(?:\s|$)/.test(line.trim());
}

function exactStringFromLine(line, prefix) {
  if (!line.startsWith(prefix)) return null;
  const progress = decodeJsonCompatibleStringProgress(line.slice(prefix.length));
  if (progress.invalid || !progress.closed) {
    throw new AdventureStreamError("INVALID_STREAM_SCALAR", `字段${prefix.trim()}不是完整的JSON兼容双引号字符串`, progress);
  }
  return progress.decoded;
}

function sentenceBoundaries(text) {
  const boundaries = [];
  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_ENDINGS.has(text[index])) continue;
    let end = index + 1;
    while (end < text.length && SENTENCE_ENDINGS.has(text[end])) end += 1;
    boundaries.push(end);
    index = end - 1;
  }
  return boundaries;
}

/**
 * 前端主入口。回调事件只表示临时文本，不表示任何业务状态已经生效。
 */
export class AdventureYamlStreamParser {
  constructor({
    expectedTemplateName,
    expectedEventId = undefined,
    expectedSceneName = undefined,
    allowedEventIds = undefined,
    providerChunkMode = "delta_text",
    emitMode = "complete_visible_field",
    maxLineChars = 32 * 1024,
    maxDocumentChars = 256 * 1024,
    onProvisional = noop,
    onProvisionalDisabled = noop,
    onComplete = noop,
    onError = noop,
    validateBusiness = undefined
  }) {
    invariant(TEMPLATE_NAMES.includes(expectedTemplateName), "BAD_CONFIG", "expectedTemplateName不是五模板之一");
    invariant(PROVIDER_CHUNK_MODES.includes(providerChunkMode), "BAD_CONFIG", "未知providerChunkMode");
    invariant(EMIT_MODES.includes(emitMode), "BAD_CONFIG", "未知emitMode");
    invariant(isInteger(maxLineChars) && maxLineChars > 0, "BAD_CONFIG", "maxLineChars必须为正整数");
    invariant(isInteger(maxDocumentChars) && maxDocumentChars > maxLineChars, "BAD_CONFIG", "maxDocumentChars必须大于maxLineChars");

    this.expectedTemplateName = expectedTemplateName;
    this.expectedEventId = expectedEventId;
    this.expectedSceneName = expectedSceneName;
    this.allowedEventIds = allowedEventIds ? new Set(allowedEventIds) : null;
    this.providerChunkMode = providerChunkMode;
    this.emitMode = emitMode;
    this.maxLineChars = maxLineChars;
    this.maxDocumentChars = maxDocumentChars;
    this.onProvisional = onProvisional;
    this.onProvisionalDisabled = onProvisionalDisabled;
    this.onComplete = onComplete;
    this.onError = onError;
    this.validateBusiness = validateBusiness;

    this.rawYaml = "";
    this.lineBuffer = "";
    this.providerSnapshot = "";
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.byteFeedUsed = false;
    this.stringFeedUsed = false;
    this.finished = false;
    this.fatal = false;
    this.errorNotified = false;

    this.lineNumber = 0;
    this.firstContentSeen = false;
    this.rootSeen = false;
    this.inSteps = false;
    this.atomicTail = false;
    this.provisionalEnabled = true;
    this.provisionalDisableReason = null;
    this.headers = Object.create(null);
    this.lastHeaderOrderIndex = -1;
    this.gateAccepted = false;
    this.pendingUnits = [];
    this.pendingNpc = null;
    this.emissionSequence = 0;

    this.partialEmittedChars = 0;
  }

  /** 原始HTTP字节流入口；仅适用于delta_text。 */
  feedBytes(bytes) {
    this.#assertWritable();
    invariant(this.providerChunkMode === "delta_text", "MIXED_PROVIDER_MODE", "cumulative_text不能使用feedBytes");
    invariant(!this.stringFeedUsed, "MIXED_FEED_API", "同一响应不能混用feedBytes与feedTextFrame");
    invariant(bytes instanceof Uint8Array, "BAD_INPUT", "feedBytes只接受Uint8Array");
    this.byteFeedUsed = true;
    try {
      this.#feedAddedText(this.decoder.decode(bytes, { stream: true }));
    } catch (error) {
      this.#handleFatal(error);
    }
  }

  /** SDK字符串回调入口；mode由供应商适配配置固定，不允许运行时猜测。 */
  feedTextFrame(frame) {
    this.#assertWritable();
    invariant(!this.byteFeedUsed, "MIXED_FEED_API", "同一响应不能混用feedBytes与feedTextFrame");
    invariant(typeof frame === "string", "BAD_INPUT", "feedTextFrame只接受字符串");
    this.stringFeedUsed = true;

    try {
      if (this.providerChunkMode === "delta_text") {
        this.#feedAddedText(frame);
        return;
      }

      if (!frame.startsWith(this.providerSnapshot)) {
        throw new AdventureStreamError("CUMULATIVE_PREFIX_REWRITTEN", "供应商改写了已接收的累计正文前缀");
      }
      const added = frame.slice(this.providerSnapshot.length);
      this.providerSnapshot = frame;
      this.#feedAddedText(added);
    } catch (error) {
      this.#handleFatal(error);
    }
  }

  /**
   * 完成响应：解析受限YAML、校验五模板Schema，再执行可选业务校验。
   * 返回值成功才允许调用方开放选项、启动战斗或应用状态。
   */
  finish() {
    this.#assertWritable();
    try {
      if (this.byteFeedUsed) this.#feedAddedText(this.decoder.decode());
      if (this.lineBuffer.length > 0) {
        this.#consumeCompleteLine(this.lineBuffer);
        this.lineBuffer = "";
        this.#resetPartialLine();
      }
      if (this.pendingNpc !== null) this.#disableProvisional("npc_without_speech");

      const value = parseRestrictedYaml(this.rawYaml, {
        maxLineChars: this.maxLineChars,
        maxDocumentChars: this.maxDocumentChars
      });
      const validated = validateAdventureTemplate(value, {
        expectedTemplateName: this.expectedTemplateName,
        expectedEventId: this.expectedEventId,
        expectedSceneName: this.expectedSceneName,
        allowedEventIds: this.allowedEventIds
      });

      if (this.validateBusiness) {
        const businessResult = this.validateBusiness(validated, {
          rawYaml: this.rawYaml,
          headers: Object.freeze({ ...this.headers })
        });
        invariant(businessResult !== false, "BUSINESS_VALIDATION_FAILED", "业务校验返回false");
      }

      this.finished = true;
      const result = Object.freeze({
        rawYaml: this.rawYaml,
        value: validated,
        templateName: this.expectedTemplateName,
        provisionalWasEnabled: this.provisionalDisableReason === null,
        provisionalDisableReason: this.provisionalDisableReason
      });
      this.onComplete(result);
      return result;
    } catch (error) {
      this.#handleFatal(error);
    }
  }

  abort(reason = "aborted_by_caller") {
    if (this.finished || this.fatal) return null;
    const error = new AdventureStreamError("ABORTED", reason);
    this.fatal = true;
    if (!this.errorNotified) {
      this.errorNotified = true;
      this.onError(error);
    }
    return error;
  }

  getSnapshot() {
    return Object.freeze({
      rawYaml: this.rawYaml,
      finished: this.finished,
      fatal: this.fatal,
      gateAccepted: this.gateAccepted,
      provisionalEnabled: this.provisionalEnabled,
      provisionalDisableReason: this.provisionalDisableReason,
      headers: Object.freeze({ ...this.headers })
    });
  }

  #assertWritable() {
    invariant(!this.finished, "ALREADY_FINISHED", "解析器已经finish");
    invariant(!this.fatal, "PARSER_FATAL", "解析器已进入不可恢复错误状态");
  }

  #handleFatal(error) {
    const normalized = error instanceof AdventureStreamError
      ? error
      : new AdventureStreamError("UNEXPECTED_ERROR", error?.message ?? String(error), { cause: error });
    this.fatal = true;
    if (!this.errorNotified) {
      this.errorNotified = true;
      this.onError(normalized);
    }
    throw normalized;
  }

  #feedAddedText(text) {
    if (!text) return;
    invariant(this.rawYaml.length + text.length <= this.maxDocumentChars, "DOCUMENT_TOO_LARGE", "AI YAML超过总长度上限");
    this.rawYaml += text;
    this.lineBuffer += text;

    for (;;) {
      const lf = this.lineBuffer.indexOf("\n");
      if (lf < 0) break;
      let line = this.lineBuffer.slice(0, lf);
      this.lineBuffer = this.lineBuffer.slice(lf + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.#consumeCompleteLine(line);
      this.#resetPartialLine();
    }

    invariant(this.lineBuffer.length <= this.maxLineChars, "LINE_TOO_LARGE", "AI YAML单行超过长度上限");
    if (this.emitMode === "sentence_inside_open_scalar") this.#observePartialLine();
  }

  #resetPartialLine() {
    this.partialEmittedChars = 0;
  }

  #observePartialLine() {
    if (!this.provisionalEnabled || this.atomicTail || !this.rootSeen) return;
    const match = findVisibleSpec(this.lineBuffer, this.expectedTemplateName, this.inSteps);
    if (!match || match.invalid || !match.spec.sentenceCapable) return;
    if (match.spec.kind === "dialogue" && this.pendingNpc === null) return;

    const progress = decodeJsonCompatibleStringProgress(this.lineBuffer.slice(match.spec.prefix.length));
    if (progress.invalid) {
      this.#disableProvisional(progress.reason);
      return;
    }

    const boundaries = sentenceBoundaries(progress.decoded);
    for (const boundary of boundaries) {
      if (boundary <= this.partialEmittedChars) continue;
      const text = progress.decoded.slice(this.partialEmittedChars, boundary);
      this.partialEmittedChars = boundary;
      this.#queueOrEmit(this.#makeUnit(match.spec, text, true, this.lineNumber + 1));
    }
  }

  #consumeCompleteLine(line) {
    this.lineNumber += 1;
    if (line.length > this.maxLineChars) {
      this.#disableProvisional("line_too_large");
      return;
    }
    if (!this.provisionalEnabled) return;

    if (!this.firstContentSeen) {
      if (line.trim() === "") return;
      this.firstContentSeen = true;
      if (line !== "event_details:") {
        this.#disableProvisional("first_content_is_not_event_details");
        return;
      }
      this.rootSeen = true;
      return;
    }

    if (!this.rootSeen || this.atomicTail) return;
    if (!own(this.headers, "template_name") && line.trim() !== "" && !line.startsWith("  template_name: ")) {
      this.#disableProvisional("field_before_template_name");
      return;
    }
    if (ATOMIC_LINE_PREFIXES.some(prefix => line === prefix || line.startsWith(`${prefix} `))) {
      this.atomicTail = true;
      this.inSteps = false;
      return;
    }

    if (line === "  steps:") {
      this.inSteps = true;
      return;
    }
    const indent = line.match(/^ */)[0].length;
    if (this.inSteps && line.trim() !== "" && indent <= 2) this.inSteps = false;

    const headerPrefixes = {
      template_name: "  template_name: ",
      event_id: "  event_id: ",
      scene_name: "  scene_name: "
    };
    for (const [key, prefix] of Object.entries(headerPrefixes)) {
      if (!line.startsWith(prefix)) continue;
      const required = HEADER_REQUIREMENTS[this.expectedTemplateName];
      const orderIndex = required.indexOf(key);
      if (orderIndex < 0) {
        this.#disableProvisional(`unexpected_header_${key}`);
        return;
      }
      if (orderIndex <= this.lastHeaderOrderIndex) {
        this.#disableProvisional(`header_order_${key}`);
        return;
      }
      if (own(this.headers, key)) {
        this.#disableProvisional(`duplicate_header_${key}`);
        return;
      }
      try {
        this.headers[key] = exactStringFromLine(line, prefix);
      } catch (error) {
        this.#disableProvisional(error.code ?? `invalid_header_${key}`);
        return;
      }
      this.lastHeaderOrderIndex = orderIndex;
      this.#tryAcceptGate();
      return;
    }

    const match = findVisibleSpec(line, this.expectedTemplateName, this.inSteps);
    if (!match) {
      if (resemblesKnownVisibleField(line)) this.#disableProvisional("visible_field_wrong_path_or_indent");
      return;
    }
    if (match.invalid) {
      this.#disableProvisional(match.invalid);
      return;
    }

    const { spec } = match;
    const progress = decodeJsonCompatibleStringProgress(line.slice(spec.prefix.length));
    if (progress.invalid || !progress.closed) {
      this.#disableProvisional(progress.reason ?? "visible_string_not_closed");
      return;
    }

    if (spec.kind === "npc") {
      if (this.pendingNpc !== null) {
        this.#disableProvisional("npc_replaced_before_speech");
        return;
      }
      this.pendingNpc = progress.decoded;
      return;
    }

    if (spec.kind === "dialogue" && this.pendingNpc === null) {
      this.#disableProvisional("speech_without_npc");
      return;
    }

    if (this.emitMode === "sentence_inside_open_scalar" && spec.sentenceCapable) {
      let cursor = this.partialEmittedChars;
      for (const boundary of sentenceBoundaries(progress.decoded)) {
        if (boundary <= cursor) continue;
        this.#queueOrEmit(this.#makeUnit(spec, progress.decoded.slice(cursor, boundary), true, this.lineNumber));
        cursor = boundary;
      }
      const tail = progress.decoded.slice(cursor);
      if (tail) this.#queueOrEmit(this.#makeUnit(spec, tail, true, this.lineNumber));
      this.partialEmittedChars = progress.decoded.length;
    } else {
      this.#queueOrEmit(this.#makeUnit(spec, progress.decoded, false, this.lineNumber));
    }

    if (spec.kind === "dialogue") this.pendingNpc = null;
  }

  #tryAcceptGate() {
    const required = HEADER_REQUIREMENTS[this.expectedTemplateName];
    if (!required.every(key => own(this.headers, key))) return;

    if (this.headers.template_name !== this.expectedTemplateName) {
      this.#disableProvisional("template_name_mismatch");
      return;
    }
    for (const key of required) {
      if (typeof this.headers[key] !== "string" || this.headers[key].length === 0) {
        this.#disableProvisional(`empty_header_${key}`);
        return;
      }
    }
    if (this.expectedEventId !== undefined && this.headers.event_id !== this.expectedEventId) {
      this.#disableProvisional("event_id_mismatch");
      return;
    }
    if (this.allowedEventIds && !this.allowedEventIds.has(this.headers.event_id)) {
      this.#disableProvisional("event_id_not_allowed");
      return;
    }
    if (this.expectedSceneName !== undefined && this.headers.scene_name !== this.expectedSceneName) {
      this.#disableProvisional("scene_name_mismatch");
      return;
    }

    this.gateAccepted = true;
    const buffered = this.pendingUnits;
    this.pendingUnits = [];
    for (const unit of buffered) this.onProvisional(unit);
  }

  #makeUnit(spec, text, sentenceFragment, lineNumber) {
    const unit = {
      sequence: ++this.emissionSequence,
      provisional: true,
      kind: spec.kind,
      path: spec.path,
      text,
      sentenceFragment,
      lineNumber
    };
    if (spec.kind === "dialogue") unit.npc = this.pendingNpc;
    return Object.freeze(unit);
  }

  #queueOrEmit(unit) {
    if (!unit.text) return;
    if (this.gateAccepted) this.onProvisional(unit);
    else this.pendingUnits.push(unit);
  }

  #disableProvisional(reason) {
    if (!this.provisionalEnabled) return;
    this.provisionalEnabled = false;
    this.provisionalDisableReason = reason;
    this.pendingUnits = [];
    this.onProvisionalDisabled(Object.freeze({ reason, lineNumber: this.lineNumber }));
  }
}

/**
 * 解析五模板使用的受限YAML子集：2空格缩进、映射、序列、JSON双引号字符串、
 * 整数、boolean与null。拒绝注释、标签、锚点、别名、块标量与重复键。
 */
export function parseRestrictedYaml(source, {
  maxLineChars = 32 * 1024,
  maxDocumentChars = 256 * 1024
} = {}) {
  invariant(typeof source === "string", "YAML_TYPE", "YAML正文必须是字符串");
  invariant(source.length <= maxDocumentChars, "DOCUMENT_TOO_LARGE", "YAML超过总长度上限");

  const tokens = [];
  const rawLines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const raw = rawLines[lineIndex];
    invariant(raw.length <= maxLineChars, "LINE_TOO_LARGE", `第${lineIndex + 1}行超过长度上限`);
    if (raw.trim() === "") continue;
    invariant(!raw.includes("\t"), "YAML_TAB", `第${lineIndex + 1}行含Tab`);
    const indent = raw.match(/^ */)[0].length;
    invariant(indent % 2 === 0, "YAML_INDENT", `第${lineIndex + 1}行不是2空格缩进`);
    const text = raw.slice(indent);
    invariant(!text.startsWith("#") && !text.startsWith("---") && !text.startsWith("..."), "YAML_DECORATION", `第${lineIndex + 1}行含禁止的YAML装饰`);
    invariant(!/^(?:[&*!?]|<<:)|:\s*[&*!]|[|>]\s*$/.test(text), "YAML_ADVANCED_FEATURE", `第${lineIndex + 1}行含禁止的YAML高级语法`);
    tokens.push({ indent, text, line: lineIndex + 1 });
  }
  invariant(tokens.length > 0, "YAML_EMPTY", "YAML正文为空");

  let cursor = 0;

  function parseScalar(text, line) {
    if (text.startsWith('"')) {
      const progress = decodeJsonCompatibleStringProgress(text);
      invariant(!progress.invalid && progress.closed, "YAML_STRING", `第${line}行字符串不合法`, progress);
      return progress.decoded;
    }
    if (text === "true") return true;
    if (text === "false") return false;
    if (text === "null") return null;
    if (text === "[]") return [];
    if (text === "{}") return {};
    if (/^-?(?:0|[1-9]\d*)$/.test(text)) {
      const value = Number(text);
      invariant(Number.isSafeInteger(value), "YAML_INTEGER", `第${line}行整数超出安全范围`);
      return value;
    }
    throw new AdventureStreamError("YAML_SCALAR", `第${line}行只允许JSON双引号字符串、整数、boolean或null`);
  }

  function splitProperty(text, line) {
    const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*):(.*)$/);
    invariant(match, "YAML_KEY", `第${line}行键名或冒号不合法`);
    invariant(!["__proto__", "prototype", "constructor"].includes(match[1]), "YAML_UNSAFE_KEY", `第${line}行含禁止键名${match[1]}`);
    const tail = match[2];
    invariant(tail === "" || tail.startsWith(" "), "YAML_COLON_SPACE", `第${line}行冒号后必须为空或一个空格`);
    return { key: match[1], valueText: tail.trimStart() };
  }

  function assign(object, key, value, line) {
    invariant(!own(object, key), "YAML_DUPLICATE_KEY", `第${line}行重复键${key}`);
    object[key] = value;
  }

  function parseObjectProperty(object, indent) {
    const token = tokens[cursor];
    invariant(token && token.indent === indent && !token.text.startsWith("-"), "YAML_OBJECT", `第${token?.line ?? "EOF"}行对象结构错误`);
    const { key, valueText } = splitProperty(token.text, token.line);
    cursor += 1;
    if (valueText !== "") {
      assign(object, key, parseScalar(valueText, token.line), token.line);
      return;
    }
    invariant(tokens[cursor] && tokens[cursor].indent === indent + 2, "YAML_CHILD_INDENT", `键${key}缺少缩进为${indent + 2}的子节点`);
    assign(object, key, parseBlock(indent + 2), token.line);
  }

  function parseObject(indent) {
    const object = {};
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.indent < indent) break;
      invariant(token.indent === indent, "YAML_INDENT_JUMP", `第${token.line}行缩进跳级`);
      if (token.text.startsWith("-")) break;
      parseObjectProperty(object, indent);
    }
    return object;
  }

  function parseArray(indent) {
    const array = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.indent < indent) break;
      invariant(token.indent === indent, "YAML_INDENT_JUMP", `第${token.line}行缩进跳级`);
      if (!(token.text === "-" || token.text.startsWith("- "))) break;

      const rest = token.text === "-" ? "" : token.text.slice(2);
      cursor += 1;
      if (rest === "") {
        invariant(tokens[cursor] && tokens[cursor].indent === indent + 2, "YAML_ARRAY_CHILD", `第${token.line}行数组项缺少子节点`);
        array.push(parseBlock(indent + 2));
        continue;
      }

      if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(rest)) {
        const object = {};
        const { key, valueText } = splitProperty(rest, token.line);
        if (valueText !== "") {
          assign(object, key, parseScalar(valueText, token.line), token.line);
        } else {
          invariant(tokens[cursor] && tokens[cursor].indent === indent + 2, "YAML_ARRAY_PROPERTY_CHILD", `第${token.line}行键${key}缺少子节点`);
          assign(object, key, parseBlock(indent + 2), token.line);
        }
        while (cursor < tokens.length && tokens[cursor].indent === indent + 2 && !tokens[cursor].text.startsWith("-")) {
          parseObjectProperty(object, indent + 2);
        }
        array.push(object);
        continue;
      }

      array.push(parseScalar(rest, token.line));
    }
    return array;
  }

  function parseBlock(indent) {
    const token = tokens[cursor];
    invariant(token && token.indent === indent, "YAML_BLOCK", `第${token?.line ?? "EOF"}行块缩进错误`);
    return token.text === "-" || token.text.startsWith("- ") ? parseArray(indent) : parseObject(indent);
  }

  const result = parseBlock(tokens[0].indent);
  invariant(tokens[0].indent === 0, "YAML_ROOT_INDENT", "YAML根节点必须从第0列开始");
  invariant(cursor === tokens.length, "YAML_TRAILING", `第${tokens[cursor]?.line ?? "EOF"}行存在未解析内容`);
  invariant(isObject(result), "YAML_ROOT_TYPE", "YAML根节点必须是映射");
  return result;
}

function assertExactKeys(object, keys, label) {
  invariant(isObject(object), "SCHEMA_TYPE", `${label}必须是object`);
  const actual = Object.keys(object);
  const actualSorted = [...actual].sort();
  const expectedSorted = [...keys].sort();
  invariant(JSON.stringify(actualSorted) === JSON.stringify(expectedSorted), "SCHEMA_KEYS", `${label}字段不匹配`, { actual, expected: keys });
  invariant(JSON.stringify(actual) === JSON.stringify(keys), "SCHEMA_KEY_ORDER", `${label}字段顺序不匹配`, { actual, expected: keys });
}

function assertAllowedKeys(object, required, allowed, label) {
  invariant(isObject(object), "SCHEMA_TYPE", `${label}必须是object`);
  for (const key of required) invariant(own(object, key), "SCHEMA_REQUIRED", `${label}缺少${key}`);
  for (const key of Object.keys(object)) invariant(allowed.includes(key), "SCHEMA_UNKNOWN", `${label}含未知字段${key}`);
  const indexes = Object.keys(object).map(key => allowed.indexOf(key));
  invariant(indexes.every((value, index) => index === 0 || value > indexes[index - 1]), "SCHEMA_KEY_ORDER", `${label}字段顺序不匹配`, { actual: Object.keys(object), allowed });
}

function assertString(value, label, { nonEmpty = true } = {}) {
  invariant(typeof value === "string", "SCHEMA_STRING", `${label}必须是string`);
  if (nonEmpty) invariant(value.length > 0, "SCHEMA_EMPTY_STRING", `${label}不能为空`);
}

function assertStringArray(value, label) {
  invariant(Array.isArray(value), "SCHEMA_ARRAY", `${label}必须是array`);
  value.forEach((item, index) => assertString(item, `${label}[${index}]`));
}

function assertBoolean(value, label) {
  invariant(typeof value === "boolean", "SCHEMA_BOOLEAN", `${label}必须是boolean`);
}

function assertInteger(value, label) {
  invariant(isInteger(value), "SCHEMA_INTEGER", `${label}必须是安全整数`);
}

function assertCommonHeader(details, label) {
  assertInteger(details.current_round, `${label}.current_round`);
  assertInteger(details.supply_value, `${label}.supply_value`);
  assertInteger(details.corruption_value, `${label}.corruption_value`);
  invariant(details.current_round >= 1, "SCHEMA_ROUND", `${label}.current_round必须>=1`);
  invariant(details.supply_value >= 0 && details.supply_value <= 100, "SCHEMA_SUPPLY", `${label}.supply_value必须在0-100`);
  invariant(details.corruption_value >= 0 && details.corruption_value <= 100, "SCHEMA_CORRUPTION", `${label}.corruption_value必须在0-100`);
  assertString(details.current_theme, `${label}.current_theme`);
  assertString(details.current_type, `${label}.current_type`);
  assertString(details.scene_name, `${label}.scene_name`);
}

function assertSteps(steps, label) {
  invariant(Array.isArray(steps) && steps.length > 0, "SCHEMA_STEPS", `${label}必须是非空array`);
  steps.forEach((step, stepIndex) => {
    invariant(isObject(step), "SCHEMA_STEP", `${label}[${stepIndex}]必须是object`);
    const keys = Object.keys(step);
    invariant(keys.length === 1 && (keys[0] === "narration" || keys[0] === "dialogues"), "SCHEMA_STEP_KEYS", `${label}[${stepIndex}]只能含narration或dialogues`);
    if (keys[0] === "narration") {
      assertString(step.narration, `${label}[${stepIndex}].narration`);
      return;
    }
    invariant(Array.isArray(step.dialogues) && step.dialogues.length > 0, "SCHEMA_DIALOGUES", `${label}[${stepIndex}].dialogues必须非空`);
    step.dialogues.forEach((dialogue, dialogueIndex) => {
      assertExactKeys(dialogue, ["npc", "speech"], `${label}[${stepIndex}].dialogues[${dialogueIndex}]`);
      assertString(dialogue.npc, `${label}[${stepIndex}].dialogues[${dialogueIndex}].npc`);
      assertString(dialogue.speech, `${label}[${stepIndex}].dialogues[${dialogueIndex}].speech`);
    });
  });
}

function assertOptions(options) {
  invariant(Array.isArray(options) && options.length > 0, "SCHEMA_OPTIONS", "event_details.options必须非空");
  const ids = new Set();
  options.forEach((option, index) => {
    const label = `event_details.options[${index}]`;
    const base = ["text", "id", "template_name", "visible", "available"];
    const optional = ["check_type", "check_difficulty"];
    assertAllowedKeys(option, base, [...base, ...optional], label);
    assertString(option.text, `${label}.text`);
    assertInteger(option.id, `${label}.id`);
    invariant(option.id > 0, "SCHEMA_OPTION_ID", `${label}.id必须为正整数`);
    invariant(!ids.has(option.id), "SCHEMA_OPTION_ID", `${label}.id重复`);
    ids.add(option.id);
    invariant(OPTION_TEMPLATES.has(option.template_name), "SCHEMA_OPTION_TEMPLATE", `${label}.template_name非法`);
    assertBoolean(option.visible, `${label}.visible`);
    assertBoolean(option.available, `${label}.available`);
    if (option.template_name === "检定") {
      invariant(own(option, "check_type") && own(option, "check_difficulty"), "SCHEMA_CHECK_FIELDS", `${label}检定缺少字段`);
      invariant(CHECK_TYPES.has(option.check_type), "SCHEMA_CHECK_TYPE", `${label}.check_type非法`);
      assertInteger(option.check_difficulty, `${label}.check_difficulty`);
      invariant(option.check_difficulty >= 0 && option.check_difficulty <= 20, "SCHEMA_CHECK_DIFFICULTY", `${label}.check_difficulty超出0-20`);
    } else {
      invariant(!own(option, "check_type") && !own(option, "check_difficulty"), "SCHEMA_NON_CHECK_FIELDS", `${label}非检定选项不得含检定字段`);
    }
  });
  invariant(options.some(option => option.available), "SCHEMA_NO_AVAILABLE_OPTION", "至少一个选项必须available=true");
}

function assertSummary(summary) {
  invariant(Array.isArray(summary) && summary.length > 0, "SCHEMA_SUMMARY", "summary必须是非空array");
  assertExactKeys(summary[0], ["summary"], "summary[0]");
  assertString(summary[0].summary, "summary[0].summary");
  for (let index = 1; index < summary.length; index += 1) {
    const label = `summary[${index}]`;
    invariant(isObject(summary[index]), "SCHEMA_SUMMARY_ITEM", `${label}必须是object`);
    if (summary[index].type === "item") {
      assertExactKeys(summary[index], ["type", "id", "count"], label);
      assertInteger(summary[index].id, `${label}.id`);
      assertInteger(summary[index].count, `${label}.count`);
      invariant(summary[index].id >= 900000 && summary[index].id <= 999999, "SCHEMA_ITEM_ID", `${label}.id必须在900000号段`);
      invariant(summary[index].count !== 0, "SCHEMA_ZERO_DELTA", `${label}.count不能为0`);
      if (PERMANENT_REWARD_TRIGGER_IDS.has(summary[index].id)) {
        invariant(summary[index].count > 0, "SCHEMA_TRIGGER_COUNT", `${label}.count对永久奖励触发ID必须为正数`);
      }
      continue;
    }
    if (summary[index].type === "player_attr") {
      const deltaKeys = ["corruption", "supply", "gold", "diamond"];
      assertAllowedKeys(summary[index], ["type"], ["type", ...deltaKeys], label);
      const present = deltaKeys.filter(key => own(summary[index], key));
      invariant(present.length > 0, "SCHEMA_EMPTY_PLAYER_ATTR", `${label}至少包含一个属性变化`);
      for (const key of present) {
        assertInteger(summary[index][key], `${label}.${key}`);
        invariant(summary[index][key] !== 0, "SCHEMA_ZERO_DELTA", `${label}.${key}不能为0`);
      }
      continue;
    }
    throw new AdventureStreamError("SCHEMA_SUMMARY_TYPE", `${label}.type只允许item或player_attr`);
  }
}

function assertStoryPatch(patch) {
  const keys = [
    "completed_event_id", "selected_option_id", "outcome", "run_archetype", "run_modifier_ids",
    "add_flags", "remove_flags", "route_delta", "npc_state_updates", "memory_notes",
    "unresolved_hooks_added", "unresolved_hooks_resolved"
  ];
  assertExactKeys(patch, keys, "story_patch");
  assertString(patch.completed_event_id, "story_patch.completed_event_id");
  assertInteger(patch.selected_option_id, "story_patch.selected_option_id");
  invariant(patch.selected_option_id >= 0, "SCHEMA_SELECTED_OPTION", "story_patch.selected_option_id必须>=0");
  invariant(OUTCOMES.has(patch.outcome), "SCHEMA_OUTCOME", "story_patch.outcome非法");
  assertString(patch.run_archetype, "story_patch.run_archetype");
  assertStringArray(patch.run_modifier_ids, "story_patch.run_modifier_ids");
  invariant(patch.run_modifier_ids.length === 2 && new Set(patch.run_modifier_ids).size === 2, "SCHEMA_RUN_MODIFIERS", "story_patch.run_modifier_ids必须恰为2个且互不相同");
  assertStringArray(patch.add_flags, "story_patch.add_flags");
  assertStringArray(patch.remove_flags, "story_patch.remove_flags");
  invariant(new Set(patch.add_flags).size === patch.add_flags.length, "SCHEMA_FLAGS", "story_patch.add_flags不得重复");
  invariant(new Set(patch.remove_flags).size === patch.remove_flags.length, "SCHEMA_FLAGS", "story_patch.remove_flags不得重复");
  invariant(!patch.add_flags.some(flag => patch.remove_flags.includes(flag)), "SCHEMA_FLAGS", "同一flag不得同时添加和移除");
  for (const flag of [...patch.add_flags, ...patch.remove_flags]) {
    invariant(/^[A-Z][A-Z0-9_]*$/.test(flag), "SCHEMA_FLAG_FORMAT", `非法稳定flag：${flag}`);
  }
  assertExactKeys(patch.route_delta, ["combat", "scheme", "cleanse"], "story_patch.route_delta");
  for (const key of ["combat", "scheme", "cleanse"]) assertInteger(patch.route_delta[key], `story_patch.route_delta.${key}`);
  invariant(Array.isArray(patch.npc_state_updates), "SCHEMA_NPC_UPDATES", "story_patch.npc_state_updates必须是array");
  patch.npc_state_updates.forEach((update, index) => {
    assertExactKeys(update, ["npc", "state"], `story_patch.npc_state_updates[${index}]`);
    assertString(update.npc, `story_patch.npc_state_updates[${index}].npc`);
    assertString(update.state, `story_patch.npc_state_updates[${index}].state`);
    invariant(NPC_STATES.has(update.state), "SCHEMA_NPC_STATE", `story_patch.npc_state_updates[${index}].state非法`);
  });
  invariant(new Set(patch.npc_state_updates.map(update => update.npc)).size === patch.npc_state_updates.length, "SCHEMA_NPC_UPDATES", "同一NPC不得重复更新");
  assertStringArray(patch.memory_notes, "story_patch.memory_notes");
  assertStringArray(patch.unresolved_hooks_added, "story_patch.unresolved_hooks_added");
  assertStringArray(patch.unresolved_hooks_resolved, "story_patch.unresolved_hooks_resolved");
  invariant(patch.memory_notes.length <= 3, "SCHEMA_MEMORY_NOTES", "story_patch.memory_notes每次最多3条");
  invariant(patch.unresolved_hooks_added.length <= 1, "SCHEMA_HOOKS_ADDED", "story_patch.unresolved_hooks_added每次最多1条");
  invariant(new Set(patch.unresolved_hooks_added).size === patch.unresolved_hooks_added.length, "SCHEMA_HOOKS", "story_patch.unresolved_hooks_added不得重复");
  invariant(new Set(patch.unresolved_hooks_resolved).size === patch.unresolved_hooks_resolved.length, "SCHEMA_HOOKS", "story_patch.unresolved_hooks_resolved不得重复");
  invariant(!patch.unresolved_hooks_added.some(hook => patch.unresolved_hooks_resolved.includes(hook)), "SCHEMA_HOOKS", "同一悬念不得同时添加和解决");
}

/** 五模板结构校验。业务引用、资源余额与pending一致性通过validateBusiness补充。 */
export function validateAdventureTemplate(document, {
  expectedTemplateName,
  expectedEventId = undefined,
  expectedSceneName = undefined,
  allowedEventIds = undefined
}) {
  invariant(TEMPLATE_NAMES.includes(expectedTemplateName), "BAD_CONFIG", "expectedTemplateName非法");
  invariant(isObject(document), "SCHEMA_ROOT", "根节点必须是object");
  invariant(isObject(document.event_details), "SCHEMA_EVENT_DETAILS", "缺少event_details");
  const details = document.event_details;
  assertString(details.template_name, "event_details.template_name");
  invariant(details.template_name === expectedTemplateName, "SCHEMA_TEMPLATE_MISMATCH", "template_name与expected不一致");

  if (expectedTemplateName === "新一轮事件") {
    assertExactKeys(document, ["event_details"], "root");
    assertExactKeys(details, [
      "template_name", "event_id", "current_round", "supply_value", "corruption_value",
      "current_theme", "current_type", "scene_name", "steps", "options"
    ], "event_details");
    assertString(details.event_id, "event_details.event_id");
    assertCommonHeader(details, "event_details");
    assertSteps(details.steps, "event_details.steps");
    assertOptions(details.options);
  } else if (expectedTemplateName === "战斗事件") {
    assertExactKeys(document, ["event_details", "combat_start", "enemies"], "root");
    assertExactKeys(details, [
      "template_name", "current_round", "supply_value", "corruption_value",
      "current_theme", "current_type", "scene_name", "steps"
    ], "event_details");
    assertCommonHeader(details, "event_details");
    assertSteps(details.steps, "event_details.steps");
    invariant(document.combat_start === true, "SCHEMA_COMBAT_START", "combat_start必须为true");
    invariant(Array.isArray(document.enemies) && document.enemies.length >= 1 && document.enemies.length <= 4, "SCHEMA_ENEMIES", "enemies数量必须为1-4");
    document.enemies.forEach((enemy, index) => {
      assertExactKeys(enemy, ["name"], `enemies[${index}]`);
      assertString(enemy.name, `enemies[${index}].name`);
    });
  } else if (expectedTemplateName === "检定") {
    assertExactKeys(document, ["event_details"], "root");
    assertExactKeys(details, ["template_name", "analysis", "result"], "event_details");
    assertString(details.analysis, "event_details.analysis");
    invariant(CHECK_RESULTS.has(details.result), "SCHEMA_CHECK_RESULT", "event_details.result非法");
  } else if (expectedTemplateName === "结算") {
    assertExactKeys(document, ["event_details"], "root");
    assertExactKeys(details, [
      "template_name", "event_id", "current_round", "supply_value", "corruption_value",
      "current_theme", "current_type", "scene_name", "steps", "summary", "story_patch", "final_chapter"
    ], "event_details");
    assertString(details.event_id, "event_details.event_id");
    assertCommonHeader(details, "event_details");
    assertSteps(details.steps, "event_details.steps");
    assertSummary(details.summary);
    assertStoryPatch(details.story_patch);
    assertBoolean(details.final_chapter, "event_details.final_chapter");
    invariant(details.story_patch.completed_event_id === details.event_id, "SCHEMA_PATCH_EVENT", "story_patch.completed_event_id与event_id不一致");
  } else {
    assertExactKeys(document, ["event_details"], "root");
    assertExactKeys(details, ["template_name", "content"], "event_details");
    assertString(details.content, "event_details.content");
  }

  if (expectedEventId !== undefined && own(details, "event_id")) {
    invariant(details.event_id === expectedEventId, "SCHEMA_EVENT_MISMATCH", "event_id与请求快照不一致");
  }
  if (allowedEventIds && own(details, "event_id")) {
    const allowed = allowedEventIds instanceof Set ? allowedEventIds : new Set(allowedEventIds);
    invariant(allowed.has(details.event_id), "SCHEMA_EVENT_NOT_ALLOWED", "event_id不在候选白名单");
  }
  if (expectedSceneName !== undefined && own(details, "scene_name")) {
    invariant(details.scene_name === expectedSceneName, "SCHEMA_SCENE_MISMATCH", "scene_name与请求快照不一致");
  }
  return document;
}

/** Fetch Response.body便捷适配；供应商返回原始YAML字节流时使用。 */
export async function consumeRawYamlResponse(response, parser) {
  invariant(response?.body?.getReader, "BAD_RESPONSE", "response.body不是ReadableStream");
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feedBytes(value);
    }
    return parser.finish();
  } catch (error) {
    parser.abort(`response_stream_failed: ${error?.message ?? String(error)}`);
    try { await reader.cancel(error); } catch {}
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}
