import mongoose from "mongoose";
import { getSecondaryConnection } from "../../config/db.js";

const ContactSchema = new mongoose.Schema(
  {
    Contact_ID: { type: String, required: true, unique: true, trim: true },
    Contact_Source: { type: String, trim: true },
    Contact_Create_Date: { type: Date },
    Salutation: { type: String, trim: true },
    First_Name: { type: String, trim: true },
    Last_Name: { type: String, trim: true },
    Full_Name: { type: String, trim: true },
    Gender: { type: String, trim: true },
    Job_Title: { type: String, trim: true },
    Job_Seniority: { type: String, trim: true },
    Job_Function: { type: String, trim: true },

    // Address
    Contact_Address_1: { type: String, trim: true },
    Contact_Address_2: { type: String, trim: true },
    Contact_Address_3: { type: String, trim: true },
    Contact_City: { type: String, trim: true, index: true },
    Contact_Pin: { type: String, trim: true },
    Contact_State: { type: String, trim: true, index: true },
    Contact_Region: { type: String, trim: true },
    Contact_Country: { type: String, trim: true, index: true },
    Contact_STD_ISD_Code: { type: String, trim: true },
    Contact_Location_Tier: { type: String, trim: true },

    // Phones
    Contact_Direct_Phone1: { type: String, trim: true, index: true },
    Contact_Direct_Phone2: { type: String, trim: true },
    Contact_Extn_No: { type: String, trim: true },
    Mobile_No: { type: String, trim: true, index: true },

    // Emails
    Office_Email_1: { type: String, trim: true, lowercase: true, index: true },
    Office_Email_2: { type: String, trim: true, lowercase: true },
    Personal_Email1: { type: String, trim: true, lowercase: true },
    Personal_Email2: { type: String, trim: true, lowercase: true },

    Contact_LinkedIn_Profile: { type: String, trim: true },

    // Flags
    Unsubscribe_Flag: { type: String, trim: true },
    Unsubscribe_Account_Tag: { type: String, trim: true },
    DND_Flag: { type: String, trim: true },
    DND_Account_Tag: { type: String, trim: true },

    // Engagement
    Last_Engagement: { type: String, trim: true },
    Last_Engagement_Date: { type: Date },
    Last_Engagement_Campaign: { type: String, trim: true },
    Telecalling_Remarks: { type: String, trim: true },

    // Extra
    BatchName: { type: String, required: true, trim: true },

    Company_ID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    discrepencyInData: {
      status: { type: Boolean, default: false },
      chatHistory: { type: Array },
      misc: { type: Object, default: {} },
    },

    EngagementPoints: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

// Index for default sort by createdAt
ContactSchema.index({ createdAt: -1 });

// Compound text index for fast full-text search across key contact fields
ContactSchema.index(
  {
    First_Name: "text",
    Last_Name: "text",
    Full_Name: "text",
    Job_Title: "text",
    Office_Email_1: "text",
    Office_Email_2: "text",
    Personal_Email1: "text",
    Personal_Email2: "text",
    Contact_Direct_Phone1: "text",
    Contact_Direct_Phone2: "text",
    Mobile_No: "text",
    Contact_City: "text",
    Contact_State: "text",
    Contact_Country: "text",
  },
  { name: "contact_text_search" }
);

export default getSecondaryConnection().model("Contact", ContactSchema);
