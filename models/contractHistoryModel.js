import mongoose, { Schema } from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const contractHistorySchema = new Schema(
  {
    agent: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Denormalized for fast reporting without joins
    agentName: { type: String },
    agentCode: { type: String },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    action: {
      type: String,
      enum: ["created", "renewed", "ended", "rejected", "auto_expired"],
      required: true,
    },

    duration: { type: String }, // preset key e.g. "3months" or "custom"
    startDate: { type: Date },
    endDate:   { type: Date },

    note: { type: String, trim: true },
  },
  {
    timestamps: true, // createdAt = performedAt
  }
);

// Indexes for common queries
contractHistorySchema.index({ agent: 1, createdAt: -1 });
contractHistorySchema.index({ action: 1 });
contractHistorySchema.index({ endDate: 1 });

const ContractHistory = getPrimaryConnection().model(
  "ContractHistory",
  contractHistorySchema,
  "contractHistories"
);

export default ContractHistory;
