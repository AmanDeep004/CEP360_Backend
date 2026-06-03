import Redis from "ioredis";

let client = null;
let redisAvailable = false;

export const connectRedis = async () => {
  try {
    client = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying, fall back to no-cache
        return Math.min(times * 200, 1000);
      },
    });

    client.on("connect", () => {
      redisAvailable = true;
      console.log("Redis connected");
    });

    client.on("error", (err) => {
      redisAvailable = false;
      // Suppress repeated error logs — just mark unavailable
    });

    client.on("close", () => {
      redisAvailable = false;
    });

    await client.connect();
  } catch (err) {
    console.warn("Redis unavailable — running without cache:", err.message);
    redisAvailable = false;
  }
};

export const getRedis = () => client;
export const isRedisAvailable = () => redisAvailable;
