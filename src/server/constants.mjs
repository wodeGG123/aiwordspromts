export const CONTRACTS = Object.freeze({
  streaming: "yaml-visible-fields-v3",
  runtime: "adventure-runtime-v5",
  templates: "five-template-v3",
  output: "five-template-v3",
  framing: "fixed_template_quoted_scalar_v1",
  package_version: "2026.11.01.3",
  campaign: "continuous-eight-chapter-v3"
});

export const TEMPLATES = Object.freeze(["新一轮事件", "战斗事件", "检定", "结算", "终章"]);

export const DEFAULT_LIMITS = Object.freeze({
  requestMaxBytes: 8 * 1024 * 1024,
  runtimeMaxChars: 256 * 1024,
  outputMaxChars: 256 * 1024,
  maxCompletionTokens: 16 * 1024,
  sseHeartbeatMs: 5 * 1000,
  rateLimitPerMinute: 30,
  maxConcurrentPerIp: 2
});
