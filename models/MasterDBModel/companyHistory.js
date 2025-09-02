import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

//company history schema for keeping the history of comapany
const CompanyHistorySchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    snapshot: { type: Object },
    updatedFields: { type: [String] },
    updatedBy: {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: String,
      email: String,
      employeeCode: String,
      mobile: Number,
    },
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
