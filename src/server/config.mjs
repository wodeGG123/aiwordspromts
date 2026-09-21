import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DEFAULT_LIMITS } from "./constants.mjs";

function integerEnv(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readApkInfo(env) {
  const candidate = env.APK_INFO_FILE || resolve(dirname(fileURLToPath(import.meta.url)), "../../apk-info.json");
  try {
    const raw = readFileSync(candidate, "utf8");
    const parsed = JSON.parse(raw);
    return {
      apkUrl: typeof parsed.url === "string" ? parsed.url : "",
      apkVersion: typeof parsed.version === "string" ? parsed.version : ""
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { apkUrl: "", apkVersion: "" };
    }
    throw new Error(`读取 APK 配置文件 ${candidate} 失败: ${error.message}`);
  }
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const apiKey = env.AI_API_KEY?.trim() || "";
  const clientOrigins = (env.CLIENT_ORIGINS || "http://localhost:5173")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  if (isProduction && !apiKey) throw new Error("AI_API_KEY is required in production");
  if (isProduction && clientOrigins.includes("*")) {
    throw new Error("CLIENT_ORIGINS cannot contain * in production");
  }

  const apkInfo = readApkInfo(env);

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: integerEnv(env, "PORT", 3000, { min: 1 }),
    aiBaseUrl: env.AI_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    aiApiKey: apiKey,
    aiModel: required({ AI_MODEL: env.AI_MODEL || "deepseek-v4-flash-ga-260731" }, "AI_MODEL"),
    clientOrigins,
    requestMaxBytes: integerEnv(env, "REQUEST_MAX_BYTES", DEFAULT_LIMITS.requestMaxBytes, { min: 1024 }),
    runtimeMaxChars: integerEnv(env, "RUNTIME_MAX_CHARS", DEFAULT_LIMITS.runtimeMaxChars, { min: 1 }),
    outputMaxChars: integerEnv(env, "AI_MAX_OUTPUT_CHARS", DEFAULT_LIMITS.outputMaxChars, { min: 1 }),
    maxCompletionTokens: integerEnv(env, "AI_MAX_COMPLETION_TOKENS", DEFAULT_LIMITS.maxCompletionTokens, { min: 256 }),
    sseHeartbeatMs: integerEnv(env, "SSE_HEARTBEAT_MS", DEFAULT_LIMITS.sseHeartbeatMs, { min: 100 }),
    rateLimitPerMinute: integerEnv(env, "RATE_LIMIT_PER_MINUTE", DEFAULT_LIMITS.rateLimitPerMinute, { min: 1 }),
    maxConcurrentPerIp: integerEnv(env, "MAX_CONCURRENT_PER_IP", DEFAULT_LIMITS.maxConcurrentPerIp, { min: 1 }),
    enablePromptFilter: env.ENABLE_PROMPT_FILTER === "true",
    promptBlacklist: (env.PROMPT_BLACKLIST || "").split(",").map(value => value.trim()).filter(Boolean),
    apkUrl: apkInfo.apkUrl,
    apkVersion: apkInfo.apkVersion,
    proxyEnabled: env.PROXY_ENABLED !== "false",
    proxyPort: integerEnv(env, "PROXY_PORT", 3001, { min: 1 }),
    proxyTarget: env.PROXY_TARGET || "https://f8q3w6v1.dimecho.com"
  });
}
