import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const CompanyHistorySchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    snapshot: { type: Object },
    updatedFields: { type: [String] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedAt: { type: Date, default: Date.now },
    changeType: {
      type: String,
      enum: ["update", "delete"],
      default: "update",
    },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model(
  "CompanyHistory",
  CompanyHistorySchema
);
