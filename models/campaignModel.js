import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";
import User from "./userModel.js";
import { ProgramType } from "../utils/enum.js";
const { ALL } = ProgramType;

// const briefSchema = new mongoose.Schema({});

const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Program Name is required"],
      trim: true,
      maxlength: [50, "Program Name cannot be more than 50 characters"],
      unique: [true, "Campaign name must be unique"],
    },

    type: {
      type: String,
      required: true,
      enum: { values: ALL, message: "Invalid Program Type" },
    },

    category: {
      type: String,
      required: false,
      enum: ["Virtual Event", "Webinar", "Physical Event"],
    },

    startDate: { type: Date, required: true },

    endDate: { type: Date, required: true },

    programManager: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: [
        (array) => array.length > 0,
        "At least one Program Manager is required",
      ],
    },

    keyAccountManager: { type: String, required: false },

    status: {
      type: String,
      required: true,
      default: "active",
      enum: ["active", "inactive", "completed"],
    },

    jcNumber: { type: String, required: false },

    brandName: { type: String, required: false },

    clientName: { type: String, required: false },

    clientEmail: { type: String, required: false },

    clientContact: { type: String, required: false },

    registrationTarget: { type: String, required: false },

    attendeeTarget: { type: String, required: false },

    eventTopic: { type: String, required: false },

    hasTargetAccountList: {
      type: String,
      required: false,
      enum: ["Yes", "No", "Not Applicable"],
    },

    targetDatabaseSize: { type: String, required: false },

    targetCompanyIndustry: { type: String, required: false },

    targetCity: { type: String, required: false },

    targetCompanySize: { type: String, required: false },

    jobTitles: { type: String, required: false },

    jobFunctions: { type: String, required: false },

    comments: { type: String, required: false },
    // for the data source type
    dataSourceType: {
      type: String,
      required: false,
      default: "Kestone",
      enum: ["Kestone", "Client", "Both", "ThirdParty"],
    },

    senderEmail: [
      {
        email: { type: String, trim: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],

    stage: {
      type: String,
      required: true,
      default: "NotFiltered",
      enum: {
        values: [
          "NotFiltered",
          "Filtered",
          "SuggestedToClient",
          "ClientSuggestedMoreFilters",
          "RevisionRequested",
          "Finalized",
          "CallingDataAssigned",
          "AddtionalCallingDataMidCampaign",
        ],
        message: "{VALUE} is not a valid stage",
      },
    },
    isCallingDataAssigned: { type: Boolean, default: false },

    // Set when this campaign is a reconfirmation of another campaign
    parentCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
    },
    filterBatches: [
      {
        filterBatchId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "CampaignFilter",
        },
      },
    ],

    // brief: {
    //   type: [briefSchema],
    //   required: false,
    // },
  },
  { timestamps: true }
);

// Filter active/inactive/completed campaigns (most common dashboard query)
campaignSchema.index({ status: 1, createdAt: -1 });

// Find campaigns assigned to a specific program manager
campaignSchema.index({ programManager: 1 });

// Filter by campaign stage (pipeline view queries)
campaignSchema.index({ stage: 1 });

export default getPrimaryConnection().model("Campaign", campaignSchema);
