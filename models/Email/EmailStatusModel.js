// models/EmailStatus.js
import mongoose from "mongoose";
import { getPrimaryConnection } from "../../config/db.js";

const EmailStatusSchema = new mongoose.Schema(
  {
    email: { type: String },
    event: { type: String }, // e.g., "sent", "opened", etc.
    campaignId: { type: String },
    callingDataId: { type: String },
    templateName: { type: String },
    messageId: { type: String },
    provider: { type: String, default: "MailerCloud" },
    statusCode: { type: Number },
    statusText: { type: String },
    reason: { type: String },
    requestPayload: { type: Object, default: {} },
    responsePayload: { type: Object, default: {} },
    webhookPayload: { type: Object, default: {} },
    meta: { type: Object, default: {} },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Lookup by webhook messageId (DoubleTick / MailerCloud callbacks)
EmailStatusSchema.index({ messageId: 1 });

// Find all email events for a campaign (reporting)
EmailStatusSchema.index({ campaignId: 1, createdAt: -1 });

// Find all email events for a specific contact email
EmailStatusSchema.index({ email: 1, createdAt: -1 });

// Filter by event type (sent, opened, clicked, bounced)
EmailStatusSchema.index({ event: 1, campaignId: 1 });

export default getPrimaryConnection().model("EmailStatus", EmailStatusSchema);
