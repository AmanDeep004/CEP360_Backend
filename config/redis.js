import Redis from "ioredis";

let redisClient = null;

export const getRedisClient = () => {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) {
          console.error("[Redis] Max retries reached. Giving up.");
          return null;
        }
        return Math.min(times * 300, 3000);
      },
    });

    redisClient.on("ready", () => console.log("[Redis] Connected and ready"));
    redisClient.on("error", (err) => console.error("[Redis] Error:", err.message));
    redisClient.on("close", () => console.warn("[Redis] Connection closed"));
  }
  return redisClient;
};

export const disconnectRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("[Redis] Disconnected");
  }
};
