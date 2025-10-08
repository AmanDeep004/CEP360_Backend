import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

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
        values: ["ClientData", "KestoneData", "Both"],
      },
    },
    companyNames: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

export default getPrimaryConnection().model(
  "ClientCompanyList",
  clientCompanyListSchema
);
