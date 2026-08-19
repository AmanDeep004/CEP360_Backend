import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const BrandsWorkedWithSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true, unique: true },
    eventsCount: { type: Number, default: 0 },          // events so far (optional)
    addedBy:     { type: String, trim: true },           // user name who added
  },
  { timestamps: true }
);

BrandsWorkedWithSchema.index({ name: 1 });

export default getSecondaryConnection().model("BrandsWorkedWith", BrandsWorkedWithSchema);
