/**
 * recordingsController.js
 * Lists all recordings from S3 Recordings/ folder.
 * Uses read-only S3 credentials (list-only IAM user).
 */

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendResponse } = errorHandler;

const s3 = new S3Client({
  region: process.env.S3_RECORDINGS_REGION || "ap-south-1",
  credentials: {
    accessKeyId:     process.env.S3_RECORDINGS_ACCESS_KEY,
    secretAccessKey: process.env.S3_RECORDINGS_SECRET_KEY,
  },
});

const BUCKET   = process.env.S3_RECORDINGS_BUCKET || "kestone-cep";
const BASE_URL = `https://${BUCKET}.s3.ap-south-1.amazonaws.com`;

// ── GET /api/recordings ────────────────────────────────────────────────────────
// Lists all recordings grouped by month → campaign folder.
// Query params:
//   ?month=2026-08          filter to a specific month
//   ?campaign=Campaign Name filter by campaign folder name (partial match)
//   ?flat=true              return flat array instead of grouped tree
export const getRecordings = asyncHandler(async (req, res) => {
  const { month, campaign, flat } = req.query;
  const prefix = month ? `Recordings/${month}/` : "Recordings/";

  const allFiles = [];
  let token = undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket:            BUCKET,
      Prefix:            prefix,
      ContinuationToken: token,
      MaxKeys:           1000,
    });
    const r = await s3.send(cmd);
    for (const obj of r.Contents || []) {
      if (obj.Key.endsWith("/")) continue;
      const parts        = obj.Key.split("/"); // ["Recordings","2026-08","Campaign","file.mp3"]
      const monthFolder  = parts[1] || "unknown";
      const campaignFolder = parts[2] || "unknown";
      const filename     = parts.slice(3).join("/");
      allFiles.push({
        key:            obj.Key,
        url:            `${BASE_URL}/${obj.Key}`,
        month:          monthFolder,
        campaign:       campaignFolder,
        filename,
        sizeBytes:      obj.Size,
        lastModified:   obj.LastModified,
      });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  // Filter by campaign name (partial match)
  const filtered = campaign
    ? allFiles.filter(f => f.campaign.toLowerCase().includes(campaign.toLowerCase()))
    : allFiles;

  if (flat === "true") {
    return sendResponse(res, 200, `${filtered.length} recordings found`, {
      total: filtered.length,
      files: filtered,
    });
  }

  // Group by month → campaign
  const tree = {};
  for (const f of filtered) {
    if (!tree[f.month]) tree[f.month] = {};
    if (!tree[f.month][f.campaign]) tree[f.month][f.campaign] = [];
    tree[f.month][f.campaign].push({ filename: f.filename, url: f.url, sizeBytes: f.sizeBytes, lastModified: f.lastModified });
  }

  const months = Object.keys(tree).sort().reverse().map(m => ({
    month:      m,
    totalFiles: Object.values(tree[m]).reduce((s, a) => s + a.length, 0),
    campaigns:  Object.keys(tree[m]).sort().map(c => ({
      name:  c,
      count: tree[m][c].length,
      files: tree[m][c],
    })),
  }));

  return sendResponse(res, 200, `${filtered.length} recordings found`, {
    total:  filtered.length,
    bucket: BUCKET,
    months,
  });
});
