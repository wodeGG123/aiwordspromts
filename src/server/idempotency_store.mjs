export class IdempotencyStore {
  #entries = new Map();
  #ttlMs;

  constructor({ ttlMs = 15 * 60 * 1000 } = {}) {
    this.#ttlMs = ttlMs;
  }

  get(requestId) {
    const entry = this.#entries.get(requestId);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.#ttlMs) {
      this.#entries.delete(requestId);
      return undefined;
    }
    return entry;
  }

  begin(requestId, fingerprint) {
    const existing = this.get(requestId);
    if (existing) return { created: false, entry: existing };
    const entry = { requestId, fingerprint, status: "accepted", createdAt: Date.now() };
    this.#entries.set(requestId, entry);
    return { created: true, entry };
  }

  update(requestId, patch) {
    const entry = this.get(requestId);
    if (!entry) return undefined;
    Object.assign(entry, patch, { updatedAt: Date.now() });
    return entry;
  }
}

export class FixedWindowRateLimiter {
  #buckets = new Map();
  #limit;
  #windowMs;

  constructor({ limit, windowMs = 60 * 1000 }) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  check(key) {
    const now = Date.now();
    let bucket = this.#buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.#windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.#limit) {
      const error = new Error("rate limit exceeded");
      error.code = "RATE_LIMITED";
      error.retryAfterSeconds = Math.ceil((this.#windowMs - (now - bucket.startedAt)) / 1000);
      throw error;
    }
  }
}
