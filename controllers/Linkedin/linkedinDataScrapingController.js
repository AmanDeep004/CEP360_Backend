import errorHandler from "../../utils/index.js";
import LinkedinProfile from "../../models/Linkedin/profileList.js";
import axios from "axios";
import XLSX from "xlsx";
import csv from "csvtojson";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const WIZA_API_KEY = process.env.WIZA_API_KEY;
const WIZA_API_URL = process.env.WIZA_API_URL;

/**
 * Smart function to extract LinkedIn URL from any field in a row
 * Looks for linkedin.com/in/ pattern in ALL values
 */
const extractLinkedinUrl = (row) => {
  // Get all values from the row
  const values = Object.values(row);

  // Find first value that contains linkedin.com/in/
  for (const value of values) {
    if (
      value &&
      typeof value === "string" &&
      value.includes("linkedin.com/in/")
    ) {
      return value.trim();
    }
  }

  return null;
};

/**
 * Normalize LinkedIn URL (remove query params and trailing slash)
 */
const normalizeLinkedinUrl = (profileUrl) => {
  if (!profileUrl) return null;

  // Remove query parameters and trailing slash
  let normalized = profileUrl.split("?")[0].replace(/\/$/, "").trim();

  // Ensure it starts with https://
  if (!normalized.startsWith("https://")) {
    if (normalized.startsWith("http://")) {
      normalized = normalized.replace("http://", "https://");
    } else if (normalized.startsWith("www.")) {
      normalized = "https://" + normalized;
    } else if (normalized.startsWith("linkedin.com")) {
      normalized = "https://www." + normalized;
    }
  }

  return normalized;
};

const uploadProfiles = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "No CSV/Excel file uploaded", 400);
    }

    let parsedRows = [];
    const fileMime = req.file.mimetype;

    // Parse Excel or CSV
    if (
      fileMime.includes("spreadsheetml") ||
      fileMime.includes("excel") ||
      req.file.originalname.endsWith(".xlsx")
    ) {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      parsedRows = XLSX.utils.sheet_to_json(sheet);
    } else {
      const fileBuffer = req.file.buffer.toString("utf8");
      parsedRows = await csv().fromString(fileBuffer);
    }

    if (!parsedRows.length) {
      return sendError(next, "File has no valid rows", 400);
    }

    // Calculate batch name
    const existingCount = await LinkedinProfile.countDocuments();
    const nextBatchNumber = Math.floor(existingCount / parsedRows.length) + 1;
    const batchName = `Batch-${nextBatchNumber}`;

    let inserted = 0;
    let duplicate = 0;
    let alreadyEnriched = 0;
    let invalidUrls = 0;

    const docsToInsert = [];
    const profilesToEnrich = [];

    // Process each row
    for (const row of parsedRows) {
      // Smart extraction: find LinkedIn URL in ANY field
      const rawProfileUrl = extractLinkedinUrl(row);

      if (!rawProfileUrl) {
        invalidUrls++;
        console.log("No LinkedIn URL found in row:", row);
        continue;
      }

      // Normalize the URL (remove query params, ensure https://)
      const profileUrl = normalizeLinkedinUrl(rawProfileUrl);

      if (!profileUrl || !profileUrl.includes("linkedin.com/in/")) {
        invalidUrls++;
        console.log("Invalid LinkedIn URL:", rawProfileUrl);
        continue;
      }

      // Use full URL as unique identifier (linkedinId)
      const linkedinId = profileUrl;

      // Check if profile already exists
      const existingProfile = await LinkedinProfile.findOne({ linkedinId });

      if (existingProfile) {
        duplicate++;

        if (existingProfile.isEnriched) {
          alreadyEnriched++;
          continue; // Already enriched – skip
        } else {
          // Exists but not enriched → send to enrichment queue
          profilesToEnrich.push({
            profile_url: profileUrl,
            linkedinId,
            _id: existingProfile._id,
          });
        }
      } else {
        // New profile → store and enrich
        docsToInsert.push({
          linkedinId,
          isEnriched: false,
          enrichedData: {},
          batchName,
        });

        profilesToEnrich.push({
          profile_url: profileUrl,
          linkedinId,
        });
      }
    }

    // Insert new profiles to DB
    if (docsToInsert.length > 0) {
      await LinkedinProfile.insertMany(docsToInsert);
      inserted = docsToInsert.length;
    }

    let wizaResponse = null;
    let wizaListId = null;

    // Enrich profiles using Wiza
    if (profilesToEnrich.length > 0) {
      try {
        const wizaPayload = {
          list: {
            name: `${batchName} - ${new Date().toISOString().split("T")[0]}`,
            enrichment_level: "full",
            email_options: {
              accept_work: true,
              accept_personal: true,
              accept_generic: false,
            },
            items: profilesToEnrich.map((p) => ({
              profile_url: p.profile_url,
            })),
          },
        };

        const response = await axios.post(WIZA_API_URL, wizaPayload, {
          headers: {
            Authorization: `Bearer ${WIZA_API_KEY}`,
            "Content-Type": "application/json",
          },
        });

        wizaResponse = response.data;
        wizaListId = response.data?.data?.id || response.data?.id;

        // Save Wiza List ID in DB
        if (wizaListId) {
          const linkedinIds = profilesToEnrich.map((p) => p.linkedinId);
          await LinkedinProfile.updateMany(
            { linkedinId: { $in: linkedinIds } },
            {
              $set: {
                "misc.wizaListId": wizaListId,
                "misc.wizaListName": wizaPayload.list.name,
                "misc.sentToWizaAt": new Date(),
              },
            }
          );
        }
      } catch (wizaError) {
        console.error(
          "Wiza API Error:",
          wizaError.response?.data || wizaError.message
        );
        wizaResponse = {
          error: wizaError.response?.data || wizaError.message,
        };
      }
    }

    return sendResponse(res, 200, "File uploaded and processed successfully", {
      batchName,
      totalRows: parsedRows.length,
      inserted,
      duplicate,
      alreadyEnriched,
      invalidUrls,
      sentToWiza: profilesToEnrich.length,
      wizaListId,
      wizaResponse: wizaResponse || "No enrichment needed",
    });
  } catch (error) {
    console.error("Upload Error:", error);
    return sendError(next, error.message, 500);
  }
});

