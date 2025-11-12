import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const DumpHistorySchema = new mongoose.Schema(
  {
    callHistory_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallHistory",
      index: true,
    },
    callingData_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallingData",
      index: true,
    },
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      index: true,
    },

    Contact_ID: { type: String, trim: true },
    Full_Name: { type: String, trim: true },
    Job_Title: { type: String, trim: true },
    Mobile_No: { type: String, trim: true },
    Personal_Email1: { type: String, trim: true },
    Company_ID: { type: String, trim: true },
    Company_Name: { type: String, trim: true },

    isRegistered: { type: Boolean, default: false },

    pmName: { type: String, trim: true },
    clientName: { type: String, trim: true },
    clientEmail: { type: String, trim: true },
    clientContact: { type: String, trim: true },
    dataSourceType: { type: String, trim: true },

    lastRemarks: { type: String, trim: true },
    lastCallingDate: { type: Date },
    lastAgent_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastAgentName: { type: String, trim: true },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model(
  "DumpHistoryData",
  DumpHistorySchema
);
