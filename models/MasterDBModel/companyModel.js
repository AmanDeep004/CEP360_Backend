import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db";

const CompanySchema = new mongoose.Schema(
  {
    company_id_kestone: { type: String, trim: true },
    affinity_id_dell: { type: String, trim: true },
    company_id_google: { type: String, trim: true },
    company_source: { type: String, trim: true },
    company_name: { type: String, required: true, trim: true, index: true },
    year_founded: { type: String, trim: true },
    turnover_range: { type: String, trim: true },
    employees_range: { type: String, trim: true },
    industry: { type: String, trim: true, index: true },
    sub_industry: { type: String, trim: true },
    company_segment: { type: String, trim: true },
    website: { type: String, trim: true },
    company_linkedIn_profile: { type: String, trim: true },
    company_phone1: { type: String, trim: true },
    company_phone2: { type: String, trim: true },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model("Company", CompanySchema);
