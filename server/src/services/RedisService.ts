import { createClient, RedisClientType } from "redis";

let redis: RedisClientType | null = null;
let isConnected = false;

// In-memory fallback when Redis is not available
const memoryStore = new Map<string, { value: string; expiresAt?: number }>();

function cleanExpired() {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt && entry.expiresAt < now) {
      memoryStore.delete(key);
    }
  }
}

// Clean expired keys every 30s
setInterval(cleanExpired, 30000);

export async function initRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("[REDIS] No REDIS_URL set — using in-memory fallback");
    return;
  }

  try {
    redis = createClient({ url });
    redis.on("error", (err) => {
      console.error("[REDIS] Error:", err.message);
      isConnected = false;
    });
    redis.on("connect", () => {
      isConnected = true;
      console.log("[REDIS] Connected");
    });
    redis.on("end", () => {
      isConnected = false;
    });
    await redis.connect();
  } catch (err: any) {
    console.warn("[REDIS] Failed to connect:", err.message, "— using in-memory fallback");
    redis = null;
  }
}

export function getRedisClient(): RedisClientType | null {
  return isConnected ? redis : null;
}

export function isRedisAvailable(): boolean {
  return isConnected && redis !== null;
}

// --- Cache operations (Redis with in-memory fallback) ---

export async function cacheGet(key: string): Promise<string | null> {
  if (isConnected && redis) {
    try {
      return await redis.get(key);
    } catch {
      // fallback below
    }
  }
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (isConnected && redis) {
    try {
      if (ttlSeconds) {
        await redis.setEx(key, ttlSeconds, value);
      } else {
        await redis.set(key, value);
      }
      return;
    } catch {
      // fallback below
    }
  }
  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
  });
}

export async function cacheDel(key: string): Promise<void> {
  if (isConnected && redis) {
    try {
      await redis.del(key);
    } catch {}
  }
  memoryStore.delete(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  if (isConnected && redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(keys);
    } catch {}
  }
  // In-memory fallback: simple prefix match
  const prefix = pattern.replace("*", "");
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
    }
  }
}
