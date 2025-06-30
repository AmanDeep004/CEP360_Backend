import mongoose from "mongoose";

const CallingDataSchema = new mongoose.Schema(
  {
    CampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    UploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    salutations: { type: String, trim: true },
    full_Name: { type: String, trim: true },
    job_Title: { type: String, trim: true },
    contact_City: { type: String, trim: true },
    contact_State: { type: String, trim: true },
    contact_Region: { type: String, trim: true },
    mobile_No: { type: Number },
    office_Email_1: { type: String, trim: true },
    office_Email_2: { type: String, trim: true },
    personal_Email1: { type: String, trim: true },
    personal_Email2: { type: String, trim: true },
    contact_LinkedIn_Profile: { type: String, trim: true },
    company_Name: { type: String, trim: true },
    source: {
      type: String,
      trim: true,
    },
    batch: { type: String, trim: true },
    pmId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pmName: { type: String, trim: true },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    isRegistered: {
      type: Boolean,
      default: false,
    },
    registeredOn: {
      type: Date,
      default: null,
    },
    callHistory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallHistory",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("CallingData", CallingDataSchema);
