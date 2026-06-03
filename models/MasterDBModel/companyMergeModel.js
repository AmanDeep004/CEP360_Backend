import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const CompanyMergeSchema = new mongoose.Schema(
  {
    parentCompany: {
      id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true,
        index: true,
      },
      name: { type: String },
    },
    mergedCompanies: [
      {
        id: { type: mongoose.Schema.Types.ObjectId },
        name: { type: String },
      },
    ],
    // Full snapshots of deleted companies — used to revert if needed
    mergedCompaniesSnapshot: [{ type: mongoose.Schema.Types.Mixed }],
    // IDs of contacts that were re-linked — used to revert if needed
    relinkedContactIds: [{ type: mongoose.Schema.Types.ObjectId }],
    contactsRelinked: { type: Number, default: 0 },
    mergedBy: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: { type: String },
      employeeName: { type: String },
      email: { type: String },
      role: { type: String },
    },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model("CompanyMerge", CompanyMergeSchema);
