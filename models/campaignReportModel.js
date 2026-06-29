import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";
import crypto from "crypto";

const CampaignReportSchema = new mongoose.Schema(
  {
    campaignId:   { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    campaignName: { type: String, trim: true },
    pmId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pmName:       { type: String, trim: true },
    dateFrom:     { type: Date, required: true },
    dateTo:       { type: Date, required: true },
    timeFrom:     { type: String, default: "" }, // "HH:mm" — optional
    timeTo:       { type: String, default: "" },
    reportType:   { type: String, enum: ["called", "overall"], required: true },
    shareToken:   {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(28).toString("hex"),
    },
    expiresAt:    { type: Date, required: true },
  },
  { timestamps: true }
);

CampaignReportSchema.index({ campaignId: 1, createdAt: -1 });
CampaignReportSchema.index({ shareToken: 1 });

export default getPrimaryConnection().model("CampaignReport", CampaignReportSchema);
