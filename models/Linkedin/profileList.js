import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const enrichedDataSchema = new mongoose.Schema(
  {
    list_name: { type: String },
    email_type: { type: String },
    email_status: { type: String },
    email: { type: String },
    full_name: { type: String },
    first_name: { type: String },
    last_name: { type: String },
    title: { type: String },
    location: { type: String },
    locality: { type: String },
    region: { type: String },
    country: { type: String },
    linkedin: { type: String },
    domain: { type: String },
    phone_number1: { type: String },
    phone_number2: { type: String },
    phone_number3: { type: String },
    mobile_phone1: { type: String },
    other_phone1: { type: String },
    personal_email1: { type: String },
    company: { type: String },
    linkedin_profile_url: { type: String },
    company_domain: { type: String },
    company_industry: { type: String },
    company_subindustry: { type: String },
    company_size: { type: Number },
    company_size_range: { type: String },
    company_founded: { type: Number },
    company_revenue: { type: Number },
    company_funding: { type: Number },
    company_type: { type: String },
    company_linkedin: { type: String },
    company_twitter: { type: String },
    company_facebook: { type: String },
    company_description: { type: String },
    company_last_funding_round: { type: String },
    company_last_funding_amount: { type: Number },
    company_last_funding_at: { type: String },
    company_location: { type: String },
    company_street: { type: String },
    company_locality: { type: String },
    company_region: { type: String },
    company_country: { type: String },
    company_postal_code: { type: String },
    other_work_emails: { type: String },
    profile_url: { type: String },
  },
  { _id: false }
);

const linkedinProfileSchema = new mongoose.Schema(
  {
    linkedinId: { type: String, required: true, unique: true },
    isEnriched: { type: Boolean, default: false },
    enrichedData: enrichedDataSchema,
    batchName: { type: String },
    misc: { type: mongoose.Schema.Types.Mixed },
    payload: { type: Object },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model(
  "LinkedinProfile",
  linkedinProfileSchema
);
