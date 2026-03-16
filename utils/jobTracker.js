const jobs = new Map();

export const createJob = async (type, total) => {
  const jobId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  jobs.set(jobId, {
    jobId,
    status: "running",
    type,
    total,
    success: 0,
    failed: 0,
    createdAt: Date.now(),
    completedAt: null,
    failReason: null,
  });
  return jobId;
};

export const updateJob = async (jobId, success = 0, failed = 0) => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.success += success;
  job.failed += failed;
};

export const completeJob = async (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "completed";
  job.completedAt = Date.now();
};

export const failJob = async (jobId, reason = "Unknown error") => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "failed";
  job.failReason = reason;
};

export const getJob = async (jobId) => {
  return jobs.get(jobId) || null;
};
