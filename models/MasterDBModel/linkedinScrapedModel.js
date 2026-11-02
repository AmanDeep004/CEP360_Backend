import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const LinkedinScrapedSchema = new mongoose.Schema(
  {
    // Reference back to the contact/list this record belongs to
    list_name: { type: String, trim: true, index: true },
    ID:        { type: String, trim: true, index: true }, // Contact ID reference

    // ── Person ────────────────────────────────────────────────────────────────
    email:      { type: String, trim: true, lowercase: true, index: true },
    email_type: { type: String, trim: true }, // "work", "personal", etc.
    email_status: { type: String, trim: true }, // "valid", "invalid", etc.

    full_name:  { type: String, trim: true },
    first_name: { type: String, trim: true },
    last_name:  { type: String, trim: true },
    title:      { type: String, trim: true },
    sub_title:  { type: String, trim: true },
    summary:    { type: String, trim: true },

    person_industry: { type: String, trim: true },
    is_premium:      { type: Boolean, default: false },
    open_to_work:    { type: Boolean, default: false },

    months_at_current_position: { type: Number },
    months_at_current_company:  { type: Number },
    current_job_description:    { type: String, trim: true },

    // ── Contact URLs ──────────────────────────────────────────────────────────
    linkedin:             { type: String, trim: true }, // short form e.g. "linkedin.com/in/..."
    profile_url:          { type: String, trim: true },
    linkedin_profile_url: { type: String, trim: true },

    // ── Phone / Email ─────────────────────────────────────────────────────────
    phone_number1:    { type: String, trim: true },
    phone_number2:    { type: String, trim: true },
    phone_number3:    { type: String, trim: true },
    mobile_phone1:    { type: String, trim: true },
    other_phone1:     { type: String, trim: true },
    personal_email1:  { type: String, trim: true, lowercase: true },
    other_work_emails: { type: String, trim: true, lowercase: true },

    // ── Person location ───────────────────────────────────────────────────────
    location:       { type: String, trim: true },
    locality:       { type: String, trim: true },
    region:         { type: String, trim: true },
    region_code:    { type: String, trim: true },
    country:        { type: String, trim: true },
    country_code:   { type: String, trim: true },
    continent:      { type: String, trim: true },
    continent_code: { type: String, trim: true },
    domain:         { type: String, trim: true },

    // ── Skills / Languages / Certifications / Education / Work History ─────────
    // Stored as Mixed — source delivers these as JSON-stringified strings;
    // parsed arrays are also accepted on insertion.
    skills:         { type: mongoose.Schema.Types.Mixed },
    languages:      { type: mongoose.Schema.Types.Mixed },
    certifications: { type: mongoose.Schema.Types.Mixed },
    education:      { type: mongoose.Schema.Types.Mixed },
    work_history:   { type: mongoose.Schema.Types.Mixed },

    // ── Company ───────────────────────────────────────────────────────────────
    company:         { type: String, trim: true },
    company_domain:  { type: String, trim: true },
    company_industry:    { type: String, trim: true },
    company_subindustry: { type: String, trim: true },
    company_size:        { type: Number },
    company_size_range:  { type: String, trim: true },
    company_founded:     { type: Number },
    company_revenue:     { type: String, trim: true },
    company_type:        { type: String, trim: true }, // "private", "public", etc.

    company_funding:              { type: String, trim: true },
    company_last_funding_round:   { type: String, trim: true },
    company_last_funding_amount:  { type: String, trim: true },
    company_last_funding_at:      { type: String, trim: true }, // "YYYY-MM" string from source

    company_description: { type: String, trim: true },

    // Company social / web
    company_linkedin: { type: String, trim: true },
    company_twitter:  { type: String, trim: true },
    company_facebook: { type: String, trim: true },

    // Company location
    company_location:     { type: String, trim: true },
    company_street:       { type: String, trim: true },
    company_locality:     { type: String, trim: true },
    company_region:       { type: String, trim: true },
    company_region_code:  { type: String, trim: true },
    company_country:      { type: String, trim: true },
    company_country_code: { type: String, trim: true },
    company_continent:    { type: String, trim: true },
    company_continent_code: { type: String, trim: true },
    company_postal_code:  { type: String, trim: true },
  },
  { timestamps: true }
);

LinkedinScrapedSchema.index({ createdAt: -1 });

export default getSecondaryConnection().model("LinkedinScraped", LinkedinScrapedSchema);
