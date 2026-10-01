import axios from "axios";
import errorHandler from "../utils/index.js";
import Campaign from "../models/campaignModel.js";
import CallingData from "../models/callingDataModal.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const VIRSA_BASE_URL    = "https://app.virsa.ai/api/integration/cep";
const VIRSA_ENC_KEY     = process.env.VIRSA_ENCRYPTION_KEY;

// Remarks considered "already handled" — skip from Virsa sync
const GREEN_REMARKS = new Set(["Registered", "Already Registered"]);

/**
 * POST /campaign/virsa-validate
 * Body: { versaCampaignId }
 * Validates a Virsa campaign ID before saving it on the campaign.
 */
export const validateVersaCampaign = asyncHandler(async (req, res, next) => {
  const { versaCampaignId } = req.body;
  if (!versaCampaignId?.trim()) return sendError(next, "versaCampaignId is required", 400);
  if (!VIRSA_ENC_KEY)          return sendError(next, "VIRSA_ENCRYPTION_KEY not configured", 500);

  try {
    const { data } = await axios.post(
      `${VIRSA_BASE_URL}/validate-campaign`,
      { campaignId: versaCampaignId.trim(), encryptionKey: VIRSA_ENC_KEY },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    return sendResponse(res, 200, "Validation complete", {
      valid: data?.valid === true,
      versaCampaignId: versaCampaignId.trim(),
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 400 || status === 404) {
      return sendResponse(res, 200, "Invalid campaign ID", { valid: false, versaCampaignId });
    }
    return sendError(next, err.message || "Virsa validation failed", 500);
  }
});

/**
 * POST /campaign/virsa-email-status
 * Body: { campaignId, contacts: [{ id, emails: [Office_Email_1, Office_Email_2, Personal_Email1] }] }
 * - Flattens all emails → hits Virsa once
 * - Per contact: picks the first email that Virsa has (priority: left→right in emails[])
 * - exists: true  → saves full versa subdoc + handles registration
 * - exists: false → saves versa.exists=false so the empty-state panel shows correctly
 */
export const syncVersaEmailStatus = asyncHandler(async (req, res, next) => {
  const { campaignId, contacts } = req.body;

  if (!campaignId) return sendError(next, "campaignId is required", 400);
  if (!Array.isArray(contacts) || !contacts.length)
    return sendResponse(res, 200, "No contacts to sync", { synced: 0, data: [] });
  if (!VIRSA_ENC_KEY) return sendError(next, "VIRSA_ENCRYPTION_KEY not configured", 500);

  // Look up campaign's Virsa details
  const campaign = await Campaign.findById(campaignId).select("versaCampaignId versaVerified").lean();
  if (!campaign?.versaCampaignId || !campaign?.versaVerified) {
    return sendResponse(res, 200, "Campaign has no verified Virsa ID", { synced: 0, data: [] });
  }

  const { versaCampaignId } = campaign;

  // Fetch real (unmasked) emails directly from DB — frontend emails are masked
  const contactIds = contacts.map((c) => c.id);
  const dbContacts = await CallingData.find({ _id: { $in: contactIds } })
    .select("_id Office_Email_1 Office_Email_2 Personal_Email1 Personal_Email2")
    .lean();

  // Build id → real emails map (all 4 email fields, deduped)
  const realEmailMap = new Map(
    dbContacts.map((doc) => [
      doc._id.toString(),
      [...new Set([doc.Office_Email_1, doc.Office_Email_2, doc.Personal_Email1, doc.Personal_Email2].filter(Boolean))],
    ])
  );

  // Replace masked emails in contacts with real ones; drop contacts with no real email
  const resolvedContacts = contacts
    .map((c) => ({ id: c.id, emails: realEmailMap.get(c.id) || [] }))
    .filter((c) => c.emails.length > 0);

  if (!resolvedContacts.length) {
    return sendResponse(res, 200, "No contacts with emails to sync", { synced: 0, data: [] });
  }

  // Flatten all real emails (deduplicated) for a single Virsa call
  const allEmails = [...new Set(resolvedContacts.flatMap((c) => c.emails))];

  // Hit Virsa API once with all emails
  let virsaData;
  try {
    const { data } = await axios.post(
      `${VIRSA_BASE_URL}/email-status`,
      { campaignId: versaCampaignId, encryptionKey: VIRSA_ENC_KEY, emails: allEmails },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    virsaData = data?.data || [];
  } catch (err) {
    return sendError(next, err.message || "Virsa email-status request failed", 500);
  }

  // email → virsa result lookup
  const emailMap = new Map(virsaData.map((item) => [item.email, item]));

  // email → [callingDataIds] (one email may appear in multiple contacts)
  const emailToIds = new Map();
  for (const contact of resolvedContacts) {
    for (const email of contact.emails) {
      if (!emailToIds.has(email)) emailToIds.set(email, []);
      emailToIds.get(email).push(contact.id);
    }
  }

  const now = new Date();
  const bulkOps = [];

  for (const contact of resolvedContacts) {
    // Pick the first email (in priority order) that Virsa has a record for
    const matched = contact.emails.map((e) => emailMap.get(e)).find((r) => r?.exists === true);

    if (matched) {
      const setFields = {
        "versa.email":          matched.email,
        "versa.registered":     matched.registered,
        "versa.send":           matched.send,
        "versa.open":           matched.open,
        "versa.click":          matched.click,
        "versa.telescriptData": matched.telescriptData ?? null,
        "versa.exists":         true,
        "versa.syncedAt":       now,
      };

      if (matched.registered === true) {
        setFields.isRegistered       = true;
        setFields.registrationSource = "versa";
        setFields.registeredOn       = now;
      }

      bulkOps.push({
        updateOne: {
          filter: {
            _id: contact.id,
            // Guard: don't overwrite an already-registered contact's registration source
            ...(matched.registered ? { isRegistered: { $ne: true } } : {}),
          },
          update: { $set: setFields },
        },
      });
    } else {
      // No Virsa record for any of this contact's emails
      // Save exists:false only if versa hasn't been set yet (don't overwrite a good exists:true)
      bulkOps.push({
        updateOne: {
          filter: { _id: contact.id, "versa.exists": { $ne: true } },
          update: {
            $set: {
              "versa.email":    contact.emails[0] || null,
              "versa.exists":   false,
              "versa.syncedAt": now,
            },
          },
        },
      });
    }
  }

  let synced = 0;
  if (bulkOps.length) {
    const result = await CallingData.bulkWrite(bulkOps, { ordered: false });
    synced = result.modifiedCount;
  }

  // Enrich Virsa response with all callingDataIds sharing this email
  const enrichedData = virsaData.map((item) => ({
    callingDataIds: emailToIds.get(item.email) || [],
    callingDataId:  (emailToIds.get(item.email) || [])[0] || null, // keep for backward compat
    ...item,
  }));

  return sendResponse(res, 200, "Virsa email status synced", { synced, data: enrichedData });
});
