import mongoose from "mongoose";
import {
  getPrimaryConnection,
  getSecondaryConnection,
} from "../../config/db.js";

const DoubleTickWebhookSchema = new mongoose.Schema(
  {
    webhookType: {
      type: String,
      enum: ["MessageStatus", "MessageReceived"],
      required: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
    templateName: { type: String, trim: true },
    templateId: { type: String, trim: true },
    templateData: { type: Object, default: {} },
    mobileNumber: { type: String, trim: true },
    messageHistory: { type: Array, default: [] },
    payload: { type: Object, required: true },
    eventType: { type: String, trim: true },
    waMessageId: { type: String, index: true },
    timestamp: { type: Date },
    status: { type: String, trim: true },
    failureReason: { type: String, trim: true },
    messageType: { type: String, trim: true },
    textMessage: { type: String, trim: true },
    senderName: { type: String, trim: true },
    misc: { type: String, trim: true },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model(
  "DoubleTickData",
  DoubleTickWebhookSchema
);
