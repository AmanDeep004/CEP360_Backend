import mongoose from "mongoose";
import { getPrimaryConnection } from "../config/db.js";

/**
 * Flat collection — one document per matched company per upload session.
 * Replaces the chunked ClientMatchResult approach for new uploads.
 * Old data still lives in ClientMatchResult (read-only backward compat).
 *
 * matchType values:
 *   "meta"       — single doc per session storing counts summary
 *   "complete"   — fully matched company
 *   "partial"    — partial match with suggestions
 *   "notMatched" — no match found (inputName only, no companyId)
 *   "duplicate"  — duplicate input row (skipped from matching)
 */
const clientMatchEntrySchema = new mongoose.Schema(
  {
    campaignId:  { type: mongoose.Schema.Types.ObjectId, required: true },
    uploadSession: { type: String, required: true },
    dataType:    { type: String, default: "Client" },
    matchType:   {
      type: String,
      enum: ["meta", "complete", "partial", "notMatched", "duplicate"],
      required: true,
    },

    // ── meta doc only ─────────────────────────────────────────────────────────
    counts: {
      completeCount:   { type: Number },
      partialCount:    { type: Number },
      notMatchedCount: { type: Number },
      duplicatesCount: { type: Number },
    },

    // ── complete / partial / notMatched / duplicate fields ───────────────────
    inputName:        { type: String, default: "" }, // MasterDbMatchedCompanyName — used for DB matching
    clientCompanyName:{ type: String, default: "" }, // ClientCompanyName — client's own name for the company
    companySpecificId:{ type: String, default: "" }, // CompanyUniqueId from Excel
    segment:          { type: String, default: "" }, // Segment from Excel

    // ── complete + partial only ───────────────────────────────────────────────
    companyId:   { type: mongoose.Schema.Types.ObjectId },
    companyName: { type: String },
    matchedWith: { type: String }, // which input name caused this match

    // ── partial only ─────────────────────────────────────────────────────────
    suggestions: { type: mongoose.Schema.Types.Mixed }, // array of suggestion objects

    // ── notMatched / duplicate ────────────────────────────────────────────────
    remark: { type: String, default: "" }, // e.g. "No match found in DB" / "User-declared as Not Matched"
  },
  { timestamps: true }
);

// Primary lookup — list all entries of a type for a session
clientMatchEntrySchema.index(
  { campaignId: 1, dataType: 1, uploadSession: 1, matchType: 1, _id: 1 }
);

// Latest-session lookup — find most recent meta doc
clientMatchEntrySchema.index(
  { campaignId: 1, dataType: 1, matchType: 1, uploadSession: -1 }
);

// Lookup by companyId (used by filter to resolve segments etc.)
clientMatchEntrySchema.index(
  { campaignId: 1, dataType: 1, uploadSession: 1, companyId: 1 }
);

export default getPrimaryConnection().model("ClientMatchEntry", clientMatchEntrySchema);
