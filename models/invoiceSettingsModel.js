import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

const InvoiceSettingsSchema = new mongoose.Schema(
  {
    // Each document represents one salary-cycle month, e.g. "October 2026"
    // sparse: true excludes null/undefined from the unique constraint
    // (protects against legacy docs that predate per-month settings)
    month:                    { type: String, trim: true, unique: true, sparse: true },
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

// Returns settings for a specific month. If no doc exists, defaults to enabled (open).
export const getInvoiceSettings = async (month) => {
  if (!month) return { invoiceGenerationEnabled: true };
  const doc = await InvoiceSettings.findOne({ month }).lean();
  return doc || { invoiceGenerationEnabled: true, month };
};

export default InvoiceSettings;
