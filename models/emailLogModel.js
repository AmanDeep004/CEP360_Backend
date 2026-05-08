import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";
import { EmailTrigger } from "../utils/enum.js";

const emailLogSchema = new mongoose.Schema(
  {
    // Who received the email
    to: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    recipientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // What was sent
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String, // raw HTML body (before brand-wrapper is applied)
      required: true,
    },

    // Why it was sent
    trigger: {
      type: String,
      required: true,
      enum: Object.values(EmailTrigger),
      index: true,
    },

    // Context references
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
      index: true,
    },

    // Result
    status: {
      type: String,
      enum: ["sent", "failed"],
      required: true,
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt = when the send was attempted
  }
);

// Common queries: logs by campaign, by recipient, by trigger type
emailLogSchema.index({ campaignId: 1, trigger: 1 });
emailLogSchema.index({ recipientUserId: 1, createdAt: -1 });

export default getPrimaryConnection().model("EmailLog", emailLogSchema);
