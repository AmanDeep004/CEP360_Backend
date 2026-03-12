import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const callingDataEditApprovalSchema = new mongoose.Schema(
  {
    callingDataId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CallingData",
      required: true,
    },
    contact_Id: { type: String, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedFields: [
      {
        field: { type: String, required: true },
        oldValue: { type: mongoose.Schema.Types.Mixed, required: true },
        newValue: { type: mongoose.Schema.Types.Mixed, required: true },
      },
    ],
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    requestedAt: { type: Date, default: Date.now },
    approvedorRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedOrRejectedAt: { type: Date },
    remarks: { type: Array, default: "" },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model(
  "CallingDataEditApproval",
  callingDataEditApprovalSchema
);
