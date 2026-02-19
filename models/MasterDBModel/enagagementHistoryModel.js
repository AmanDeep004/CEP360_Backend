import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";
const EngagementSchema = new mongoose.Schema(
  {
    masterDbContactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
    },
    callingDataId: { type: String, trim: true },
    contact_id: { type: String, trim: true },
    campaignName: { type: String, trim: true },
    isRegistered: { type: Boolean, default: false },
    registrationDate: { type: Date },
    isAtteneded: { type: Boolean, default: false },
    whatsappChatHistory: [
      {
        templateId: { type: String, trim: true },
        templateName: { type: String, trim: true },
        templateDetails: { type: Object },
        timestamp: { type: Date },
        status: { type: String, trim: true },
        history: [
          { status: { type: String, trim: true }, timestamp: { type: Date } },
        ],
        misc: { type: Object },
      },
    ],

    emailHistory: {
      templateId: { type: String },
      templateName: { type: String, trim: true },
      timestamp: { type: Date, default: Date.now },
      status: { type: String, trim: true },
      messageId: { type: String, trim: true },
      templateDetails: { type: Object },
      history: [
        {
          status: { type: String, trim: true },
          timestamp: { type: Date, default: Date.now },
          templateId: { type: String },
          templateName: { type: String, trim: true },
          misc: { type: Object },
        },
      ],
    },

    agentName: [{ type: String, trim: true }],
    agentId: { type: String, trim: true },

    campaignId: { type: String, trim: true },
    campaignName: { type: String, trim: true },
    last_engagement_date: { type: Date },
    telecalling_remarks: [
      {
        contactNo: { type: String },
        remarks: {
          type: String,
        },
        reason: { type: String },
        callingDate: { type: Date },
        isRegistered: { type: Boolean },
        agent_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        agentName: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export default getSecondaryConnection().model(
  "EngagementHistory",
  EngagementSchema
);
