import { getRedisClient } from "../config/redis.js";

const JOB_TTL_SECONDS = 86400; // 24 hours

/**
 * Create a new job and return its ID.
 * @param {"email"|"whatsapp"} type
 * @param {number} total - Total records to process
 * @returns {string} jobId
 */
export const createJob = async (type, total) => {
  const jobId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const redis = getRedisClient();

  await redis.hset(`job:${jobId}`,
    "status",    "running",
    "type",      type,
    "total",     String(total),
    "success",   "0",
    "failed",    "0",
    "createdAt", String(Date.now())
  );
  await redis.expire(`job:${jobId}`, JOB_TTL_SECONDS);

  return jobId;
};

/**
 * Increment success/failed counters for a job.
 * @param {string} jobId
 * @param {number} success
 * @param {number} failed
 */
export const updateJob = async (jobId, success = 0, failed = 0) => {
  const redis = getRedisClient();
  try {
    if (success > 0) await redis.hincrby(`job:${jobId}`, "success", success);
    if (failed > 0)  await redis.hincrby(`job:${jobId}`, "failed",  failed);
  } catch (err) {
    console.warn("[JobTracker] updateJob failed:", err.message);
  }
};

/**
 * Mark a job as completed.
 * @param {string} jobId
 */
export const completeJob = async (jobId) => {
  const redis = getRedisClient();
  try {
    await redis.hset(`job:${jobId}`, "status", "completed", "completedAt", String(Date.now()));
  } catch (err) {
    console.warn("[JobTracker] completeJob failed:", err.message);
  }
};

/**
 * Mark a job as failed.
 * @param {string} jobId
 * @param {string} reason
 */
export const failJob = async (jobId, reason = "Unknown error") => {
  const redis = getRedisClient();
  try {
    await redis.hset(`job:${jobId}`, "status", "failed", "failReason", reason);
  } catch (err) {
    console.warn("[JobTracker] failJob failed:", err.message);
  }
};

/**
 * Get job status and progress.
 * @param {string} jobId
 * @returns {object|null}
 */
export const getJob = async (jobId) => {
  const redis = getRedisClient();
  try {
    const data = await redis.hgetall(`job:${jobId}`);
    if (!data || !data.status) return null;
    return {
      jobId,
      status:      data.status,
      type:        data.type,
      total:       parseInt(data.total)       || 0,
      success:     parseInt(data.success)     || 0,
      failed:      parseInt(data.failed)      || 0,
      createdAt:   parseInt(data.createdAt)   || 0,
      completedAt: parseInt(data.completedAt) || null,
      failReason:  data.failReason            || null,
    };
  } catch (err) {
    console.warn("[JobTracker] getJob failed:", err.message);
    return null;
  }
};
