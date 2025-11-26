import errorHandler from "../../utils/index.js";
import LinkedinProfile from "../../models/Linkedin/profileList.js";
import { request } from "express";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const uploadProfiles = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "No CSV file uploaded", 400);
    }
    const parsedRows = [];
    const fileBuffer = request.file.buffer.toString("utf8");

    await new Promise((resolve, reject) => {
      parse(fileBuffer, { columns: true, trim: true }, (err, records) => {
        if (err) return reject(err);
        parsedRows.push(...records);
        resolve();
      });
    });

    if (!parsedRows.length) {
      return sendError(next, "CSV has no valid rows", 400);
    }
    const existingCount = await LinkedinProfile.countDocuments();
    const nextBatchNumber = Math.floor(existingCount / parsedRows.length) + 1;
    const batchName = `Batch-${nextBatchNumber}`;

    let inserted = 0;
    let duplicate = 0;
    const docsToInsert = [];

    for (const row of parsedRows) {
      const profileUrl =
        row.linkedin_profile_url || row.linkedin || row.profile_url;

      if (!profileUrl) continue;

      // Extract a unique LinkedIn ID from URL
      const linkedinId = profileUrl.split("/in/")[1]?.replace(/\/$/, "");

      if (!linkedinId) continue;

      // Skip duplicates
      const exists = await LinkedinProfile.exists({ linkedinId });
      if (exists) {
        duplicate++;
        continue;
      }

      docsToInsert.push({
        linkedinId,
        enrichedData: {},
        batchName,
      });
    }

    if (docsToInsert.length > 0) {
      await LinkedinProfile.insertMany(docsToInsert);
      inserted = docsToInsert.length;
    }

    return sendResponse(res, 200, "CSV uploaded successfully", {
      batchName,
      totalRows: parsedRows.length,
      inserted,
      duplicate,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export { uploadProfiles };
