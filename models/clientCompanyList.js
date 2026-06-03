import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const companyEntrySchema = {
  _id: false,
  companyId: { type: mongoose.Schema.Types.ObjectId },
  Company_Name: { type: String },
  inputName: { type: String }, // which uploaded row this approval/rejection belongs to
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

clientCompanyListSchema.index({ campaignId: 1, dataType: 1 });

export default getPrimaryConnection().model(
  "ClientCompanyList",
  clientCompanyListSchema
);
