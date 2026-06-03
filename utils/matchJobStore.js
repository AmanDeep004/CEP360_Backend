/**
 * matchJobStore.js
 * In-memory pub/sub store for company-matching jobs.
 * Each job goes through: running → completed | failed
 * SSE clients subscribe as listeners and receive push events.
 */

const matchJobs = new Map();

export const createMatchJob = () => {
  const jobId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  matchJobs.set(jobId, {
    jobId,
    status: "running",
    stage: "Starting...",
    percent: 0,
    result: null,
    error: null,
    listeners: new Set(),
  });
  return jobId;
};

const notify = (job, event) => {
  for (const fn of job.listeners) fn(event);
};

export const updateMatchJob = (jobId, stage, percent) => {
  const job = matchJobs.get(jobId);
  if (!job) return;
  job.stage = stage;
  job.percent = percent;
  notify(job, { type: "progress", stage, percent });
};

export const completeMatchJob = (jobId) => {
  const job = matchJobs.get(jobId);
  if (!job) return;
  job.status = "completed";
  job.percent = 100;
  // Send only a signal — no result payload (avoids oversized SSE events for large datasets)
  notify(job, { type: "complete" });
  // Auto-cleanup after 10 minutes
  setTimeout(() => matchJobs.delete(jobId), 600_000);
};

export const failMatchJob = (jobId, error) => {
  const job = matchJobs.get(jobId);
  if (!job) return;
  job.status = "failed";
  job.error = error;
  notify(job, { type: "error", error });
  setTimeout(() => matchJobs.delete(jobId), 60_000);
};

/**
 * Subscribe a listener to a job.
 * If the job is already done, fires immediately with result/error.
 * Returns false if job doesn't exist.
 */
export const subscribeMatchJob = (jobId, listener) => {
  const job = matchJobs.get(jobId);
  if (!job) return false;
  if (job.status === "completed") {
    listener({ type: "complete", result: job.result });
    return true;
  }
  if (job.status === "failed") {
    listener({ type: "error", error: job.error });
    return true;
  }
  job.listeners.add(listener);
  return true;
};

export const unsubscribeMatchJob = (jobId, listener) => {
  const job = matchJobs.get(jobId);
  if (job) job.listeners.delete(listener);
};
