import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const SharedFilterSchema = new mongoose.Schema(
  {
    filterId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    campaignFilterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampaignFilter",
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },

    revisionNo: {
      type: Number,
      required: true,
    },
    listName: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    views: {
      type: Number,
      default: 0,
    },
    lastViewedAt: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    allowedDevices: {
      type: Number,
      default: 3,
    },
    accessDevices: [
      {
        deviceId: String,
        ip: String,
        userAgent: String,
        firstAccessAt: Date,
        lastAccessAt: Date,
      },
    ],
    misc: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

// Compound index for campaign + revision
SharedFilterSchema.index({ campaignId: 1, revisionNo: 1 });

// Auto-delete expired links
SharedFilterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default getPrimaryConnection().model("SharedFilter", SharedFilterSchema);
