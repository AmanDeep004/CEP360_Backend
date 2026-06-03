import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const chatEntrySchema = new mongoose.Schema(
  {
    contactNo: { type: String, required: true },
    remarks: {
      type: String,
      required: true,
    },
    reason: { type: String },
    callingDate: { type: Date, default: Date.now },
    isRegistered: { type: Boolean, default: false },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    agentName: { type: String, required: true },
  },
  { _id: false },
  { timestamps: true }
);

const callHistorySchema = new mongoose.Schema(
  {
    callingData_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallingData",
      required: true,
    },
    // campaign_id: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "Campaign",
    //   required: true,
    // },
    isRegistered: { type: Boolean, default: false },
    registrationDate: { type: Date },
    chatHistory: [chatEntrySchema],
  },
  { timestamps: true }
);

// Fetch all call histories for a specific contact (most common query)
callHistorySchema.index({ callingData_id: 1 });

// Fetch all call histories for a campaign (reporting, dashboards)
callHistorySchema.index({ campaign_id: 1, createdAt: -1 });

// Compound: filter by campaign + contact (upsert / update patterns)
callHistorySchema.index({ callingData_id: 1, campaign_id: 1 });

export default getPrimaryConnection().model("CallHistory", callHistorySchema);
