import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const callRecordingSchema = new mongoose.Schema(
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
    sessionId: { type: String },
    contactNo: { type: String, required: true },
    callingDate: { type: Date, default: Date.now },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    agentName: { type: String, required: true },
    //webhook response
    callId: { type: String, required: true },
    recording: { type: String },
    webHookResponse: { type: Object },
    misc: { type: Object },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model(
  "CallRecording",
  callRecordingSchema
);
