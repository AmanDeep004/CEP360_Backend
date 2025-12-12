import errorHandler from "../../utils/index.js";
import LinkedinProfile from "../../models/Linkedin/profileList.js";
import axios from "axios";
import XLSX from "xlsx";
// import { asyncHandler, sendError } from "../utils/index.js";
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

const uploadProfilesOld = asyncHandler(async (req, res, next) => {
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

    // Check if file has more than 500 rows
    if (parsedRows.length > 500) {
      return sendError(
        next,
        "Upload can only process 500 records in one go",
        400
      );
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
    let wizaErrorMessage = null;

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

        // Extract error message from Wiza response
        const wizaErrorData = wizaError.response?.data;

        if (wizaErrorData?.error?.status?.message) {
          wizaErrorMessage = wizaErrorData.error.status.message;
        } else if (wizaErrorData?.message) {
          wizaErrorMessage = wizaErrorData.message;
        } else if (wizaError.message) {
          wizaErrorMessage = wizaError.message;
        } else {
          wizaErrorMessage = "Unknown Wiza API error occurred";
        }

        wizaResponse = {
          error: wizaErrorData || wizaError.message,
        };
      }
    }

    // Check if there was a Wiza error
    if (wizaErrorMessage) {
      // Rollback: Delete the newly inserted profiles if Wiza fails
      if (inserted > 0) {
        await LinkedinProfile.deleteMany({ batchName });
        console.log(
          `Rolled back batch: ${batchName} (${inserted} profiles deleted)`
        );
      }

      return sendError(
        next,
        `Wiza enrichment failed: ${wizaErrorMessage}`,
        400
      );
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

const getAllEnrichedProfiles = asyncHandler(async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Base filter
    // const filters = { isEnriched: true };
    const filters = {};

    // ========== GLOBAL SEARCH ==========
    if (req.query.search && req.query.search.trim() !== "") {
      const searchTerm = req.query.search.trim();
      const searchRegex = new RegExp(searchTerm, "i");

      filters.$or = [
        { "enrichedData.full_name": searchRegex },
        { "enrichedData.first_name": searchRegex },
        { "enrichedData.last_name": searchRegex },
        { "enrichedData.email": searchRegex },
        { "enrichedData.personal_email1": searchRegex },
        { "enrichedData.company": searchRegex },
        { "enrichedData.title": searchRegex },
        { "enrichedData.location": searchRegex },
        { "enrichedData.country": searchRegex },
        { "enrichedData.region": searchRegex },
        { "enrichedData.locality": searchRegex },
        { "enrichedData.company_industry": searchRegex },
        { "enrichedData.domain": searchRegex },
        { linkedinId: searchRegex },
      ];
    }

    // ========== FILTERS ==========

    const regexFilter = (field, value) => {
      if (value) filters[field] = new RegExp(value, "i");
    };

    if (req.query.batchName) filters.batchName = req.query.batchName;
    if (req.query.emailStatus)
      filters["enrichedData.email_status"] = req.query.emailStatus;
    if (req.query.emailType)
      filters["enrichedData.email_type"] = req.query.emailType;

    regexFilter("enrichedData.company", req.query.company);
    regexFilter("enrichedData.title", req.query.title);
    regexFilter("enrichedData.country", req.query.country);
    regexFilter("enrichedData.region", req.query.region);
    regexFilter("enrichedData.locality", req.query.locality);
    regexFilter("enrichedData.company_industry", req.query.industry);
    regexFilter("enrichedData.domain", req.query.domain);

    if (req.query.companySizeRange)
      filters["enrichedData.company_size_range"] = req.query.companySizeRange;

    if (req.query.companyType)
      filters["enrichedData.company_type"] = req.query.companyType;

    // ========== DATE FILTERS ==========

    if (req.query.enrichedFrom || req.query.enrichedTo) {
      filters["misc.enrichedAt"] = {};
      if (req.query.enrichedFrom)
        filters["misc.enrichedAt"].$gte = new Date(req.query.enrichedFrom);
      if (req.query.enrichedTo)
        filters["misc.enrichedAt"].$lte = new Date(req.query.enrichedTo);
    }

    if (req.query.createdFrom || req.query.createdTo) {
      filters.createdAt = {};
      if (req.query.createdFrom)
        filters.createdAt.$gte = new Date(req.query.createdFrom);
      if (req.query.createdTo)
        filters.createdAt.$lte = new Date(req.query.createdTo);
    }

    // ========== BOOLEAN FILTERS ==========

    if (req.query.hasPhone === "true") {
      filters["enrichedData.phone_number1"] = { $exists: true, $ne: null };
    }
    if (req.query.hasPhone === "false") {
      filters["enrichedData.phone_number1"] = { $in: [null, ""] };
    }

    if (req.query.hasPersonalEmail === "true") {
      filters["enrichedData.personal_email1"] = { $exists: true, $ne: null };
    }

    // ========== SORTING ==========
    const sortFieldMap = {
      name: "enrichedData.full_name",
      email: "enrichedData.email",
      company: "enrichedData.company",
      title: "enrichedData.title",
      location: "enrichedData.location",
      enrichedAt: "misc.enrichedAt",
      createdAt: "createdAt",
    };

    let sortBy = { createdAt: -1 };

    if (req.query.sortBy) {
      const field = sortFieldMap[req.query.sortBy] || "createdAt";
      const order = req.query.sortOrder === "asc" ? 1 : -1;
      sortBy = { [field]: order };
    }

    // ========== EXECUTE QUERY ==========
    const totalCount = await LinkedinProfile.countDocuments(filters);
    const totalPages = Math.ceil(totalCount / limit);

    const profiles = await LinkedinProfile.find(filters)
      .sort(sortBy)
      .skip(skip)
      .limit(limit)
      .lean();

    return sendResponse(res, 200, "Enriched profiles fetched successfully", {
      profiles,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get Enriched Profiles Error:", error);
    return sendError(next, error.message, 500);
  }
});

const retryEnrichmentForPending = async () => {
  try {
    console.log("[RETRY] Checking pending enrichment profiles...");
    const pendingProfiles = await LinkedinProfile.find({
      isEnriched: false,
      "misc.wizaListId": { $exists: true },
    });

    if (pendingProfiles.length === 0) {
      console.log("[RETRY] No pending profiles found.");
      return { total: 0, updated: 0, notFound: 0 };
    }

    const listGroups = {};
    for (const profile of pendingProfiles) {
      const listId = profile.misc.wizaListId;
      if (!listGroups[listId]) listGroups[listId] = [];
      listGroups[listId].push(profile);
    }
    let updated = 0;
    let notFound = 0;

    // 2. Process each Wiza List ID
    for (const listId of Object.keys(listGroups)) {
      console.log(`[RETRY] Fetching contacts for Wiza List ${listId}...`);

      try {
        const response = await axios.get(
          `${WIZA_API_URL}/${listId}/contacts?segment=people`,
          { headers: { Authorization: `Bearer ${WIZA_API_KEY}` } }
        );
        const contacts = response.data?.data || [];
        console.log(`[RETRY] Contacts fetched: ${contacts.length}`);

        // 3. Update each profile in DB
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

          const result = await LinkedinProfile.findOneAndUpdate(
            { linkedinId },
            {
              $set: {
                isEnriched: true,
                enrichedData: contact,
                payload: contact,
                "misc.enrichedAt": new Date(),
                "misc.reEnrichedAt": new Date(),
                "misc.enrichmentStatus": "completed",
              },
            },
            { new: true }
          );

          if (result) updated++;
          else notFound++;
        }
      } catch (err) {
        console.error(
          `[RETRY] Error re-fetching for List ${listId}:`,
          err.message
        );
      }
    }

    console.log("[RETRY] Completed:", { updated, notFound });

    return {
      total: pendingProfiles.length,
      updated,
      notFound,
      groups: Object.keys(listGroups).length,
    };
  } catch (error) {
    console.error("[RETRY] Fatal Error:", error);
    return { error: error.message };
  }
};

export {
  uploadProfiles,
  wizaWebhook,
  retryEnrichmentForPending,
  getAllEnrichedProfiles,
};
