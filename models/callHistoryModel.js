import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const chatEntrySchema = new mongoose.Schema(
  {
    contactNo: { type: String, required: true },
    remarks: {
      type: String,
      required: true,
    },
    reason: { type: String, required: true },
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
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    isRegistered: { type: Boolean, default: false },
    registrationDate: { type: Date },
    chatHistory: [chatEntrySchema],
  },
  { timestamps: true }
);

export default getPrimaryConnection().model("CallHistory", callHistorySchema);
