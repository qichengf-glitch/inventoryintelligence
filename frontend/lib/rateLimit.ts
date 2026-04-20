/**
 * Simple in-memory rate limiter for OpenAI API routes.
 *
 * Limits: per-IP, per-route, per-window.
 * Uses a sliding window counter stored in a Map.
 *
 * ⚠️  In-memory only — resets on server restart.
 *     Good enough for a single-instance DigitalOcean deployment.
 */

type RateLimitRecord = { count: number; windowStart: number };

const store = new Map<string, RateLimitRecord>();

// Clean up stale entries every 10 minutes to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now - record.windowStart > 10 * 60 * 1000) store.delete(key);
  }
}, 10 * 60 * 1000);

export interface RateLimitOptions {
  /** Max requests allowed in the window. Default: 10 */
  limit?: number;
  /** Window duration in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number;
  /** Route identifier used as part of the key. Default: "default" */
  route?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // ms timestamp
}

/**
 * Check whether the given IP is within the rate limit.
 *
 * @example
 * const ip = req.headers.get("x-forwarded-for") ?? "unknown";
 * const { allowed, remaining } = checkRateLimit(ip, { route: "ask-data", limit: 20 });
 * if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */
export function checkRateLimit(
  ip: string,
  options: RateLimitOptions = {}
): RateLimitResult {
  const { limit = 10, windowMs = 60_000, route = "default" } = options;

  const key = `${route}:${ip}`;
  const now = Date.now();
  const record = store.get(key);

  if (!record || now - record.windowStart > windowMs) {
    // Start a fresh window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (record.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: record.windowStart + windowMs,
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: limit - record.count,
    resetAt: record.windowStart + windowMs,
  };
}

/**
 * Extract the best-effort client IP from a Next.js Request.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
