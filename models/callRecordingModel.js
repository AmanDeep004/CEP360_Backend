import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const callRecordingSchema = new mongoose.Schema(
  {
    callingData_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallingData",
    },
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },
    sessionId: { type: String },
    contactNo: { type: String },
    callingDate: { type: Date, default: Date.now },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    agentName: { type: String },
    // Call identification & status
    callId: { type: String },
    callStatus: { type: String, default: "initiated" }, // initiated | ringing | connected | completed | failed
    callSource: { type: String, default: "tata" },      // tata | telecmi
    callDuration: { type: Number },                     // in seconds

    // Recording & webhook audit trail
    recording: { type: String },
    webHookResponse: { type: Array },
    misc: { type: Object },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model(
  "CallRecording",
  callRecordingSchema
);
