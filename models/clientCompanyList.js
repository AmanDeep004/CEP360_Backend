import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const companyEntrySchema = {
  _id: false,
  companyId: { type: mongoose.Schema.Types.ObjectId },
  Company_Name: { type: String },
};

const clientCompanyListSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    dataType: {
      type: String,
      enum: {
        values: ["Kestone", "Client", "Both", "ThirdParty"],
      },
      default: "Kestone",
    },
    companyNames: [{ type: String, trim: true }],
    // Store both companyId and Company_Name so they can be displayed on restore
    approvedIds: [companyEntrySchema],
    rejectedIds: [companyEntrySchema],
  },
  { timestamps: true }
);

export default getPrimaryConnection().model(
  "ClientCompanyList",
  clientCompanyListSchema
);
