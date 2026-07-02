// models/EmailStatus.js
import mongoose from "mongoose";
import { getPrimaryConnection } from "../../config/db.js";

// MailerCloud webhook event names → normalised values
// "Campaign Sent" → "sent", "Opened" → "opened", "Clicked" → "clicked",
// "Campaign Failed" → "failed", "Spam" → "spam",
// "Unsubscribed" → "unsubscribed", "Bounced" → "bounced"

const EmailStatusSchema = new mongoose.Schema(
  {
    email:            { type: String },
    event:            { type: String }, // normalised: sent|opened|clicked|failed|spam|unsubscribed|bounced
    campaignId:       { type: String }, // our MongoDB campaignId
    callingDataId:    { type: String }, // our CallingData _id
    templateName:     { type: String },
    mailerCampaignId: { type: String }, // MailerCloud's own campaign_id (from webhook)
    messageId:        { type: String }, // reserved – MailerCloud transactional may not return this
    url:              { type: String }, // populated for "clicked" events
    reason:           { type: String }, // populated for failed / bounced / spam
    provider:         { type: String, default: "MailerCloud" },
    statusCode:       { type: Number },
    statusText:       { type: String },
    requestPayload:   { type: Object, default: {} },
    responsePayload:  { type: Object, default: {} },
    webhookPayload:   { type: Object, default: {} }, // raw MailerCloud webhook body
    meta:             { type: Object, default: {} },
    timestamp:        { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Resolve CallingData from a webhook: email + campaignId (our id passed in metadata)
EmailStatusSchema.index({ email: 1, campaignId: 1, event: 1 });

// Find all email events for a campaign (reporting)
EmailStatusSchema.index({ campaignId: 1, createdAt: -1 });

// Find all email events for a specific contact email
EmailStatusSchema.index({ email: 1, createdAt: -1 });

// Webhook correlation by MailerCloud campaign_id
EmailStatusSchema.index({ mailerCampaignId: 1, email: 1 });

// Legacy messageId index (kept for backward compat)
EmailStatusSchema.index({ messageId: 1 });

export default getPrimaryConnection().model("EmailStatus", EmailStatusSchema);