// Fetch enriched data from Wiza
const fetchEnrichedData = asyncHandler(async (req, res, next) => {
  try {
    const { wizaListId } = req.params;

    if (!wizaListId) {
      return sendError(next, "Wiza List ID is required", 400);
    }

    // Check list status first
    const statusResponse = await axios.get(`${WIZA_API_URL}/${wizaListId}`, {
      headers: {
        Authorization: `Bearer ${WIZA_API_KEY}`,
      },
    });

    const listStatus = statusResponse.data?.data?.status;

    if (listStatus !== "finished") {
      return sendResponse(
        res,
        200,
        `Enrichment in progress. Status: ${listStatus}`,
        {
          status: listStatus,
          wizaListId,
          stats: statusResponse.data?.data?.stats,
        }
      );
    }

    // Fetch enriched contacts
    const contactsResponse = await axios.get(
      `${WIZA_API_URL}/${wizaListId}/contacts?segment=people`,
      {
        headers: {
          Authorization: `Bearer ${WIZA_API_KEY}`,
        },
      }
    );

    const contacts = contactsResponse.data?.data || contactsResponse.data;
    let updated = 0;
    let notFound = 0;

    // Update profiles with enriched data
    for (const contact of contacts) {
      const linkedinUrl =
        contact.linkedin_profile_url || contact.profile_url || contact.linkedin;

      if (!linkedinUrl) {
        notFound++;
        continue;
      }

      const linkedinId = normalizeLinkedinUrl(linkedinUrl);

      if (!linkedinId) {
        notFound++;
        continue;
      }

      const result = await LinkedinProfile.findOneAndUpdate(
        { linkedinId },
        {
          $set: {
            isEnriched: true,
            enrichedData: contact,
            payload: contact,
            "misc.enrichedAt": new Date(),
          },
        }
      );

      if (result) {
        updated++;
      } else {
        notFound++;
      }
    }

    return sendResponse(
      res,
      200,
      "Enriched data fetched and saved successfully",
      {
        wizaListId,
        totalContacts: contacts.length,
        updated,
        notFound,
        listStatus,
      }
    );
  } catch (error) {
    console.error(
      "Fetch Enriched Data Error:",
      error.response?.data || error.message
    );
    return sendError(next, error.response?.data?.message || error.message, 500);
  }
});

