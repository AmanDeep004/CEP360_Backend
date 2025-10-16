import { Schema } from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const CampaignFilterSchema = new Schema(
  {
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "Campaign",
      required: [true, "Campaign ID is required"],
      index: true,
    },
    //for the filtration to check whether the data is client data or kestone data or both
    dataType: {
      type: String,
      enum: ["Kestone", "Client", "Both", "ThirdParty"],
    },

    filters: [
      {
        field: { type: String, required: true, trim: true },
        operator: { type: String, trim: true },
        value: { type: Schema.Types.Mixed, required: true },
      },
    ],
    exclusions: [
      {
        field: { type: String, required: true, trim: true },
        operator: { type: String, trim: true },
        value: { type: Schema.Types.Mixed, required: true },
      },
    ],

    revisionNo: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
      index: true,
    },

    filteredData: {
      type: Schema.Types.Object,
      default: {},
    },

    status: {
      type: String,
      enum: {
        values: ["Pending", "Approved", "AddOn", "KestoneData", "Rejected"],
        message: "{VALUE} is not a valid status",
      },
      default: "Own Data",
      required: true,
    },
    misc: { type: Object },
  },
  {
    timestamps: true,
  }
);

const CampaignFilter = getPrimaryConnection().model(
  "CampaignFilter",
  CampaignFilterSchema
);

export default CampaignFilter;
