import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const CompanySchema = new mongoose.Schema(
  {
    Company_ID_Kestone: { type: String, trim: true },
    Affinity_ID_Dell: { type: String, trim: true },
    Company_ID_Google: { type: String, trim: true },
    Company_Source: { type: String, trim: true },
    Company_Name: { type: String, required: true, trim: true, index: true },
    Year_Founded: { type: String, trim: true },
    Turnover_Range: { type: String, trim: true, index: true },
    Employees_Range: { type: String, trim: true, index: true },
    Industry: { type: String, trim: true, index: true },
    Sub_Industry: { type: String, trim: true, index: true },
    Company_Segment: { type: String, trim: true, index: true },
    Website: { type: String, trim: true },
    Company_LinkedIn_Profile: { type: String, trim: true },
    Company_Phone1: { type: String, trim: true },
    Company_Phone2: { type: String, trim: true },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model("Company", CompanySchema);
