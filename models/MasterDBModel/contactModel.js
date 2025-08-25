import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db";
const ContactSchema = new mongoose.Schema(
  {
    contact_id: { type: String, required: true, unique: true, trim: true },
    contact_source: { type: String, trim: true },
    contact_create_date: { type: Date },

    salutation: { type: String, trim: true },
    first_name: { type: String, trim: true },
    last_name: { type: String, trim: true },
    gender: { type: String, trim: true },
    job_title: { type: String, trim: true },
    job_seniority: { type: String, trim: true },
    job_function: { type: String, trim: true },
    designation: { type: String, trim: true },
    profile: { type: String, trim: true },

    // Address
    contact_address_1: { type: String, trim: true },
    contact_address_2: { type: String, trim: true },
    contact_address_3: { type: String, trim: true },
    contact_city: { type: String, trim: true, index: true },
    contact_pin: { type: String, trim: true },
    contact_state: { type: String, trim: true, index: true },
    contact_region: { type: String, trim: true },
    contact_country: { type: String, trim: true, index: true },
    contact_std_isd_code: { type: String, trim: true },
    contact_location_tier: { type: String, trim: true },

    // Phones
    contact_direct_phone1: { type: String, trim: true, index: true },
    contact_direct_phone2: { type: String, trim: true },
    contact_extn_no: { type: String, trim: true },
    mobile_no: { type: String, trim: true, index: true },

    // Emails
    office_email_1: { type: String, trim: true, lowercase: true, index: true },
    office_email_2: { type: String, trim: true, lowercase: true },
    personal_email1: { type: String, trim: true, lowercase: true },
    personal_email2: { type: String, trim: true, lowercase: true },

    contact_linkedIn_profile: { type: String, trim: true },

    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
  },
  { timestamps: true }
);

export default getSecondaryConnection().model("Contact", ContactSchema);
