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
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: { type: String },
      employeeName: { type: String },
      email: { type: String },
      role: { type: String },
      mobile: { type: String },
      location: { type: String },
      designation: { type: String },
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
