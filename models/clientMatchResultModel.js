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
    chunkType: {
      type: String,
      enum: ["complete", "partial", "notMatched"],
      required: true,
    },
    chunkIndex: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

// Primary lookup: all chunks for a campaign in order
clientMatchResultSchema.index(
  { campaignId: 1, dataType: 1, chunkType: 1, chunkIndex: 1 },
  { unique: true }
);

export default getPrimaryConnection().model(
  "ClientMatchResult",
  clientMatchResultSchema
);
