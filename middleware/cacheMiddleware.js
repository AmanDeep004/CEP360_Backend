import { getRedisClient } from "../config/redis.js";

/**
 * Cache middleware for GET routes.
 * Usage: router.get("/route", cache(300), handler)
 * @param {number} ttlSeconds - Cache TTL in seconds (default 5 min)
 */
export const cache = (ttlSeconds = 300) => async (req, res, next) => {
  // Only cache GET requests
  if (req.method !== "GET") return next();

  const redis = getRedisClient();
  const key = `cache:${req.originalUrl}`;

  try {
    const cached = await redis.get(key);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  } catch (err) {
    // Redis unavailable — skip cache, proceed normally
    console.warn("[Cache] Redis get failed:", err.message);
    return next();
  }

  // Intercept res.json to store response in cache
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // Only cache successful responses
    if (res.statusCode === 200) {
      getRedisClient()
        .set(key, JSON.stringify(body), "EX", ttlSeconds)
        .catch((err) => console.warn("[Cache] Redis set failed:", err.message));
    }
    return originalJson(body);
  };

  next();
};

/**
 * Invalidate cache for a specific key pattern.
 * @param {string} pattern - Key pattern (e.g. "/api/whatsapp/getAllWhatsappTemplates")
 */
export const invalidateCache = async (pattern) => {
  const redis = getRedisClient();
  try {
    const keys = await redis.keys(`cache:*${pattern}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    console.warn("[Cache] Invalidate failed:", err.message);
  }
};
