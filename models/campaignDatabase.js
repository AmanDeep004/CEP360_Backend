import mongoose from "mongoose";

const CampaignDatabaseSchema = new mongoose.Schema(
  {
    CampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    UploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    Salutations: { type: String, trim: true },
    // First_Name: { type: String, trim: true },
    // Last_Name: { type: String, trim: true },
    Full_Name: { type: String, trim: true },
    Job_Title: { type: String, trim: true },
    Contact_City: { type: String, trim: true },
    Contact_State: { type: String, trim: true },
    Contact_Region: { type: String, trim: true },
    Mobile_No: { type: Number },
    Office_Email_1: { type: String, trim: true },
    Office_Email_2: { type: String, trim: true },
    Personal_Email1: { type: String, trim: true },
    Personal_Email2: { type: String, trim: true },
    Contact_LinkedIn_Profile: { type: String, trim: true },
    Company_Name: { type: String, trim: true },
    Last_Engagement_Client_Name: { type: String, trim: true },
    Last_Engagement_Date: { type: Date },
    Last_Engagement_Campaign: { type: String, trim: true },
    Last_Engagement_Type: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("CampaignDatabase", CampaignDatabaseSchema);
