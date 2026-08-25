import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const InvoiceSettingsSchema = new mongoose.Schema(
  {
    invoiceGenerationEnabled: { type: Boolean, default: true },
    disabledAt:     { type: Date,   default: null },
    disabledBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    disabledByName: { type: String, trim: true, default: null },
    enabledAt:      { type: Date,   default: null },
    enabledBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    enabledByName:  { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

const InvoiceSettings = getPrimaryConnection().model("InvoiceSettings", InvoiceSettingsSchema);

// Always returns the single settings document, creating it with defaults if missing.
export const getInvoiceSettings = async () => {
  let doc = await InvoiceSettings.findOne().lean();
  if (!doc) doc = await InvoiceSettings.create({});
  return doc;
};

export default InvoiceSettings;