// Helper: Handle list completion webhook
async function handleListCompleted(data) {
  const listId = data.list_id || data.id;

  if (!listId) {
    console.error("No list ID in webhook data");
    return;
  }

  console.log(`Processing completed list: ${listId}`);

  try {
    // Fetch all enriched contacts from Wiza
    const contactsResponse = await axios.get(
      `${WIZA_API_URL}/${listId}/contacts?segment=people`,
      {
        headers: {
          Authorization: `Bearer ${WIZA_API_KEY}`,
        },
      }
    );

    const contacts = contactsResponse.data?.data || contactsResponse.data;

    if (!Array.isArray(contacts)) {
      console.error("Invalid contacts response");
      return;
    }

    let updated = 0;
    let notFound = 0;

    // Update each profile with enriched data
    for (const contact of contacts) {
      const linkedinUrl =
        contact.linkedin_profile_url || contact.profile_url || contact.linkedin;

      if (!linkedinUrl) {
        notFound++;
        continue;
      }

      const linkedinId = normalizeLinkedinUrl(linkedinUrl);

      if (!linkedinId) {
        notFound++;
        continue;
      }

      // Update profile with enriched data
      const result = await LinkedinProfile.findOneAndUpdate(
        { linkedinId },
        {
          $set: {
            isEnriched: true,
            enrichedData: contact,
            payload: contact, // Store complete raw response
            "misc.enrichedAt": new Date(),
            "misc.webhookReceivedAt": new Date(),
          },
        },
        { new: true }
      );

      if (result) {
        updated++;
      } else {
        notFound++;
      }
    }

    console.log(
      `Webhook processing complete: ${updated} updated, ${notFound} not found`
    );
  } catch (error) {
    console.error(
      "Error processing list completion:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Helper: Handle individual contact enrichment webhook
async function handleContactEnriched(data) {
  const contact = data.contact || data;

  const linkedinUrl =
    contact.linkedin_profile_url || contact.profile_url || contact.linkedin;

  if (!linkedinUrl) {
    console.error("No LinkedIn URL in contact data");
    return;
  }

  const linkedinId = normalizeLinkedinUrl(linkedinUrl);

  if (!linkedinId) {
    console.error("Invalid LinkedIn ID");
    return;
  }

  try {
    await LinkedinProfile.findOneAndUpdate(
      { linkedinId },
      {
        $set: {
          isEnriched: true,
          enrichedData: contact,
          payload: contact, // Store complete raw response
          "misc.enrichedAt": new Date(),
          "misc.webhookReceivedAt": new Date(),
        },
      },
      { new: true, upsert: false }
    );

    console.log(`Contact enriched via webhook: ${linkedinId}`);
  } catch (error) {
    console.error("Error updating contact:", error);
    throw error;
  }
}

// Webhook endpoint to receive enriched data from Wiza
const wizaWebhookOld = asyncHandler(async (req, res, next) => {
  try {
    const webhookData = req.body;

    console.log("Wiza Webhook Received:", webhookData);

    // Validate webhook payload
    if (!webhookData || !webhookData.data) {
      return sendError(next, "Invalid webhook payload", 400);
    }

    const { event_type, data } = webhookData;

    // Handle different webhook events
    switch (event_type) {
      case "list.completed":
      case "list.finished":
        await handleListCompleted(data);
        break;

      case "contact.enriched":
        await handleContactEnriched(data);
        break;

      default:
        console.log(`Unhandled webhook event: ${event_type}`);
    }

    // Always respond 200 OK to acknowledge webhook receipt
    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("Webhook Error:", error);
    // Still return 200 to prevent Wiza from retrying
    return res.status(200).json({
      success: false,
      error: error.message,
    });
  }
});

const wizaWebhook = asyncHandler(async (req, res, next) => {
  try {
    const webhookData = req.body;
    console.log("Wiza Webhook Received:", webhookData);

    const listData = webhookData.data_json;
    const status = listData.status;
    const listId = listData.id;

    console.log(`Webhook Status: ${status}, List ID: ${listId}`);

    // Check if enrichment is finished
    if (status === "finished") {
      console.log(` List ${listId} finished! Fetching enriched contacts...`);

      // Fetch contacts from Wiza API
      const contactsResponse = await axios.get(
        `${WIZA_API_URL}/${listId}/contacts?segment=people`,
        {
          headers: {
            Authorization: `Bearer ${WIZA_API_KEY}`,
          },
        }
      );

      // Response structure: { status: {...}, data: [...] }
      const contacts = contactsResponse.data?.data || [];

      if (!Array.isArray(contacts) || contacts.length === 0) {
        console.error("No contacts found in response");
        return res.status(200).json({
          success: true,
          message: "No contacts found",
          listId: listId,
        });
      }

      console.log(`Found ${contacts.length} contacts for list ${listId}`);

      let updated = 0;
      let notFound = 0;

      // Update each profile
      for (const contact of contacts) {
        const linkedinUrl =
          contact.linkedin_profile_url ||
          contact.profile_url ||
          contact.linkedin;

        if (!linkedinUrl) {
          notFound++;
          continue;
        }

        const linkedinId = normalizeLinkedinUrl(linkedinUrl);

        if (!linkedinId) {
          notFound++;
          continue;
        }

        // Update profile with enriched data
        const result = await LinkedinProfile.findOneAndUpdate(
          { linkedinId },
          {
            $set: {
              isEnriched: true,
              enrichedData: contact,
              payload: contact,
              "misc.enrichedAt": new Date(),
              "misc.webhookReceivedAt": new Date(),
              "misc.enrichmentStatus": "completed",
            },
          },
          { new: true }
        );

        if (result) {
          updated++;
          console.log(`Updated: ${linkedinId.substring(0, 60)}...`);
        } else {
          notFound++;
          console.log(`Profile not found in DB: ${linkedinId}`);
        }
      }

      console.log(
        `Webhook complete: ${updated} updated, ${notFound} not found`
      );

      return res.status(200).json({
        success: true,
        message: "Webhook processed successfully",
        listId: listId,
        updated: updated,
        notFound: notFound,
      });
    } else {
      console.log(` List ${listId} status: ${status} - not finished yet`);
      return res.status(200).json({
        success: true,
        message: "List not finished yet",
        listId: listId,
        status: status,
      });
    }
  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(200).json({
      success: false,
      error: error.message,
    });
  }
});

export { uploadProfiles, fetchEnrichedData, wizaWebhook };
