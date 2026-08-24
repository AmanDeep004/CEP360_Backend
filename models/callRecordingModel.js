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

// Tata webhook (tataSmartFloWebhook) + hangupCall/getCallStatus all look up by
// callId — previously unindexed, forcing a full collection scan on every one of
// Tata's several webhook events per call (ringing/connected/completed/recording).
// Not unique: duplicate callId rows can occur and are cleaned up separately
// (see controllers/callRecordingController.js's dedup logic).
callRecordingSchema.index({ callId: 1 });

// getRecordingsByContact ("get call recording data" for a contact) — filters by
// callingData_id and sorts by callingDate.
callRecordingSchema.index({ callingData_id: 1, callingDate: -1 });

// getAgentLiveStatus — polled every 20s per open PM/RM dashboard.
callRecordingSchema.index({ agent_id: 1, callStatus: 1, callingDate: 1 });

export default getPrimaryConnection().model(
  "CallRecording",
  callRecordingSchema
);
