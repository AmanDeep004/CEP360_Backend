import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const CallingDataSchema = new mongoose.Schema(
  {
    Contact_ID: { type: String, trim: true },
    Contact_Source: { type: String, trim: true },
    Contact_Create_Date: { type: String, trim: true },
    Salutation: { type: String, trim: true },
    First_Name: { type: String, trim: true },
    Last_Name: { type: String, trim: true },
    Full_Name: { type: String, trim: true },
    Gender: { type: String, trim: true },
    Job_Title: { type: String, trim: true },
    Job_Seniority: { type: String, trim: true },
    Job_Function: { type: String, trim: true },
    Contact_Address_1: { type: String, trim: true },
    Contact_Address_2: { type: String, trim: true },
    Contact_Address_3: { type: String, trim: true },
    Contact_City: { type: String, trim: true },
    Contact_Pin: { type: String, trim: true },
    Contact_State: { type: String, trim: true },
    Contact_Region: { type: String, trim: true },
    Contact_Country: { type: String, trim: true },
    Contact_STD_ISD_Code: { type: String, trim: true },
    Contact_Location_Tier: { type: String, trim: true },
    Contact_Direct_Phone1: { type: String, trim: true },
    Contact_Direct_Phone2: { type: String, trim: true },
    Contact_Extn_No: { type: String, trim: true },
    Mobile_No: { type: String, trim: true },
    Office_Email_1: { type: String, trim: true },
    Office_Email_2: { type: String, trim: true },
    Personal_Email1: { type: String, trim: true },
    Personal_Email2: { type: String, trim: true },
    Contact_LinkedIn_Profile: { type: String, trim: true },
    Unsubscribe_Flag: { type: String, trim: true },
    Unsubscribe_Account_Tag: { type: String, trim: true },
    DND_Flag: { type: String, trim: true },
    DND_Account_Tag: { type: String, trim: true },
    Last_Engagement: { type: String, trim: true },
    Last_Engagement_Date: { type: String, trim: true },
    Last_Engagement_Campaign: { type: String, trim: true },
    Telecalling_Remarks: { type: String, trim: true },

    // Master Company Fields
    Company_ID: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    Company_Name: { type: String, trim: true },
    Company_ID_Kestone: { type: String, trim: true },
    Affinity_ID_Dell: { type: String, trim: true },
    Company_ID_Google: { type: String, trim: true },
    Company_Source: { type: String, trim: true },
    Year_Founded: { type: String, trim: true },
    Turnover_Range: { type: String, trim: true },
    Employees_Range: { type: String, trim: true },
    Industry: { type: String, trim: true },
    Sub_Industry: { type: String, trim: true },
    Company_Segment: { type: String, trim: true },
    Website: { type: String, trim: true },
    Company_LinkedIn_Profile: { type: String, trim: true },
    Company_Phone1: { type: String, trim: true },
    Company_Phone2: { type: String, trim: true },

    // Assignment/Meta Fields
    CampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    UploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    source: {
      type: String,
      trim: true,
      // required: true,
    },
    batch: { type: String, trim: true },
    pmId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pmName: { type: String, trim: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reassigned_to: {
      status: { type: Boolean, default: false },
      previously_assigned_to: [
        {
          unassignedAt: { type: Date },
          agentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
        },
      ],
    },
    isRegistered: { type: Boolean, default: false },
    registeredOn: { type: Date, default: null },
    callHistory: { type: mongoose.Schema.Types.ObjectId, ref: "CallHistory" },
    dataSourceType: {
      type: String,
      enum: ["Kestone", "Client", "Both", "ThirdParty"],
      required: false,
    },
    isDataSourceApproved: { type: Boolean, default: false },
    emailTemplates: {
      templateId: { type: String, required: true },
      templateName: { type: String, trim: true },
      timestamp: { type: Date, default: Date.now },
      status: { type: String, trim: true },
      messageId: { type: String, trim: true },
      history: [
        {
          status: { type: String, trim: true },
          timestamp: { type: Date, default: Date.now },
          templateId: { type: String, required: true },
          templateName: { type: String, trim: true },
        },
      ],
    },

    whatsappTemplates: [
      {
        waMessageId: { type: String, required: true }, // unique message identifier
        templateId: { type: String, trim: true },
        templateName: { type: String, trim: true },
        timestamp: { type: Date, default: Date.now },
        status: { type: String, trim: true },

        history: [
          {
            status: { type: String, trim: true },
            timestamp: { type: Date, default: Date.now },
          },
        ],
      },
    ],
  },
  {
    timestamps: true,
  }
);

CallingDataSchema.index({ createdAt: 1, CampaignId: 1, agentId: 1 });

export default getPrimaryConnection().model("CallingData", CallingDataSchema);
