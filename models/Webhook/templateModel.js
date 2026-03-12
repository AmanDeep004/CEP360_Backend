// models/Template.js
import mongoose from "mongoose";
import { getPrimaryConnection } from "../../config/db.js";

const templateSchema = new mongoose.Schema(
  {
    templateName: { type: String, trim: true, required: true, unique: true },
    templateId: { type: String, trim: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
    type: { type: String, trim: true },
    senderEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

export default getPrimaryConnection().model("Template", templateSchema);
