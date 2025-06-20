import mongoose from "mongoose";

const chatEntrySchema = new mongoose.Schema(
  {
    remarks: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: [
        "interested",
        "not_interested",
        "follow_up",
        "callback",
        "wrong_number",
        "other",
      ],
    },
    updateDate: { type: Date, default: Date.now },
  },
  { _id: false }
);

const callHistorySchema = new mongoose.Schema(
  {
    calling_data_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampaignDatabase",
      required: true,
    },
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    call_date: { type: Date, required: true },

    status: {
      type: String,
      required: true,
      enum: [
        "interested",
        "not_interested",
        "follow_up",
        "callback",
        "wrong_number",
        "other",
      ],
    },
    remarks: { type: String },
    isRegistered: { type: Boolean, default: false },

    lastRemarks: { type: String },
    lastStatus: {
      type: String,
      enum: [
        "interested",
        "not_interested",
        "follow_up",
        "callback",
        "wrong_number",
        "other",
      ],
    },

    chatHistory: [chatEntrySchema],
  },
  { timestamps: true }
);

export default mongoose.model("CallHistory", callHistorySchema);
