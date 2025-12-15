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
    //webhook response
    callId: { type: String },
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
