import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

/**
 * Stores persisted match results in chunks to stay under MongoDB's 16 MB document limit.
 * Each document holds one chunk of one result type for one campaign.
 */
const clientMatchResultSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    dataType: { type: String, default: "Client" },
    // ISO timestamp string — groups all chunks from one upload together.
    // Also used as the history tab label.
    uploadSession: { type: String, required: true },
    chunkType: {
      type: String,
      enum: ["complete", "partial", "notMatched", "duplicates", "meta"],
      required: true,
    },
    chunkIndex: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

// Primary lookup + uniqueness guarantee (upsert key)
clientMatchResultSchema.index(
  { campaignId: 1, dataType: 1, uploadSession: 1, chunkType: 1, chunkIndex: 1 },
  { unique: true }
);

// Supports queries that filter by chunkType without specifying uploadSession:
//   - findOne({ campaignId, dataType, chunkType: "meta" }).sort({ uploadSession: -1 })
//   - distinct("uploadSession", { campaignId, dataType, chunkType: {$in:[...]} })
//   - find({ campaignId, dataType, uploadSession, chunkType }).sort({ chunkIndex: 1 })
clientMatchResultSchema.index(
  { campaignId: 1, dataType: 1, chunkType: 1, uploadSession: -1, chunkIndex: 1 }
);

const ClientMatchResult = getPrimaryConnection().model(
  "ClientMatchResult",
  clientMatchResultSchema
);

// One-time migration: drop the old index that was missing uploadSession.
// Causes E11000 on every re-upload for the same campaign.
// Safe to call repeatedly — silently ignored if the index no longer exists.
ClientMatchResult.collection
  .dropIndex("campaignId_1_dataType_1_chunkType_1_chunkIndex_1")
  .catch(() => {});

export default ClientMatchResult;
