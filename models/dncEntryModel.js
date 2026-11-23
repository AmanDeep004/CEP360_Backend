import mongoose from "mongoose";
import { getSecondaryConnection } from "../config/db.js";

const dncEntrySchema = new mongoose.Schema(
  {
    brandId:     { type: String, required: true, trim: true },
    brandName:   { type: String, required: true, trim: true },
    companyId:   { type: String, required: true, trim: true },   // Company _id from MasterDB
    companyName: { type: String, required: true, trim: true },   // denormalized
    addedBy:     { type: String, trim: true },                   // employee name (string — stored in MasterDB, no cross-DB ref)
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Fast lookup by brand when building filter exclusions
dncEntrySchema.index({ brandName: 1, isActive: 1 });
// Prevent duplicate company+brand combos
dncEntrySchema.index({ companyId: 1, brandId: 1 }, { unique: true });

export default getSecondaryConnection().model("DncEntry", dncEntrySchema);
