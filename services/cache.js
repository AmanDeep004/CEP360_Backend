import { getRedis, isRedisAvailable } from "../config/redis.js";

const DEFAULT_TTL = 60 * 60; // 1 hour

/**
 * Get a cached value. Returns null if cache miss or Redis unavailable.
 */
export const cacheGet = async (key) => {
  if (!isRedisAvailable()) return null;
  try {
    const val = await getRedis().get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
};

/**
 * Set a cache value with optional TTL in seconds.
 */
export const cacheSet = async (key, value, ttl = DEFAULT_TTL) => {
  if (!isRedisAvailable()) return;
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    // Cache write failure is non-fatal
  }
};

/**
 * Delete all keys matching a pattern (e.g. "dropdown:*").
 * Uses SCAN to avoid blocking Redis with KEYS on large datasets.
 */
export const cacheInvalidatePattern = async (pattern) => {
  if (!isRedisAvailable()) return;
  try {
    const redis = getRedis();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Non-fatal
  }
};

/**
 * Delete a single key.
 */
export const cacheDel = async (key) => {
  if (!isRedisAvailable()) return;
  try {
    await getRedis().del(key);
  } catch {
    // Non-fatal
  }
};
