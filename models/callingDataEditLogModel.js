import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const callingDataEditLogSchema = new mongoose.Schema(
  {
    callingDataId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallingData",
      required: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedByName: { type: String, trim: true },
    updatedByRole: { type: String, trim: true },
    action: {
      type: String,
      enum: ["created", "updated"],
      default: "updated",
    },
    changedFields: [
      {
        field:    { type: String, required: true },
        oldValue: { type: mongoose.Schema.Types.Mixed },
        newValue: { type: mongoose.Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true }
);

callingDataEditLogSchema.index({ callingDataId: 1, createdAt: -1 });
callingDataEditLogSchema.index({ updatedBy: 1, createdAt: -1 });

export default getPrimaryConnection().model("CallingDataEditLog", callingDataEditLogSchema);
