import CampaignFilter from "../models/CallingDataFiltrationModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import Company from "../models/MasterDBModel/companyModel.js";
import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import CallingData from "../models/callingDataModal.js";
import ClientCompanyList from "../models/clientCompanyList.js";
import ClientMatchEntry from "../models/clientMatchEntryModel.js";
import SharedFilter from "../models/sharedFilter.js";
import XLSX from "xlsx";
import csv from "csvtojson";
import fs from "fs";
import mongoose from "mongoose";
import {
  createMatchJob,
  updateMatchJob,
  completeMatchJob,
  failMatchJob,
  subscribeMatchJob,
  unsubscribeMatchJob,
} from "../utils/matchJobStore.js";
import { buildDbIndex, matchBatch } from "../services/companyMatcher.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const getCampaignFiltersByCampaignId = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }

    const filters = await CampaignFilter.find({ campaignId })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();

    if (!filters || filters.length === 0) {
      return sendResponse(res, 200, "No campaign filters found", []);
    }

    return sendResponse(res, 200, "Campaign filters fetched successfully", {
      count: filters.length,
      filters,
    });
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to fetch campaign filters",
      500
    );
  }
});

function buildMongoQuery(filters = [], exclusions = []) {
  const query = {};

  if (filters.length > 0) {
    query.$and = filters.map((f) => {
      if (Array.isArray(f.value)) {
        return { [f.field]: { $in: f.value } };
      }
      return { [f.field]: f.value };
    });
  }

  if (exclusions.length > 0) {
    query.$and = [
      ...(query.$and || []),
      ...exclusions.map((f) => {
        if (Array.isArray(f.value)) {
          return { [f.field]: { $nin: f.value } };
        }
        return { [f.field]: { $ne: f.value } };
      }),
    ];
  }

  return query;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers for scalable assignment pipelines
//  (handles crores of records via cursor streaming + pre-lookup sort)
// ─────────────────────────────────────────────────────────────────────────────

/** Contact-doc fields that can be matched/sorted BEFORE $lookup (no join needed) */
const CONTACT_ONLY_FIELDS = new Set([
  "Contact_Country",
  "Contact_State",
  "Contact_Region",
  "Contact_City",
  "Job_Function",
  "Job_Seniority",
  "Job_Title",
  "Gender",
]);

/** Company fields that require $lookup — mapped to company_info.* */
const COMPANY_FIELD_MAP = {
  Industry: "company_info.Industry",
  Sub_Industry: "company_info.Sub_Industry",
  Company_Segment: "company_info.Company_Segment",
  Employees_Range: "company_info.Employees_Range",
  Turnover_Range: "company_info.Turnover_Range",
};

/**
 * $match stage that runs BEFORE $lookup.
 * Covers: discrepency check, contact-only field filters, optional Company_ID filter.
 */
function buildPreLookupMatch(filters = [], exclusions = [], companyIds = []) {
  const q = { "discrepencyInData.status": { $ne: true } };

  for (const { field, value } of filters) {
    if (
      CONTACT_ONLY_FIELDS.has(field) &&
      Array.isArray(value) &&
      value.length
    ) {
      q[field] = { $in: value };
    }
  }
  for (const { field, value } of exclusions) {
    if (
      CONTACT_ONLY_FIELDS.has(field) &&
      Array.isArray(value) &&
      value.length
    ) {
      if (q[field]) {
        q.$and = (q.$and || []).concat({ [field]: { $nin: value } });
      } else {
        q[field] = { $nin: value };
      }
    }
  }
  if (companyIds.length > 0) {
    q.Company_ID = {
      $in: companyIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  return q;
}

/**
 * $match stage that runs AFTER $lookup + $unwind.
 * Covers: company-mapped field filters/exclusions.
 */
function buildPostLookupMatch(filters = [], exclusions = []) {
  const q = {};
  for (const { field, value } of filters) {
    const mapped = COMPANY_FIELD_MAP[field];
    if (mapped && Array.isArray(value) && value.length)
      q[mapped] = { $in: value };
  }
  for (const { field, value } of exclusions) {
    const mapped = COMPANY_FIELD_MAP[field];
    if (mapped && Array.isArray(value) && value.length)
      q[mapped] = { $nin: value };
  }
  return q;
}

/** Only the fields needed for CallingData mapping — keeps cursor docs lean */
const ASSIGN_PROJECT = {
  Contact_ID: 1,
  Contact_Source: 1,
  Contact_Create_Date: 1,
  Salutation: 1,
  First_Name: 1,
  Last_Name: 1,
  Full_Name: 1,
  Gender: 1,
  Job_Title: 1,
  Job_Seniority: 1,
  Job_Function: 1,
  Contact_Address_1: 1,
  Contact_Address_2: 1,
  Contact_Address_3: 1,
  Contact_City: 1,
  Contact_Pin: 1,
  Contact_State: 1,
  Contact_Region: 1,
  Contact_Country: 1,
  Contact_STD_ISD_Code: 1,
  Contact_Location_Tier: 1,
  Contact_Direct_Phone1: 1,
  Contact_Direct_Phone2: 1,
  Contact_Extn_No: 1,
  Mobile_No: 1,
  Office_Email_1: 1,
  Office_Email_2: 1,
  Personal_Email1: 1,
  Personal_Email2: 1,
  Contact_LinkedIn_Profile: 1,
  Unsubscribe_Flag: 1,
  Unsubscribe_Account_Tag: 1,
  DND_Flag: 1,
  DND_Account_Tag: 1,
  Last_Engagement: 1,
  Last_Engagement_Date: 1,
  Last_Engagement_Campaign: 1,
  Telecalling_Remarks: 1,
  EngagementPoints: 1,
  "company_info._id": 1,
  "company_info.Company_Name": 1,
  "company_info.Company_ID_Kestone": 1,
  // "company_info.Affinity_ID_Dell": 1,
  // "company_info.Company_ID_Google": 1,
  "company_info.Company_Source": 1,
  "company_info.Year_Founded": 1,
  "company_info.Turnover_Range": 1,
  "company_info.Employees_Range": 1,
  "company_info.Industry": 1,
  "company_info.Sub_Industry": 1,
  "company_info.Company_Segment": 1,
  "company_info.Website": 1,
  "company_info.Company_LinkedIn_Profile": 1,
  "company_info.Company_Phone1": 1,
  "company_info.Company_Phone2": 1,
};

/**
 * Build the optimised assignment pipeline:
 *   $match (contact fields only)         ← uses indexes, small docs
 *   $lookup + $unwind (companies)
 *   $match (company fields, if any)
 *   $project (only needed fields)
 *
 * $sort removed — exceeds MongoDB 32MB in-memory limit on large collections.
 * All contacts are inserted regardless, so order does not affect result data.
 */
function buildAssignPipeline(preLookupMatch, postLookupMatch) {
  const pipeline = [
    { $match: preLookupMatch },
    {
      $lookup: {
        from: "companies",
        localField: "Company_ID",
        foreignField: "_id",
        as: "company_info",
      },
    },
    { $unwind: { path: "$company_info", preserveNullAndEmptyArrays: true } },
  ];
  if (Object.keys(postLookupMatch).length > 0) {
    pipeline.push({ $match: postLookupMatch });
  }
  pipeline.push({ $project: ASSIGN_PROJECT });
  return pipeline;
}

/** Map one aggregation row → CallingData insert document */
function mapContactToEntry(
  row,
  {
    campaignId,
    uploadedBy,
    batchLabel,
    dataSourceType,
    source,
    companyMetaMap = {},
  }
) {
  const companyIdStr = row.company_info?._id
    ? String(row.company_info._id)
    : "";
  const meta = companyMetaMap[companyIdStr] || {};
  return {
    CampaignId: new mongoose.Types.ObjectId(campaignId),
    UploadedBy: new mongoose.Types.ObjectId(uploadedBy),
    source,
    batch: batchLabel,
    dataSourceType,
    Contact_ID: row.Contact_ID,
    Contact_Source: row.Contact_Source,
    Contact_Create_Date: row.Contact_Create_Date,
    Salutation: row.Salutation,
    First_Name: row.First_Name,
    Last_Name: row.Last_Name,
    Full_Name: row.Full_Name,
    Gender: row.Gender,
    Job_Title: row.Job_Title,
    Job_Seniority: row.Job_Seniority,
    Job_Function: row.Job_Function,
    Contact_Address_1: row.Contact_Address_1,
    Contact_Address_2: row.Contact_Address_2,
    Contact_Address_3: row.Contact_Address_3,
    Contact_City: row.Contact_City,
    Contact_Pin: row.Contact_Pin,
    Contact_State: row.Contact_State,
    Contact_Region: row.Contact_Region,
    Contact_Country: row.Contact_Country,
    Contact_STD_ISD_Code: row.Contact_STD_ISD_Code,
    Contact_Location_Tier: row.Contact_Location_Tier,
    Contact_Direct_Phone1: row.Contact_Direct_Phone1,
    Contact_Direct_Phone2: row.Contact_Direct_Phone2,
    Contact_Extn_No: row.Contact_Extn_No,
    Mobile_No: row.Mobile_No,
    Office_Email_1: row.Office_Email_1,
    Office_Email_2: row.Office_Email_2,
    Personal_Email1: row.Personal_Email1,
    Personal_Email2: row.Personal_Email2,
    Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile,
    Unsubscribe_Flag: row.Unsubscribe_Flag,
    Unsubscribe_Account_Tag: row.Unsubscribe_Account_Tag,
    DND_Flag: row.DND_Flag,
    DND_Account_Tag: row.DND_Account_Tag,
    Last_Engagement: row.Last_Engagement,
    Last_Engagement_Date: row.Last_Engagement_Date,
    Last_Engagement_Campaign: row.Last_Engagement_Campaign,
    Telecalling_Remarks: row.Telecalling_Remarks,
    Company_ID: row.company_info?._id || null,
    Company_Name: row.company_info?.Company_Name || "",
    Company_ID_Kestone: row.company_info?.Company_ID_Kestone || "",
    // Affinity_ID_Dell: row.company_info?.Affinity_ID_Dell || "",
    // Company_ID_Google: row.company_info?.Company_ID_Google || "",
    Company_Source: row.company_info?.Company_Source || "",
    Year_Founded: row.company_info?.Year_Founded || "",
    Turnover_Range: row.company_info?.Turnover_Range || "",
    Employees_Range: row.company_info?.Employees_Range || "",
    Industry: row.company_info?.Industry || "",
    Sub_Industry: row.company_info?.Sub_Industry || "",
    Company_Segment: row.company_info?.Company_Segment || "",
    Website: row.company_info?.Website || "",
    Company_LinkedIn_Profile: row.company_info?.Company_LinkedIn_Profile || "",
    Company_Phone1: row.company_info?.Company_Phone1 || "",
    Company_Phone2: row.company_info?.Company_Phone2 || "",
    EngagementPoints: row.EngagementPoints,
    clientInfo: {
      companySpecificId: meta.companySpecificId || "",
      segment: meta.segment || "",
    },
  };
}

/**
 * Per-chunk dedup + insertMany.
 * Querying CallingData in chunks avoids loading all Contact_IDs into memory.
 */
async function insertContactsChunk(entries, campaignId) {
  if (!entries.length) return { inserted: 0, duplicates: 0 };

  const contactIds = entries.map((e) => e.Contact_ID).filter(Boolean);
  const existing = await CallingData.find(
    { CampaignId: campaignId, Contact_ID: { $in: contactIds } },
    { Contact_ID: 1 }
  ).lean();

  const existingSet = new Set(existing.map((e) => e.Contact_ID));
  const unique = entries.filter((e) => !existingSet.has(e.Contact_ID));

  if (!unique.length) return { inserted: 0, duplicates: entries.length };

  try {
    await CallingData.insertMany(unique, { ordered: false });
    return {
      inserted: unique.length,
      duplicates: entries.length - unique.length,
    };
  } catch (err) {
    console.error("[insertContactsChunk] insertMany error:", err.message);
    return { inserted: 0, duplicates: entries.length };
  }
}

/**
 * Stream-process aggregation cursor in chunks of 1000.
 * Never loads more than CHUNK_SIZE docs into Node.js heap at once.
 * allowDiskUse: true lets MongoDB spill sorts/lookups to disk — no 32MB limit.
 */
async function streamInsertContacts(pipeline, opts) {
  const CHUNK_SIZE = 1000;
  const cursor = Contact.collection.aggregate(pipeline, { allowDiskUse: true });

  let chunk = [];
  let insertedCount = 0;
  let duplicateCount = 0;
  let totalProcessed = 0;

  for await (const row of cursor) {
    chunk.push(mapContactToEntry(row, opts));
    if (chunk.length >= CHUNK_SIZE) {
      const { inserted, duplicates } = await insertContactsChunk(
        chunk,
        opts.campaignId
      );
      insertedCount += inserted;
      duplicateCount += duplicates;
      totalProcessed += chunk.length;
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    const { inserted, duplicates } = await insertContactsChunk(
      chunk,
      opts.campaignId
    );
    insertedCount += inserted;
    duplicateCount += duplicates;
    totalProcessed += chunk.length;
  }

  return { totalProcessed, insertedCount, duplicateCount };
}

const callingDataFilterOld = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, filters = [], exclusions = [], datatype } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }
    if (!datatype) {
      return sendError(next, "Data Type is required", 400);
    }

    const fieldMapping = {
      // Contact_Country: "Contact_Country",
      // Contact_Region: "Contact_Region",
      // Job_Function: "Job_Function",
      // Job_Seniority: "Job_Seniority",
      // Industry: "company_info.Industry",
      // Employees_Range: "company_info.Employees_Range",
      Industry: "company_info.Industry",
      Sub_Industry: "company_info.Sub_Industry",
      Company_Segment: "company_info.Company_Segment",
      Employees_Range: "company_info.Employees_Range",
      Turnover_Range: "company_info.Turnover_Range",
      Contact_Country: "Contact_Country",
      Contact_State: "Contact_State",
      Contact_Region: "Contact_Region",
      Contact_City: "Contact_City",
      Job_Function: "Job_Function",
      Job_Seniority: "Job_Seniority",
      Gender: "Gender",
    };

    const buildMongoQuery = (filtersArr, operator = "$in") => {
      const q = {};
      filtersArr.forEach(({ field, value }) => {
        const mappedField = fieldMapping[field] || field;
        if (Array.isArray(value) && value.length > 0) {
          q[mappedField] = { [operator]: value };
        }
      });
      return q;
    };

    const includeQuery = buildMongoQuery(filters, "$in");
    const excludeQuery = buildMongoQuery(exclusions, "$nin");

    req.setTimeout(300000);

    const statsPipeline = [
      {
        $lookup: {
          from: "companies",
          localField: "Company_ID",
          foreignField: "_id",
          as: "company_info",
        },
      },
      {
        $unwind: {
          path: "$company_info",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: {
          "discrepencyInData.status": { $ne: true },
          ...includeQuery,
          ...excludeQuery,
        },
      },
      {
        $addFields: {
          normalizedIndustry: {
            $cond: [
              { $ifNull: ["$company_info.Industry", false] },
              "$company_info.Industry",
              "Unknown",
            ],
          },
          normalizedSeniority: {
            $cond: [
              { $ifNull: ["$Job_Seniority", false] },
              "$Job_Seniority",
              "Unknown",
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            industry: "$normalizedIndustry",
            seniority: "$normalizedSeniority",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          crossTabData: {
            $push: {
              industry: "$_id.industry",
              seniority: "$_id.seniority",
              count: "$count",
            },
          },
          totalContacts: { $sum: "$count" },
        },
      },
    ];

    const [statsResult, uniqueCompaniesCount] = await Promise.all([
      Contact.aggregate(statsPipeline),
      Contact.aggregate([
        {
          $lookup: {
            from: "companies",
            localField: "Company_ID",
            foreignField: "_id",
            as: "company_info",
          },
        },
        {
          $unwind: { path: "$company_info", preserveNullAndEmptyArrays: true },
        },
        {
          $match: {
            "discrepencyInData.status": { $ne: true },
            ...includeQuery,
            ...excludeQuery,
          },
        },
        { $group: { _id: "$Company_ID" } },
        { $count: "uniqueCompanies" },
      ]),
    ]);

    const stats = statsResult[0] || { crossTabData: [], totalContacts: 0 };
    const uniqueCompanies = uniqueCompaniesCount[0]?.uniqueCompanies || 0;

    const crossTabData = stats.crossTabData || [];

    const industries = [...new Set(crossTabData.map((i) => i.industry))].sort();
    const seniorities = [
      ...new Set(crossTabData.map((i) => i.seniority)),
    ].sort();

    const crossTabTable = {};
    const industryTotals = {};
    const seniorityTotals = {};

    industries.forEach((ind) => {
      crossTabTable[ind] = {};
      industryTotals[ind] = 0;
      seniorities.forEach((sen) => {
        crossTabTable[ind][sen] = 0;
      });
    });

    seniorities.forEach((sen) => {
      seniorityTotals[sen] = 0;
    });

    crossTabData.forEach(({ industry, seniority, count }) => {
      crossTabTable[industry][seniority] = count;
      industryTotals[industry] += count;
      seniorityTotals[seniority] += count;
    });

    const formattedStats = {
      totalContacts: stats.totalContacts,
      uniqueCompanies,
      crossTabulation: {
        industries,
        seniorities,
        data: crossTabTable,
        industryTotals,
        seniorityTotals,
      },
      industryBreakdown: Object.entries(industryTotals)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [ind, count]) => ({ ...acc, [ind]: count }), {}),
      seniorityBreakdown: Object.entries(seniorityTotals)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [sen, count]) => ({ ...acc, [sen]: count }), {}),
    };

    const filteredData = {
      contactCount: stats.totalContacts,
      summary: formattedStats,
      contacts: [],
    };

    const lastFilter = await CampaignFilter.findOne({ campaignId }).sort({
      revisionNo: -1,
    });

    let revisionNo = 1;
    let listName = "List1";
    if (lastFilter) {
      revisionNo = lastFilter.revisionNo + 1;
      listName = `List${revisionNo}`;
    }

    const campaignFilter = await CampaignFilter.create({
      campaignId,
      filters,
      exclusions,
      revisionNo,
      listName,
      filteredData,
      dataType: datatype,
      contactCount: stats.totalContacts,
      status: "Pending",
    });
    await Campaign.findByIdAndUpdate(campaignId, { stage: "Filtered" });

    return sendResponse(
      res,
      200,
      "Campaign Industry vs Job_Seniority stats generated successfully",
      {
        filteredData,
        campaignFilterId: campaignFilter._id,
        revisionNo,
        listName,
      }
    );
  } catch (err) {
    console.error("Campaign filter error:", err);
    return sendError(
      next,
      err.message || "Failed to create campaign filter",
      500
    );
  }
});
const callingDataFilter = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, filters = [], exclusions = [], datatype } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }
    if (!datatype) {
      return sendError(next, "Data Type is required", 400);
    }

    const fieldMapping = {
      Industry: "company_info.Industry",
      Sub_Industry: "company_info.Sub_Industry",
      Company_Segment: "company_info.Company_Segment",
      Employees_Range: "company_info.Employees_Range",
      Turnover_Range: "company_info.Turnover_Range",
      Contact_Country: "Contact_Country",
      Contact_State: "Contact_State",
      Contact_Region: "Contact_Region",
      Contact_City: "Contact_City",
      Job_Function: "Job_Function",
      Job_Seniority: "Job_Seniority",
      Job_Title: "Job_Title",
      Gender: "Gender",
    };

    const buildMongoQuery = (filtersArr, operator = "$in") => {
      const q = {};
      filtersArr.forEach(({ field, value }) => {
        const mappedField = fieldMapping[field] || field;
        if (Array.isArray(value) && value.length > 0) {
          q[mappedField] = { [operator]: value };
        }
      });
      return q;
    };

    const includeQuery = buildMongoQuery(filters, "$in");
    const excludeQuery = buildMongoQuery(exclusions, "$nin");

    req.setTimeout(300000);

    // ================= PIPELINE =================
    const statsPipeline = [
      {
        $lookup: {
          from: "companies",
          localField: "Company_ID",
          foreignField: "_id",
          as: "company_info",
        },
      },
      {
        $unwind: {
          path: "$company_info",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: {
          "discrepencyInData.status": { $ne: true },
          ...includeQuery,
          ...excludeQuery,
        },
      },
      {
        $addFields: {
          normalizedIndustry: {
            $cond: [
              { $ifNull: ["$company_info.Industry", false] },
              "$company_info.Industry",
              "Unknown",
            ],
          },
          normalizedSeniority: {
            $cond: [
              { $ifNull: ["$Job_Seniority", false] },
              "$Job_Seniority",
              "Unknown",
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            industry: "$normalizedIndustry",
            seniority: "$normalizedSeniority",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          crossTabData: {
            $push: {
              industry: "$_id.industry",
              seniority: "$_id.seniority",
              count: "$count",
            },
          },
          totalContacts: { $sum: "$count" },
        },
      },
    ];

    // ================= EXECUTE =================
    const [statsResult, uniqueCompaniesCount] = await Promise.all([
      Contact.aggregate(statsPipeline, { allowDiskUse: true }),

      Contact.aggregate(
        [
          {
            $lookup: {
              from: "companies",
              localField: "Company_ID",
              foreignField: "_id",
              as: "company_info",
            },
          },
          {
            $unwind: {
              path: "$company_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $match: {
              "discrepencyInData.status": { $ne: true },
              ...includeQuery,
              ...excludeQuery,
            },
          },
          { $group: { _id: "$Company_ID" } },
          { $count: "uniqueCompanies" },
        ],
        { allowDiskUse: true }
      ),
    ]);

    const stats = statsResult[0] || { crossTabData: [], totalContacts: 0 };
    const uniqueCompanies = uniqueCompaniesCount[0]?.uniqueCompanies || 0;

    const crossTabData = stats.crossTabData || [];

    // ================= BUILD TABLE =================
    const industries = [...new Set(crossTabData.map((i) => i.industry))].sort();

    const seniorities = [
      ...new Set(crossTabData.map((i) => i.seniority)),
    ].sort();

    const crossTabTable = {};
    const industryTotals = {};
    const seniorityTotals = {};

    industries.forEach((ind) => {
      crossTabTable[ind] = {};
      industryTotals[ind] = 0;

      seniorities.forEach((sen) => {
        crossTabTable[ind][sen] = 0;
      });
    });

    seniorities.forEach((sen) => {
      seniorityTotals[sen] = 0;
    });

    crossTabData.forEach(({ industry, seniority, count }) => {
      crossTabTable[industry][seniority] = count;
      industryTotals[industry] += count;
      seniorityTotals[seniority] += count;
    });

    // ================= FINAL FORMAT =================
    const formattedStats = {
      totalContacts: stats.totalContacts,
      uniqueCompanies,
      crossTabulation: {
        industries,
        seniorities,
        data: crossTabTable,
        industryTotals,
        seniorityTotals,
      },
      industryBreakdown: industryTotals,
      seniorityBreakdown: seniorityTotals,
    };

    const filteredData = {
      contactCount: stats.totalContacts,
      summary: formattedStats,
      contacts: [],
    };

    // ================= SAVE =================
    const lastFilter = await CampaignFilter.findOne({ campaignId }).sort({
      revisionNo: -1,
    });

    let revisionNo = 1;
    let listName = "List1";

    if (lastFilter) {
      revisionNo = lastFilter.revisionNo + 1;
      listName = `List${revisionNo}`;
    }

    const campaignFilter = await CampaignFilter.create({
      campaignId,
      filters,
      exclusions,
      revisionNo,
      listName,
      filteredData,
      dataType: datatype,
      contactCount: stats.totalContacts,
      status: "Pending",
    });

    await Campaign.findByIdAndUpdate(campaignId, { stage: "Filtered" });

    return sendResponse(
      res,
      200,
      "Industry vs Job Seniority stats generated successfully",
      {
        filteredData,
        campaignFilterId: campaignFilter._id,
        revisionNo,
        listName,
      }
    );
  } catch (err) {
    console.error("Campaign filter error:", err);
    return sendError(
      next,
      err.message || "Failed to create campaign filter",
      500
    );
  }
});

const callingDataFilterLightweight = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, filters = [], exclusions = [] } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }

    const query = buildMongoQuery(filters, exclusions);

    // Simplified aggregation for basic stats
    const basicStatsPipeline = [
      { $match: query },
      {
        $lookup: {
          from: "companies",
          localField: "company_id",
          foreignField: "_id",
          as: "company_info",
        },
      },
      {
        $unwind: {
          path: "$company_info",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: null,
          totalContacts: { $sum: 1 },
          uniqueCompanies: { $addToSet: "$company_id" },

          // Profile breakdown
          profileCounts: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$profile", null] },
                    { $ne: ["$profile", ""] },
                  ],
                },
                "$profile",
                {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$job_title", null] },
                        { $ne: ["$job_title", ""] },
                      ],
                    },
                    "$job_title",
                    "Unknown",
                  ],
                },
              ],
            },
          },

          // Industry breakdown
          industryCounts: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$company_info.industry", null] },
                    { $ne: ["$company_info.industry", ""] },
                  ],
                },
                "$company_info.industry",
                "Unknown",
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalContacts: 1,
          uniqueCompanies: { $size: "$uniqueCompanies" },

          // Convert arrays to frequency counts
          profileBreakdown: {
            $reduce: {
              input: "$profileCounts",
              initialValue: {},
              in: {
                $mergeObjects: [
                  "$$value",
                  {
                    $let: {
                      vars: { key: "$$this" },
                      in: {
                        $arrayToObject: [
                          [
                            {
                              k: "$$key",
                              v: {
                                $add: [
                                  {
                                    $ifNull: [
                                      {
                                        $getField: {
                                          field: "$$key",
                                          input: "$$value",
                                        },
                                      },
                                      0,
                                    ],
                                  },
                                  1,
                                ],
                              },
                            },
                          ],
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },

          industryBreakdown: {
            $reduce: {
              input: "$industryCounts",
              initialValue: {},
              in: {
                $mergeObjects: [
                  "$$value",
                  {
                    $let: {
                      vars: { key: "$$this" },
                      in: {
                        $arrayToObject: [
                          [
                            {
                              k: "$$key",
                              v: {
                                $add: [
                                  {
                                    $ifNull: [
                                      {
                                        $getField: {
                                          field: "$$key",
                                          input: "$$value",
                                        },
                                      },
                                      0,
                                    ],
                                  },
                                  1,
                                ],
                              },
                            },
                          ],
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ];

    const result = await Contact.aggregate(basicStatsPipeline);
    const stats = result[0] || {
      totalContacts: 0,
      uniqueCompanies: 0,
      profileBreakdown: {},
      industryBreakdown: {},
    };

    const filteredData = {
      // contactCount: stats.totalContacts,
      summary: {
        totalContacts: stats.totalContacts,
        uniqueCompanies: stats.uniqueCompanies,
        profileBreakdown: stats.profileBreakdown,
        industryBreakdown: stats.industryBreakdown,
      },
      // contacts: [],
    };

    const campaignFilter = await CampaignFilter.create({
      campaignId,
      filters,
      exclusions,
      revisionNo: 1,
      contactCount: stats.totalContacts,
      status: "Pending",
    });

    return sendResponse(
      res,
      200,
      "Basic campaign filter statistics generated",
      {
        filteredData,
        campaignFilterId: campaignFilter._id,
      }
    );
  } catch (err) {
    console.error("Basic campaign filter error:", err);
    return sendError(
      next,
      err.message || "Failed to create basic campaign filter",
      500
    );
  }
});
const getPrevCampFiltersByCampaignId = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return sendError(next, "Camapign Id is required", 400);
    }
    const campaignData = await Campaign.findById(campaignId).lean();
    if (!campaignData) {
      return sendError(next, "No Data found for this campaignId", 400);
    }
    const dataSourceType = campaignData.dataSourceType;
    const filters = await CampaignFilter.find({
      campaignId,
      dataType: dataSourceType,
    })
      .sort({ revisionNo: 1, createdAt: 1 })
      .lean();
    return sendResponse(res, 200, "Campaign filters fetched successfully", {
      count: filters.length,
      filters,
    });
  } catch (err) {
    console.error("Error fetching previous campaign filters", err);
    return sendError(
      next,
      err.message || "Failed to fetch campaign filters",
      500
    );
  }
});

// ── Company matching helpers ──────────────────────────────────────────────────

/** Yield to the event loop between batches so SSE events can flush */
const yieldControl = () => new Promise((resolve) => setImmediate(resolve));

// ── In-memory caches ──────────────────────────────────────────────────────────

/**
 * DB company index cache (shared across all requests).
 * Loading + indexing 3.7 lakh companies takes ~3s; we rebuild at most every 30 min.
 */
let _dbIndexCache = null;
let _dbIndexCacheTime = 0;
const DB_INDEX_TTL_MS = 30 * 60 * 1000; // 30 minutes

const getOrBuildDbIndex = async () => {
  const now = Date.now();
  if (_dbIndexCache && now - _dbIndexCacheTime < DB_INDEX_TTL_MS) {
    return _dbIndexCache;
  }
  const allDbCompanies = await Company.find(
    {},
    { _id: 1, Company_Name: 1 }
  ).lean();
  // buildDbIndex constructs all 6 lookup maps + TF-IDF vectors in one pass
  _dbIndexCache = buildDbIndex(allDbCompanies);
  _dbIndexCacheTime = now;
  return _dbIndexCache;
};

/**
 * Match result cache (per campaignId).
 * Populated by runCompanyMatchJob so getClientMatchData returns instantly.
 * Invalidated when a new upload starts for the same campaignId.
 * TTL: 2 hours.
 */
const _matchResultCache = new Map(); // campaignId (string) → { result, approvedIds, rejectedIds, cachedAt }
const RESULT_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const getCachedMatchResult = (campaignId) => {
  const entry = _matchResultCache.get(String(campaignId));
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > RESULT_CACHE_TTL_MS) {
    _matchResultCache.delete(String(campaignId));
    return null;
  }
  return entry;
};

const setCachedMatchResult = (campaignId, result) => {
  _matchResultCache.set(String(campaignId), {
    ...result,
    cachedAt: Date.now(),
  });
};

const invalidateMatchResultCache = (campaignId) => {
  // Only clear the in-memory cache. Never delete DB records here — that would
  // wipe all history before the new session is even persisted.
  _matchResultCache.delete(String(campaignId));
};

// ── Persistent DB helpers (survive server restarts) ───────────────────────────

// Flat-collection insert batch size (avoids building one giant array in memory)
const ENTRY_BATCH = 500;
// Rows per page returned by getClientMatchData — matches frontend default rowsPerPage
const MATCH_PAGE_SIZE = 100;

/**
 * Returns true when the dataset is too large for the browser to receive in one response.
 * Estimated JSON bytes: complete×150 + partial×600 + notMatched×30 > 25 MB
 */
const isResultTooLarge = ({
  completeCount = 0,
  partialCount = 0,
  notMatchedCount = 0,
} = {}) =>
  completeCount * 150 + partialCount * 600 + notMatchedCount * 30 > 25_000_000;

/**
 * Persist match results to the flat ClientMatchEntry collection.
 * Streams inserts in small batches so we never build a giant in-memory array —
 * prevents the OOM crash that plagued the old bulkWrite-all-chunks approach.
 */
const persistToEntryCollection = async (
  campaignId,
  {
    completelyMatched,
    partiallyMatched,
    notMatched,
    duplicates = [],
    uploadSession,
    counts,
  }
) => {
  const base = { campaignId, dataType: "Client", uploadSession };

  // Meta doc first — stores counts so history tabs work without loading all entries
  await ClientMatchEntry.findOneAndUpdate(
    { campaignId, dataType: "Client", uploadSession, matchType: "meta" },
    { $set: { ...base, matchType: "meta", counts } },
    { upsert: true, new: true }
  );

  // Stream-insert complete entries
  for (let i = 0; i < completelyMatched.length; i += ENTRY_BATCH) {
    const batch = completelyMatched.slice(i, i + ENTRY_BATCH).map((e) => ({
      ...base,
      matchType: "complete",
      inputName: e.matchedWith || "",
      companySpecificId: e.companySpecificId || "",
      segment: e.segment || "",
      companyId: e._id,
      companyName: e.Company_Name,
      matchedWith: e.matchedWith || "",
    }));
    await ClientMatchEntry.insertMany(batch, { ordered: false });
    await yieldControl();
  }

  // Stream-insert partial entries
  for (let i = 0; i < partiallyMatched.length; i += ENTRY_BATCH) {
    const batch = partiallyMatched.slice(i, i + ENTRY_BATCH).map((e) => ({
      ...base,
      matchType: "partial",
      inputName: e.input || e.inputName || "",
      companySpecificId: e.companySpecificId || "",
      segment: e.segment || "",
      suggestions: e.suggestions || [],
    }));
    await ClientMatchEntry.insertMany(batch, { ordered: false });
    await yieldControl();
  }

  // Stream-insert notMatched entries (larger batches — just strings)
  const NM_BATCH = ENTRY_BATCH * 4;
  for (let i = 0; i < notMatched.length; i += NM_BATCH) {
    const batch = notMatched.slice(i, i + NM_BATCH).map((name) => ({
      ...base,
      matchType: "notMatched",
      inputName: typeof name === "string" ? name : name?.inputName || "",
    }));
    await ClientMatchEntry.insertMany(batch, { ordered: false });
    await yieldControl();
  }

  // Stream-insert duplicate entries
  for (let i = 0; i < duplicates.length; i += NM_BATCH) {
    const batch = duplicates.slice(i, i + NM_BATCH).map((name) => ({
      ...base,
      matchType: "duplicate",
      inputName: typeof name === "string" ? name : name?.inputName || "",
    }));
    await ClientMatchEntry.insertMany(batch, { ordered: false });
    await yieldControl();
  }

  console.log(
    `[MatchEntry] Persisted session ${uploadSession} — C:${counts.completeCount} P:${counts.partialCount} N:${counts.notMatchedCount} D:${counts.duplicatesCount}`
  );

  // Backfill uploadHistory into cache so the next getClientMatchData call doesn't
  // need an extra DB query for history tabs.
  const history = await loadUploadHistoryFromEntry(campaignId, uploadSession);
  const existing = _matchResultCache.get(String(campaignId));
  if (existing) {
    _matchResultCache.set(String(campaignId), {
      ...existing,
      uploadHistory: history,
    });
  }
};

/**
 * Load upload history from the new flat ClientMatchEntry collection.
 * Returns array of session metadata sorted newest-first, excluding currentSession.
 */
const loadUploadHistoryFromEntry = async (campaignId, currentSession) => {
  const metaDocs = await ClientMatchEntry.find({
    campaignId,
    dataType: "Client",
    matchType: "meta",
    ...(currentSession ? { uploadSession: { $ne: currentSession } } : {}),
  })
    .sort({ uploadSession: -1 })
    .select("uploadSession counts")
    .lean();

  return metaDocs.map((d) => ({
    uploadSession: d.uploadSession,
    uploadedAt: d.uploadSession,
    completeCount: d.counts?.completeCount ?? 0,
    partialCount: d.counts?.partialCount ?? 0,
    notMatchedCount: d.counts?.notMatchedCount ?? 0,
    duplicatesCount: d.counts?.duplicatesCount ?? 0,
  }));
};

/**
 * Load the latest upload session from the new flat ClientMatchEntry collection.
 * Returns null when no data exists in ClientMatchEntry.
 * Returns { tooLarge: true, counts, uploadHistory } for very large datasets.
 */
const loadMatchResultFromEntry = async (campaignId) => {
  const meta = await ClientMatchEntry.findOne({
    campaignId,
    dataType: "Client",
    matchType: "meta",
  })
    .sort({ uploadSession: -1 })
    .select("uploadSession counts")
    .lean();

  if (!meta) return null;

  const { uploadSession, counts = {} } = meta;

  // Check tooLarge BEFORE running any more queries — avoids loading GBs of data
  if (isResultTooLarge(counts)) {
    const uploadHistory = await loadUploadHistoryFromEntry(
      campaignId,
      uploadSession
    );
    return {
      tooLarge: true,
      uploadSession,
      completelyMatchedCount: counts.completeCount ?? 0,
      partiallyMatchedCount: counts.partialCount ?? 0,
      notMatchedCount: counts.notMatchedCount ?? 0,
      duplicatesCount: counts.duplicatesCount ?? 0,
      uploadHistory,
    };
  }

  // Run all queries in a single parallel round-trip.
  // Complete: limit to MATCH_PAGE_SIZE+1 for display; if there are more, run a second
  //   lightweight query (companyId + meta only) so the frontend can build the full
  //   companyIds list for the filter without loading complete docs with all fields.
  // Partial / notMatched / duplicates: limit to MATCH_PAGE_SIZE+1 to detect hasMore.
  const PG = MATCH_PAGE_SIZE;
  const needAllComplete = (counts.completeCount ?? 0) > PG;
  const completeBase = {
    campaignId,
    dataType: "Client",
    uploadSession,
    matchType: "complete",
  };

  const [
    uploadHistory,
    completeDocs,
    allCompleteRaw,
    partialRaw,
    notMatchedRaw,
    duplicateRaw,
  ] = await Promise.all([
    loadUploadHistoryFromEntry(campaignId, uploadSession),
    ClientMatchEntry.find(completeBase)
      .select(
        "companyId companyName matchedWith inputName companySpecificId segment"
      )
      .limit(PG + 1)
      .lean(),
    // Only when completeCount > page size — fetches minimal fields for filter/companyMetaMap
    needAllComplete
      ? ClientMatchEntry.find(completeBase)
          .select("companyId companyName companySpecificId segment")
          .lean()
      : Promise.resolve(null),
    ClientMatchEntry.find({
      campaignId,
      dataType: "Client",
      uploadSession,
      matchType: "partial",
    })
      .select("inputName companySpecificId segment suggestions")
      .limit(PG + 1)
      .lean(),
    ClientMatchEntry.find({
      campaignId,
      dataType: "Client",
      uploadSession,
      matchType: "notMatched",
    })
      .select("inputName")
      .limit(PG + 1)
      .lean(),
    ClientMatchEntry.find({
      campaignId,
      dataType: "Client",
      uploadSession,
      matchType: "duplicate",
    })
      .select("inputName")
      .limit(PG + 1)
      .lean(),
  ]);

  const completeHasMore = completeDocs.length > PG;
  const partialHasMore = partialRaw.length > PG;
  const notMatchedHasMore = notMatchedRaw.length > PG;
  const duplicatesHasMore = duplicateRaw.length > PG;

  const mapCompleteDoc = (d) => ({
    _id: d.companyId,
    Company_Name: d.companyName,
    matchedWith: d.matchedWith || d.inputName,
    ...(d.companySpecificId ? { companySpecificId: d.companySpecificId } : {}),
    ...(d.segment ? { segment: d.segment } : {}),
  });

  return {
    uploadSession,
    uploadHistory,
    // Accurate totals from meta doc (not array lengths)
    completeCount: counts.completeCount ?? 0,
    partialCount: counts.partialCount ?? 0,
    notMatchedCount: counts.notMatchedCount ?? 0,
    duplicatesCount: counts.duplicatesCount ?? 0,
    completeHasMore,
    partialHasMore,
    notMatchedHasMore,
    duplicatesHasMore,
    completelyMatched: completeDocs.slice(0, PG).map(mapCompleteDoc),
    // Full complete list (minimal fields) for frontend filter — null when fits in first page
    allCompleteEntries: allCompleteRaw
      ? allCompleteRaw.map((d) => ({
          _id: d.companyId,
          Company_Name: d.companyName,
          ...(d.companySpecificId
            ? { companySpecificId: d.companySpecificId }
            : {}),
          ...(d.segment ? { segment: d.segment } : {}),
        }))
      : null,
    partiallyMatched: partialRaw.slice(0, PG).map((d) => ({
      inputName: d.inputName,
      suggestions: d.suggestions || [],
      ...(d.companySpecificId
        ? { companySpecificId: d.companySpecificId }
        : {}),
      ...(d.segment ? { segment: d.segment } : {}),
    })),
    notMatched: notMatchedRaw.slice(0, PG).map((d) => d.inputName),
    duplicates: duplicateRaw.slice(0, PG).map((d) => d.inputName),
  };
};

/**
 * Normalize a company name for matching:
 * - lowercase, strip punctuation, remove common corporate suffixes,
 *   collapse whitespace.
 */
const normalizeCompanyName = (str) => {
  if (str == null || str === "") return "";
  return String(str)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"""]/g, " ")
    .replace(
      /\b(pvt|ltd|limited|inc|corp|llc|co|private|public|enterprises|enterprise|solutions|services|technologies|technology|india|group|holdings|global|worldwide|international|industries|industry|systems|system|consulting|consultancy)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Lightweight alternative to normalizeCompanyName.
 * Only lowercases and strips punctuation — no stopword removal.
 * Preserves meaningful words like "co-operative", "bank", "india" so that
 * simple substring containment works correctly regardless of case.
 */
const simplifyName = (str) => {
  if (str == null || str === "") return "";
  return String(str)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"""]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Background worker: load DB companies, build inverted index, match in batches.
 * Pushes SSE progress events via matchJobStore.
 */
// Max candidates checked per input — prevents O(n²) for common words like "india/tech"
const MAX_CANDIDATES = 300;
// For large uploads, cap suggestions per partial-match entry at 15.
// Keeps DB storage and browser payload small when processing lakh-scale data.
const LARGE_DATASET_SUGGESTIONS = 15;
const LARGE_DATASET_THRESHOLD = 5_000; // rows — above this use the small cap
// Returns the max suggestions to include per partial-match entry.
const getSuggestionsLimit = (totalNames) => {
  if (totalNames >= LARGE_DATASET_THRESHOLD) return LARGE_DATASET_SUGGESTIONS;
  return Math.min(
    MAX_CANDIDATES,
    Math.max(10, Math.floor(500_000 / totalNames))
  );
};

async function runCompanyMatchJob(jobId, filePath, ext, campaignId, dataType) {
  // Invalidate any stale cached results for this campaign
  invalidateMatchResultCache(campaignId);

  // Stage 1 — parse the uploaded file (inside job so HTTP response is instant)
  updateMatchJob(jobId, "Parsing uploaded file...", 3);
  await yieldControl();

  // companyRows: { name, companySpecificId, segment }[]
  let companyRows = [];
  let invalidRowCount = 0;
  try {
    const pickVal = (row, keys) => {
      for (const k of keys) {
        const v = row[k];
        if (v != null && String(v).trim()) return String(v).trim();
      }
      return "";
    };
    const parseRow = (row) => {
      const name = pickVal(row, [
        "CompanyName",
        "Company_Name",
        "company_name",
        "company",
        "companyNames",
      ]);
      if (!name) return null;
      return {
        name,
        companySpecificId: pickVal(row, [
          "CompanySpecificId",
          "Company_Specific_Id",
          "company_specific_id",
          "companyspecificid",
          "SpecificId",
          "Specific_Id",
        ]),
        segment: pickVal(row, [
          "Segment",
          "segment",
          "Segment_Name",
          "SegmentName",
          "segment_name",
        ]),
      };
    };

    const filterAndCount = (parsed) => {
      const valid = [];
      for (const r of parsed) {
        if (r) valid.push(r);
        else invalidRowCount++;
      }
      return valid;
    };

    if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
      const workbook = XLSX.readFile(filePath, {
        cellText: false,
        cellDates: false,
        raw: false,
      }); // skip w/h/r fields → ~3-5x less memory for large files
      const sheet = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]]
      );
      companyRows = filterAndCount(sheet.map(parseRow));
    } else {
      const rows = await csv().fromFile(filePath);
      companyRows = filterAndCount(rows.map(parseRow));
    }
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* already gone */
    }
  }

  if (!companyRows.length) {
    failMatchJob(jobId, "No valid company names found in the file");
    return;
  }

  const MAX_UPLOAD_ROWS = 50_000;
  if (companyRows.length > MAX_UPLOAD_ROWS) {
    failMatchJob(
      jobId,
      `Upload limit exceeded: your file has ${companyRows.length.toLocaleString()} rows. Maximum allowed is ${MAX_UPLOAD_ROWS.toLocaleString()}. Please split the file into batches of up to 50,000 rows.`
    );
    return;
  }

  // Flat names array (for backward-compat with ClientCompanyList + progress messages)
  const companyNames = companyRows.map((r) => r.name);

  // Deduplicate: first occurrence of each name → matchRows; extras → duplicates.
  // e.g. "ABC Corp" × 3  →  1 in matchRows, 2 in duplicates.
  const seenNameKeys = new Set();
  const matchRows = [];
  const duplicates = []; // extra occurrences (strings) shown in Duplicates tab
  for (const row of companyRows) {
    const key = row.name.toLowerCase();
    if (!seenNameKeys.has(key)) {
      seenNameKeys.add(key);
      matchRows.push(row);
    } else {
      duplicates.push(row.name);
    }
  }
  updateMatchJob(
    jobId,
    `Parsed ${companyNames.length.toLocaleString()} companies. Scanning database...`,
    8
  );
  await yieldControl();

  // Stage 2 — load DB index (shared cache, rebuilt every 30 min)
  const dbIndex = await getOrBuildDbIndex();

  updateMatchJob(
    jobId,
    `Index ready. Matching ${matchRows.length.toLocaleString()} unique companies...`,
    20
  );
  await yieldControl();

  // Stage 3 — 6-step pipeline in batches (yield every 500 rows for SSE flush)
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(matchRows.length / BATCH_SIZE);
  // Use a Map across all batches so cross-batch duplicate DB companies are caught too.
  const completeMap = new Map(); // _id string → entry
  const partiallyMatched = [];
  const notMatchedRows = [];
  const sameCompanyDups = []; // names whose DB company was already matched by another name

  for (let b = 0; b < totalBatches; b++) {
    const batch = matchRows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const done = Math.min((b + 1) * BATCH_SIZE, matchRows.length);
    updateMatchJob(
      jobId,
      `Matching companies... ${done.toLocaleString()} / ${matchRows.length.toLocaleString()}`,
      20 + Math.round((b / totalBatches) * 73)
    );
    await yieldControl();

    const {
      completelyMatched: bc,
      partiallyMatched: bp,
      notMatched: bn,
      sameCompanyDuplicates: bsd,
    } = matchBatch(batch, dbIndex, getSuggestionsLimit, MAX_CANDIDATES);

    // Merge bc into completeMap — batch-level dedup already done; cross-batch dedup here
    for (const entry of bc) {
      const id = String(entry._id);
      if (completeMap.has(id)) {
        sameCompanyDups.push(entry.matchedWith); // second cross-batch match → duplicate
      } else {
        completeMap.set(id, entry);
      }
    }
    partiallyMatched.push(...bp);
    notMatchedRows.push(...bn);
    if (bsd?.length) sameCompanyDups.push(...bsd);
  }

  const completelyMatched = [...completeMap.values()];
  const notMatched = [
    ...notMatchedRows,
    ...Array.from({ length: invalidRowCount }, () => "(No Company Name)"),
  ];

  // Stage 4 — save company names list for ClientCompanyList (for re-match on cache miss)
  updateMatchJob(jobId, "Saving results...", 93);
  await yieldControl();

  const SAVE_CHUNK = 10_000;
  const nameChunks = [];
  for (let i = 0; i < companyNames.length; i += SAVE_CHUNK) {
    nameChunks.push({
      campaignId,
      dataType,
      companyNames: companyNames.slice(i, i + SAVE_CHUNK),
    });
  }
  await ClientCompanyList.deleteMany({ campaignId, dataType });
  await ClientCompanyList.insertMany(nameChunks, { ordered: false });

  // ISO timestamp used as the unique session ID for this upload
  const uploadSession = new Date().toISOString();

  // Merge same-DB-company duplicates into the main duplicates list so the total
  // row count matches the original upload (complete + partial + notMatched + duplicates = uploaded)
  const allDuplicates = [...duplicates, ...sameCompanyDups];

  const counts = {
    completeCount: completelyMatched.length,
    partialCount: partiallyMatched.length,
    notMatchedCount: notMatched.length,
    duplicatesCount: allDuplicates.length,
  };
  const tooLarge = isResultTooLarge(counts);

  // For non-tooLarge: cache arrays NOW so getClientMatchData can serve them even if
  // the DB persist fails. persistToEntryCollection will then backfill uploadHistory.
  if (!tooLarge) {
    setCachedMatchResult(campaignId, {
      completelyMatched,
      partiallyMatched,
      notMatched,
      duplicates: allDuplicates,
      uploadSession,
    });
  }

  // Persist to DB — streaming flat inserts avoid the OOM from building all chunks at once
  updateMatchJob(jobId, "Saving to database...", 97);
  try {
    await persistToEntryCollection(campaignId, {
      completelyMatched,
      partiallyMatched,
      notMatched,
      duplicates: allDuplicates,
      uploadSession,
      counts,
    });
  } catch (persistErr) {
    // Non-fatal: data is already in memory cache (for non-tooLarge)
    console.warn("[runCompanyMatchJob] DB persist failed:", persistErr.message);
  }

  // For tooLarge: cache counts-only AFTER persist (arrays not needed in memory anymore)
  if (tooLarge) {
    setCachedMatchResult(campaignId, {
      tooLarge: true,
      uploadSession,
      completelyMatchedCount: counts.completeCount,
      partiallyMatchedCount: counts.partialCount,
      notMatchedCount: counts.notMatchedCount,
      duplicatesCount: counts.duplicatesCount,
      uploadHistory: [],
    });
  }

  // Send only a signal — NOT the full result data.
  // Large arrays (3 lakh notMatched entries) would exceed SSE buffer limits.
  // The frontend re-fetches via getClientMatchData which hits the cache above.
  completeMatchJob(jobId);
}

// ── Controller: start match job ───────────────────────────────────────────────

//for client suggestion apis
const companiesMatchedDataWithExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "Please upload an Excel or CSV file", 400);
    }
    const { campaignId, dataType } = req.body;
    const filePath = req.file.path;
    const ext = (req.file.originalname || filePath).toLowerCase();

    if (
      !ext.endsWith(".xlsx") &&
      !ext.endsWith(".xls") &&
      !ext.endsWith(".csv")
    ) {
      fs.unlinkSync(filePath);
      return sendError(
        next,
        "Unsupported file format. Upload .csv or .xlsx",
        400
      );
    }

    // Respond immediately — file parsing + matching runs in background
    // (parsing 5 lakh rows can take 30-60s; we must not block the HTTP response)
    const jobId = createMatchJob();
    res.status(202).json({
      success: true,
      message: "Matching started",
      data: { jobId },
    });

    // Fire-and-forget
    runCompanyMatchJob(jobId, filePath, ext, campaignId, dataType).catch(
      (err) => {
        console.error("[matchJob] Background error:", err.message);
        failMatchJob(jobId, err.message || "Matching failed");
      }
    );
  } catch (err) {
    console.error("Error in companiesMatchedDataWithExcel:", err);
    return sendError(next, err.message || "Failed to match companies", 500);
  }
});

// ── Controller: SSE stream for job progress ───────────────────────────────────

const getMatchJobStatus = (req, res) => {
  const { jobId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  const send = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // client already disconnected
    }
  };

  const listener = (event) => {
    send(event);
    if (event.type === "complete" || event.type === "error") {
      unsubscribeMatchJob(jobId, listener);
      res.end();
    }
  };

  const found = subscribeMatchJob(jobId, listener);
  if (!found) {
    send({ type: "error", error: "Job not found or expired" });
    res.end();
    return;
  }

  // Clean up if client disconnects early
  req.on("close", () => {
    unsubscribeMatchJob(jobId, listener);
  });
};

//filter for client calling data
const clientCallingDataFilter = asyncHandler(async (req, res, next) => {
  try {
    const {
      campaignId,
      filters = [],
      exclusions = [],
      datatype = "Client",
      companyIds = [],
      companyMetaMap = {},
      filterId, // optional — if provided, update existing record instead of creating a new one
    } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }
    if (!datatype) {
      return sendError(next, "Data Type is required", 400);
    }

    // Split filters into pre-lookup (contact fields + Company_ID) and post-lookup (company fields)
    const preLookup = buildPreLookupMatch(filters, exclusions, companyIds);
    const postLookup = buildPostLookupMatch(filters, exclusions);

    req.setTimeout(300000);

    const statsPipeline = [
      // Pre-lookup: filters contact-only fields + Company_ID before the expensive join
      { $match: preLookup },
      {
        $lookup: {
          from: "companies",
          localField: "Company_ID",
          foreignField: "_id",
          as: "company_info",
        },
      },
      {
        $unwind: {
          path: "$company_info",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Post-lookup: filters on joined company fields (Industry, Employees_Range, etc.)
      ...(Object.keys(postLookup).length > 0 ? [{ $match: postLookup }] : []),
      {
        $addFields: {
          normalizedIndustry: {
            $cond: [
              { $ifNull: ["$company_info.Industry", false] },
              "$company_info.Industry",
              "Unknown",
            ],
          },
          normalizedSeniority: {
            $cond: [
              { $ifNull: ["$Job_Seniority", false] },
              "$Job_Seniority",
              "Unknown",
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            industry: "$normalizedIndustry",
            seniority: "$normalizedSeniority",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          crossTabData: {
            $push: {
              industry: "$_id.industry",
              seniority: "$_id.seniority",
              count: "$count",
            },
          },
          totalContacts: { $sum: "$count" },
        },
      },
    ];

    // Parallel query for unique companies
    const [statsResult, uniqueCompaniesCount] = await Promise.all([
      Contact.aggregate(statsPipeline, { allowDiskUse: true }),
      Contact.aggregate(
        [
          { $match: preLookup },
          {
            $lookup: {
              from: "companies",
              localField: "Company_ID",
              foreignField: "_id",
              as: "company_info",
            },
          },
          {
            $unwind: {
              path: "$company_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          ...(Object.keys(postLookup).length > 0
            ? [{ $match: postLookup }]
            : []),
          { $group: { _id: "$Company_ID" } },
          { $count: "uniqueCompanies" },
        ],
        { allowDiskUse: true }
      ),
    ]);

    const stats = statsResult[0] || { crossTabData: [], totalContacts: 0 };
    const uniqueCompanies = uniqueCompaniesCount[0]?.uniqueCompanies || 0;

    const crossTabData = stats.crossTabData || [];

    const industries = [...new Set(crossTabData.map((i) => i.industry))].sort();
    const seniorities = [
      ...new Set(crossTabData.map((i) => i.seniority)),
    ].sort();

    const crossTabTable = {};
    const industryTotals = {};
    const seniorityTotals = {};

    industries.forEach((ind) => {
      crossTabTable[ind] = {};
      industryTotals[ind] = 0;
      seniorities.forEach((sen) => {
        crossTabTable[ind][sen] = 0;
      });
    });

    seniorities.forEach((sen) => {
      seniorityTotals[sen] = 0;
    });

    crossTabData.forEach(({ industry, seniority, count }) => {
      crossTabTable[industry][seniority] = count;
      industryTotals[industry] += count;
      seniorityTotals[seniority] += count;
    });

    const formattedStats = {
      totalContacts: stats.totalContacts,
      uniqueCompanies,
      crossTabulation: {
        industries,
        seniorities,
        data: crossTabTable,
        industryTotals,
        seniorityTotals,
      },
      industryBreakdown: Object.entries(industryTotals)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [ind, count]) => ({ ...acc, [ind]: count }), {}),
      seniorityBreakdown: Object.entries(seniorityTotals)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [sen, count]) => ({ ...acc, [sen]: count }), {}),
    };

    const filteredData = {
      contactCount: stats.totalContacts,
      summary: formattedStats,
      contacts: [],
    };

    // Resolve company names for the IDs used in this filter
    let companyNamesUsed = [];
    if (companyIds.length > 0) {
      const companiesUsed = await Company.find(
        {
          _id: { $in: companyIds.map((id) => new mongoose.Types.ObjectId(id)) },
        },
        { Company_Name: 1 }
      ).lean();
      companyNamesUsed = companiesUsed
        .map((c) => c.Company_Name)
        .filter(Boolean);
    }

    let campaignFilter;
    let revisionNo;
    let listName;

    // If filterId is supplied, UPDATE the existing record so we never accumulate
    // stale filter revisions and the assignment always uses exactly this filter.
    if (filterId) {
      campaignFilter = await CampaignFilter.findByIdAndUpdate(
        filterId,
        {
          filters,
          exclusions,
          filteredData,
          contactCount: stats.totalContacts,
          status: "Pending",
          "misc.companyIdsUsed": companyIds,
          "misc.companyNamesUsed": companyNamesUsed,
          "misc.companyMetaMap": companyMetaMap,
        },
        { new: true }
      );
      // Fallback: filterId was invalid/deleted — create a fresh one
      if (!campaignFilter) filterId = null;
    }

    if (!filterId) {
      const lastFilter = await CampaignFilter.findOne({ campaignId }).sort({
        revisionNo: -1,
      });
      revisionNo = lastFilter ? lastFilter.revisionNo + 1 : 1;
      listName = `List${revisionNo}`;
      campaignFilter = await CampaignFilter.create({
        campaignId,
        filters,
        exclusions,
        revisionNo,
        listName,
        filteredData,
        dataType: datatype,
        contactCount: stats.totalContacts,
        status: "Pending",
        misc: { companyIdsUsed: companyIds, companyNamesUsed, companyMetaMap },
      });
    }

    revisionNo = campaignFilter.revisionNo;
    listName = campaignFilter.listName;

    return sendResponse(
      res,
      200,
      "Campaign Industry vs Job_Seniority stats generated successfully",
      {
        filteredData,
        campaignFilterId: campaignFilter._id,
        revisionNo,
        listName,
      }
    );
  } catch (err) {
    console.error("Campaign filter error:", err);
    return sendError(
      next,
      err.message || "Failed to create campaign filter",
      500
    );
  }
});

//assign  calling data filtration(kestone masterdatabase)
const assignCallingDataToCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, uploadedBy, dataSourceType } = req.body;
    if (!campaignId || !uploadedBy) {
      return sendError(next, "Required fields missing", 400);
    }

    const lastFilter = await CampaignFilter.findOne({ campaignId })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();
    if (!lastFilter) {
      return sendError(next, "No campaign filter found for this campaign", 404);
    }

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);

    const batchNumber = (campaign.filterBatches?.length || 0) + 1;
    const batchLabel = `Batch-${batchNumber}`;

    const preLookup = buildPreLookupMatch(
      lastFilter.filters || [],
      lastFilter.exclusions || []
    );
    const postLookup = buildPostLookupMatch(
      lastFilter.filters || [],
      lastFilter.exclusions || []
    );
    const pipeline = buildAssignPipeline(preLookup, postLookup);

    const { totalProcessed, insertedCount, duplicateCount } =
      await streamInsertContacts(pipeline, {
        campaignId,
        uploadedBy,
        batchLabel,
        dataSourceType: dataSourceType || "Kestone",
        source: "MasterDB",
      });

    if (totalProcessed === 0) {
      return sendError(next, "No contacts found for this filter", 404);
    }

    if (insertedCount === 0) {
      return sendResponse(
        res,
        200,
        "All contacts already exist in this campaign. No new data added.",
        {
          contacts: totalProcessed,
          campaignId,
          insertedCount: 0,
          duplicateCount,
          uniqueCount: 0,
          batchNumber,
          batchLabel,
        }
      );
    }

    await Campaign.findByIdAndUpdate(
      { _id: campaignId },
      {
        isCallingDataAssigned: true,
        $push: {
          filterBatches: {
            filterBatchId: new mongoose.Types.ObjectId(lastFilter._id),
          },
        },
      },
      { new: true }
    );

    return sendResponse(res, 200, "Calling data processed successfully", {
      contacts: totalProcessed,
      campaignId,
      insertedCount,
      duplicateCount,
      uniqueCount: insertedCount,
      batchNumber,
      batchLabel,
      message:
        duplicateCount > 0
          ? `${duplicateCount} duplicate contacts skipped. ${insertedCount} new contacts added.`
          : "All new contacts inserted successfully.",
    });
  } catch (err) {
    console.error("Error assigning calling data to campaign:", err);
    return sendError(
      next,
      err.message || "Failed to assign calling data to campaign",
      500
    );
  }
});

//assign  calling data filtration(Client masterdatabase)
const assignCallingDataToCampaignClientSuggested = asyncHandler(
  async (req, res, next) => {
    try {
      const {
        campaignId,
        uploadedBy,
        dataSourceType = "Client",
        filterId,
      } = req.body;
      if (!campaignId || !uploadedBy) {
        return sendError(next, "Required fields missing", 400);
      }

      // Use the exact filter that was shown to the user (filterId) when available.
      // Fallback to latest by revisionNo for backward compatibility.
      const lastFilter = filterId
        ? await CampaignFilter.findById(filterId).lean()
        : await CampaignFilter.findOne({ campaignId, dataType: "Client" })
            .sort({ revisionNo: -1, createdAt: -1 })
            .lean();
      if (!lastFilter) {
        return sendError(next, "No client filter found for this campaign", 404);
      }

      const campaign = await Campaign.findById(campaignId).lean();
      if (!campaign) return sendError(next, "Campaign not found", 404);

      const batchNumber = (campaign.filterBatches?.length || 0) + 1;
      const batchLabel = `Batch-${batchNumber}`;

      const companyIds = lastFilter.misc?.companyIdsUsed || [];
      const companyMetaMap = lastFilter.misc?.companyMetaMap || {};
      const preLookup = buildPreLookupMatch(
        lastFilter.filters || [],
        lastFilter.exclusions || [],
        companyIds
      );
      const postLookup = buildPostLookupMatch(
        lastFilter.filters || [],
        lastFilter.exclusions || []
      );
      const pipeline = buildAssignPipeline(preLookup, postLookup);

      const { totalProcessed, insertedCount, duplicateCount } =
        await streamInsertContacts(pipeline, {
          campaignId,
          uploadedBy,
          batchLabel,
          dataSourceType,
          source: "ClientSuggested",
          companyMetaMap,
        });

      if (totalProcessed === 0) {
        return sendError(next, "No contacts found for this filter", 404);
      }

      if (insertedCount === 0) {
        return sendResponse(
          res,
          200,
          "All contacts already exist in this campaign. No new data added.",
          {
            contacts: totalProcessed,
            campaignId,
            insertedCount: 0,
            duplicateCount,
            uniqueCount: 0,
            batchNumber,
            batchLabel,
          }
        );
      }

      await Campaign.findByIdAndUpdate(
        { _id: campaignId },
        {
          isCallingDataAssigned: true,
          $push: {
            filterBatches: {
              filterBatchId: new mongoose.Types.ObjectId(lastFilter._id),
            },
          },
        },
        { new: true }
      );

      return sendResponse(
        res,
        200,
        "Client-suggested calling data processed successfully",
        {
          contacts: totalProcessed,
          campaignId,
          insertedCount,
          duplicateCount,
          uniqueCount: insertedCount,
          batchNumber,
          batchLabel,
          message:
            duplicateCount > 0
              ? `${duplicateCount} duplicate contacts skipped. ${insertedCount} new contacts added.`
              : "All new contacts inserted successfully.",
        }
      );
    } catch (err) {
      return sendError(
        next,
        err.message || "Failed to assign client-suggested calling data",
        500
      );
    }
  }
);
//assign calling data for both filter (client + kestone)
const assignCallingDataToCampaignBoth = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, uploadedBy } = req.body;
    if (!campaignId || !uploadedBy) {
      return sendError(next, "Campaign Id / UploadedBy missing", 400);
    }

    const bothFilter = await CampaignFilter.findOne({
      campaignId,
      dataType: "Both",
    }).lean();
    if (!bothFilter)
      return sendError(next, "Both filter not found for this campaign", 404);

    const kestoneFilter = await CampaignFilter.findOne({
      campaignId,
      dataType: "Kestone",
    })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();
    if (!kestoneFilter)
      return sendError(next, "No Kestone filter found for this campaign", 404);

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);

    const batchNumber = (campaign.filterBatches?.length || 0) + 1;
    const batchLabel = `Batch-${batchNumber}`;

    // ── Extract client filters from bothFilter ──
    const clientFilters = bothFilter.filterSources
      ? bothFilter.filters
          .map((f) => {
            const src = bothFilter.filterSources.find(
              (s) => s.field === f.field
            );
            if (!src) return null;
            const vals = src.sources
              .filter((s) => s.source === "Client")
              .map((s) => s.value);
            return vals.length ? { field: f.field, value: vals } : null;
          })
          .filter(Boolean)
      : bothFilter.filters;

    // ── Build pipelines ──
    const kestonePipeline = buildAssignPipeline(
      buildPreLookupMatch(
        kestoneFilter.filters || [],
        kestoneFilter.exclusions || []
      ),
      buildPostLookupMatch(
        kestoneFilter.filters || [],
        kestoneFilter.exclusions || []
      )
    );
    const clientPipeline = buildAssignPipeline(
      buildPreLookupMatch(clientFilters, []),
      buildPostLookupMatch(clientFilters, [])
    );

    // ── Client contacts inserted first → they take precedence over Kestone ──
    // When Kestone streams, per-chunk dedup will skip contacts already inserted by Client.
    const clientResult = await streamInsertContacts(clientPipeline, {
      campaignId,
      uploadedBy,
      batchLabel,
      dataSourceType: "Client",
      source: "Both",
    });

    const kestoneResult = await streamInsertContacts(kestonePipeline, {
      campaignId,
      uploadedBy,
      batchLabel,
      dataSourceType: "Kestone",
      source: "Both",
    });

    const totalProcessed =
      clientResult.totalProcessed + kestoneResult.totalProcessed;
    const insertedCount =
      clientResult.insertedCount + kestoneResult.insertedCount;
    const duplicateCount =
      clientResult.duplicateCount + kestoneResult.duplicateCount;

    if (totalProcessed === 0) {
      return sendError(next, "No contacts found for Both filter", 404);
    }

    if (insertedCount === 0) {
      return sendResponse(
        res,
        200,
        "All contacts already exist. No new data added.",
        {
          campaignId,
          insertedCount: 0,
          duplicateCount,
          uniqueCount: 0,
          batchNumber,
          batchLabel,
        }
      );
    }

    await Campaign.findByIdAndUpdate(
      { _id: campaignId },
      {
        isCallingDataAssigned: true,
        $push: {
          filterBatches: {
            filterBatchId: new mongoose.Types.ObjectId(bothFilter._id),
          },
        },
      }
    );

    return sendResponse(
      res,
      200,
      "Both-filter calling data processed successfully",
      {
        campaignId,
        insertedCount,
        duplicateCount,
        uniqueCount: insertedCount,
        batchNumber,
        batchLabel,
        message:
          duplicateCount > 0
            ? `${duplicateCount} duplicate contacts skipped. ${insertedCount} new contacts added.`
            : "All new contacts inserted successfully.",
      }
    );
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to assign calling data with Both filter",
      500
    );
  }
});

//sharable magic link
const generateMagicLink = asyncHandler(async (req, res, next) => {
  try {
    const { campaignFilterId, revisionNo, createdBy, allowedDevices } =
      req.body;

    if (!campaignFilterId) {
      return sendError(next, "Campaign Filter ID is required", 400);
    }

    const existingLink = await SharedFilter.findOne({
      campaignFilterId,
      isActive: true,
    });

    if (existingLink) {
      const magicLink = `${
        process.env.FRONTEND_URL || req.get("origin")
      }/shared-stats/${existingLink.filterId}`;

      return sendResponse(res, 200, "Magic link already exists", {
        magicLink,
        filterId: existingLink.filterId,
        expiresAt: existingLink.expiresAt,
        isExisting: true,
      });
    }

    const filterId =
      new mongoose.Types.ObjectId().toString() + Date.now().toString(36);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // ===== CREATE RECORD =====
    await SharedFilter.create({
      filterId,
      campaignFilterId,
      revisionNo,
      createdBy,
      expiresAt,
      allowedDevices: allowedDevices || 3,
      accessDevices: [],
      isActive: true,
    });

    const magicLink = `${
      process.env.FRONTEND_URL || req.get("origin")
    }/shared-stats/${filterId}`;

    return sendResponse(res, 200, "Magic link generated successfully", {
      magicLink,
      filterId,
      expiresAt,
    });
  } catch (error) {
    console.error(error);
    return sendError(next, error.message, 500);
  }
});

// Get Shared Filter Stats
const getSharedFilterStats = asyncHandler(async (req, res, next) => {
  try {
    const { filterId } = req.params;

    const sharedFilter = await SharedFilter.findOne({
      filterId,
      isActive: true,
    }).populate({
      path: "campaignFilterId",
      select: "filteredData",
    });

    const limitedData = await SharedFilter.findOne({
      filterId,
      isActive: true,
    })
      .select("campaignFilterId expiresAt  revisionNo -_id ")
      .populate({
        path: "campaignFilterId",
        select: "filteredData expiresAt ",
      });

    if (!sharedFilter) {
      return sendError(next, "Link not found", 404);
    }

    if (new Date() > sharedFilter.expiresAt) {
      return sendError(next, "Link expired", 410);
    }

    // ===== DEVICE + IP TRACKING =====
    const ip =
      req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip;

    const userAgent = req.headers["user-agent"] || "unknown";

    const deviceId = `${ip}_${userAgent}`;

    const existingDevice = sharedFilter.accessDevices.find(
      (d) => d.deviceId === deviceId
    );

    if (!existingDevice) {
      if (sharedFilter.accessDevices.length >= sharedFilter.allowedDevices) {
        return sendError(next, "You do not have access to open this link", 403);
      }

      sharedFilter.accessDevices.push({
        deviceId,
        ip,
        userAgent,
        firstAccessAt: new Date(),
        lastAccessAt: new Date(),
      });
    } else {
      existingDevice.lastAccessAt = new Date();
    }

    sharedFilter.views += 1;
    sharedFilter.lastViewedAt = new Date();

    await sharedFilter.save();

    return sendResponse(res, 200, "Success", {
      data: limitedData,
      // filterId: sharedFilter.filterId,
      // revisionNo: sharedFilter.revisionNo,
      // views: sharedFilter.views,
    });
  } catch (error) {
    console.error(error);
    return sendError(next, error.message, 500);
  }
});

// Deactivate Shared Link (Soft Delete)
const deactivateSharedLink = asyncHandler(async (req, res, next) => {
  try {
    const { filterId } = req.params;
    const userId = req.user?._id;

    const sharedFilter = await SharedFilter.findOne({
      filterId,
      createdBy: userId,
      isActive: true,
    });

    if (!sharedFilter) {
      return sendError(next, "Shared link not found or unauthorized", 404);
    }

    await SharedFilter.findByIdAndUpdate(sharedFilter._id, {
      isActive: false,
    });

    return sendResponse(res, 200, "Shared link deactivated successfully");
  } catch (error) {
    console.error("Deactivate shared link error:", error);
    return sendError(next, error.message, 500);
  }
});

// Extend Link Expiry
const extendLinkExpiry = asyncHandler(async (req, res, next) => {
  try {
    const { filterId } = req.params;
    const { days = 7 } = req.body;
    const userId = req.user?._id;

    const sharedFilter = await SharedFilter.findOne({
      filterId,
      createdBy: userId,
      isActive: true,
    });

    if (!sharedFilter) {
      return sendError(next, "Shared link not found or unauthorized", 404);
    }

    // Extend expiry
    const newExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await SharedFilter.findByIdAndUpdate(sharedFilter._id, {
      expiresAt: newExpiresAt,
    });

    return sendResponse(res, 200, "Link expiry extended successfully", {
      newExpiresAt,
    });
  } catch (error) {
    console.error("Extend link expiry error:", error);
    return sendError(next, error.message, 500);
  }
});

// GET: fetch saved company names for campaign and re-run matching
const getClientMatchData = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "Campaign ID is required", 400);

    // Fire the approvedIds DB query immediately so it runs in parallel with
    // whatever path (cache / DB / slow) we end up taking below.
    const latestDocPromise = ClientCompanyList.findOne({
      campaignId,
      dataType: "Client",
    })
      .sort({ updatedAt: -1 })
      .select("approvedIds rejectedIds")
      .lean()
      .catch(() => null); // never let this reject the whole handler

    // Helper: build response payload. Uses uploadHistory from the result object
    // when already cached — avoids any extra DB query on the fast path.
    const buildPayload = async (result) => {
      // tooLarge — return counts only, no arrays (avoids serialization OOM)
      if (result.tooLarge) {
        const latestDoc = await latestDocPromise;
        const approvedIds = (latestDoc?.approvedIds || []).map((e) => ({
          _id: String(e.companyId),
          Company_Name: e.Company_Name,
          inputName: e.inputName,
        }));
        const rejectedIds = (latestDoc?.rejectedIds || []).map((e) => ({
          _id: String(e.companyId),
          Company_Name: e.Company_Name,
          inputName: e.inputName,
        }));
        return {
          tooLarge: true,
          completelyMatchedCount:
            result.completelyMatchedCount ?? result.completeCount ?? 0,
          partiallyMatchedCount:
            result.partiallyMatchedCount ?? result.partialCount ?? 0,
          notMatchedCount: result.notMatchedCount ?? 0,
          duplicatesCount: result.duplicatesCount ?? 0,
          approvedIds,
          rejectedIds,
          uploadSession: result.uploadSession || null,
          uploadHistory: result.uploadHistory || [],
        };
      }

      const latestDoc = await latestDocPromise;
      const approvedIds = (latestDoc?.approvedIds || []).map((e) => ({
        _id: String(e.companyId),
        Company_Name: e.Company_Name,
        inputName: e.inputName,
      }));
      const rejectedIds = (latestDoc?.rejectedIds || []).map((e) => ({
        _id: String(e.companyId),
        Company_Name: e.Company_Name,
        inputName: e.inputName,
      }));
      // uploadHistory is already on the result when loaded from DB or after persist backfill.
      // Only fall back to a DB query when it's genuinely missing (rare cold start).
      let history;
      if (result.uploadHistory !== undefined) {
        history = result.uploadHistory;
      } else if (result.uploadSession) {
        // Try new flat collection first; fall back to old chunked collection for legacy data
        history = await loadUploadHistoryFromEntry(
          campaignId,
          result.uploadSession
        );
      } else {
        history = [];
      }

      const allComplete = result.completelyMatched || [];
      const partial = result.partiallyMatched || [];
      const notMatch = result.notMatched || [];
      const dups = result.duplicates || [];

      // Prefer explicit counts from meta doc (DB path); fall back to array length (slow path / old cache)
      const completeCount = result.completeCount ?? allComplete.length;
      const partialCount = result.partialCount ?? partial.length;
      const notMatchedCount = result.notMatchedCount ?? notMatch.length;
      const duplicatesCount = result.duplicatesCount ?? dups.length;

      // hasMore: use persisted flag (DB path) or detect by length (slow path / old cache)
      const completeHasMore =
        result.completeHasMore ?? allComplete.length > MATCH_PAGE_SIZE;
      const partialHasMore =
        result.partialHasMore ?? partial.length > MATCH_PAGE_SIZE;
      const notMatchedHasMore =
        result.notMatchedHasMore ?? notMatch.length > MATCH_PAGE_SIZE;
      const duplicatesHasMore =
        result.duplicatesHasMore ?? dups.length > MATCH_PAGE_SIZE;

      // allCompleteEntries: full list with minimal fields for frontend filter/companyMetaMap.
      // DB path: result.allCompleteEntries is already computed (null when fits in first page).
      // Cache path: result.allCompleteEntries is undefined — derive from full cached array.
      let allCompleteEntries;
      if (result.allCompleteEntries !== undefined) {
        // DB path — already set (may be null when completeCount <= MATCH_PAGE_SIZE)
        allCompleteEntries = result.allCompleteEntries;
      } else if (completeHasMore) {
        // Cache path with full array — strip heavy fields for the filter payload
        allCompleteEntries = allComplete.map((e) => ({
          _id: e._id,
          Company_Name: e.Company_Name,
          ...(e.companySpecificId
            ? { companySpecificId: e.companySpecificId }
            : {}),
          ...(e.segment ? { segment: e.segment } : {}),
        }));
      } else {
        allCompleteEntries = null; // fits in first page — frontend uses completelyMatched directly
      }

      return {
        // ── Meta — always at top ──────────────────────────────────────────────
        completeCount,
        partialCount,
        notMatchedCount,
        duplicatesCount,
        completeHasMore,
        partialHasMore,
        notMatchedHasMore,
        duplicatesHasMore,
        uploadSession: result.uploadSession || null,
        uploadHistory: history,
        approvedIds,
        rejectedIds,
        // ── First page of data ────────────────────────────────────────────────
        completelyMatched: allComplete.slice(0, MATCH_PAGE_SIZE),
        allCompleteEntries, // full list for filter (or null)
        partiallyMatched: partial.slice(0, MATCH_PAGE_SIZE),
        notMatched: notMatch.slice(0, MATCH_PAGE_SIZE),
        duplicates: dups.slice(0, MATCH_PAGE_SIZE),
      };
    };

    // ── Fast path: return from in-memory cache ────────────────────────────────
    const cached = getCachedMatchResult(campaignId);
    if (cached) {
      return sendResponse(
        res,
        200,
        "Client match data fetched",
        await buildPayload(cached)
      );
    }

    // ── DB path: cache miss — try new flat collection first, then old chunks ──
    // latestDocPromise already started above — loadMatchResultFromEntry runs in parallel with it.
    const dbResult = await loadMatchResultFromEntry(campaignId);
    if (dbResult) {
      console.log(
        `[getClientMatchData] Loaded from DB for campaign ${campaignId}`
      );
      if (!dbResult.tooLarge) setCachedMatchResult(campaignId, dbResult);
      return sendResponse(
        res,
        200,
        "Client match data fetched",
        await buildPayload(dbResult)
      );
    }

    // ── Slow path: nothing persisted — read saved names and re-run matching ───
    const docs = await ClientCompanyList.find({
      campaignId,
      dataType: "Client",
    })
      .sort({ updatedAt: -1 })
      .select("companyNames")
      .lean();

    if (!docs.length || !docs.some((d) => d.companyNames?.length)) {
      return sendResponse(res, 200, "No match data found", null);
    }

    const allCompanyNames = docs.flatMap((d) => d.companyNames || []);

    const seenSlowKeys = new Set();
    const slowMatchRows = [];
    const duplicates = [];
    for (const name of allCompanyNames) {
      const key = name.toLowerCase();
      if (!seenSlowKeys.has(key)) {
        seenSlowKeys.add(key);
        slowMatchRows.push({ name });
      } else duplicates.push(name);
    }

    const dbIndex = await getOrBuildDbIndex();
    const slowCompleteMap = new Map();
    const partiallyMatched = [];
    const notMatchedRows = [];
    const slowSameCompDups = [];
    const REMATCH_BATCH = 500;

    for (let i = 0; i < slowMatchRows.length; i += REMATCH_BATCH) {
      await yieldControl();
      const {
        completelyMatched: bc,
        partiallyMatched: bp,
        notMatched: bn,
        sameCompanyDuplicates: bsd,
      } = matchBatch(
        slowMatchRows.slice(i, i + REMATCH_BATCH),
        dbIndex,
        getSuggestionsLimit,
        MAX_CANDIDATES
      );
      for (const entry of bc) {
        const id = String(entry._id);
        if (slowCompleteMap.has(id)) slowSameCompDups.push(entry.matchedWith);
        else slowCompleteMap.set(id, entry);
      }
      partiallyMatched.push(...bp);
      notMatchedRows.push(...bn);
      if (bsd?.length) slowSameCompDups.push(...bsd);
    }
    const completelyMatched = [...slowCompleteMap.values()];
    const notMatched = notMatchedRows;
    const allDuplicates = [...duplicates, ...slowSameCompDups];
    const uploadSession = new Date().toISOString();

    const slowCounts = {
      completeCount: completelyMatched.length,
      partialCount: partiallyMatched.length,
      notMatchedCount: notMatched.length,
      duplicatesCount: allDuplicates.length,
    };
    const slowTooLarge = isResultTooLarge(slowCounts);

    if (!slowTooLarge) {
      setCachedMatchResult(campaignId, {
        completelyMatched,
        partiallyMatched,
        notMatched,
        duplicates: allDuplicates,
        uploadSession,
      });
    }

    // Persist to DB in background
    persistToEntryCollection(campaignId, {
      completelyMatched,
      partiallyMatched,
      notMatched,
      duplicates: allDuplicates,
      uploadSession,
      counts: slowCounts,
    }).catch((e) =>
      console.error(
        "[getClientMatchData] Background persist failed:",
        e.message
      )
    );

    if (slowTooLarge) {
      setCachedMatchResult(campaignId, {
        tooLarge: true,
        uploadSession,
        completelyMatchedCount: slowCounts.completeCount,
        partiallyMatchedCount: slowCounts.partialCount,
        notMatchedCount: slowCounts.notMatchedCount,
        duplicatesCount: slowCounts.duplicatesCount,
        uploadHistory: [],
      });
      return sendResponse(
        res,
        200,
        "Client match data fetched",
        await buildPayload({
          tooLarge: true,
          uploadSession,
          ...slowCounts,
          uploadHistory: [],
        })
      );
    }

    return sendResponse(
      res,
      200,
      "Client match data fetched",
      await buildPayload({
        completelyMatched,
        partiallyMatched,
        notMatched,
        duplicates: allDuplicates,
        uploadSession,
      })
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// PATCH: persist approve/reject action — stores { companyId, Company_Name }
// GET: fetch a specific historical upload session (read-only, no approvals)
const getClientMatchSessionData = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, uploadSession } = req.params;
    if (!campaignId || !uploadSession) {
      return sendError(next, "campaignId and uploadSession are required", 400);
    }

    // Try new flat collection first
    const entryMeta = await ClientMatchEntry.findOne({
      campaignId,
      dataType: "Client",
      uploadSession,
      matchType: "meta",
    }).lean();

    if (entryMeta) {
      const counts = entryMeta.counts || {};
      if (isResultTooLarge(counts)) {
        return sendResponse(res, 200, "Historical session fetched", {
          uploadSession,
          tooLarge: true,
          completelyMatchedCount: counts.completeCount ?? 0,
          partiallyMatchedCount: counts.partialCount ?? 0,
          notMatchedCount: counts.notMatchedCount ?? 0,
          duplicatesCount: counts.duplicatesCount ?? 0,
        });
      }

      const base = { campaignId, dataType: "Client", uploadSession };
      const PG = MATCH_PAGE_SIZE;

      // Partial: only inputName — no suggestions needed for history view.
      // ClientCompanyList fetched in parallel to resolve approved/rejected status.
      const [
        completeDocs,
        partialDocs,
        notMatchedDocs,
        duplicateDocs,
        clientList,
      ] = await Promise.all([
        ClientMatchEntry.find({ ...base, matchType: "complete" })
          .select("companyId companyName matchedWith companySpecificId segment")
          .limit(PG + 1)
          .lean(),
        ClientMatchEntry.find({ ...base, matchType: "partial" })
          .select("inputName")
          .lean(),
        ClientMatchEntry.find({ ...base, matchType: "notMatched" })
          .select("inputName")
          .limit(PG + 1)
          .lean(),
        ClientMatchEntry.find({ ...base, matchType: "duplicate" })
          .select("inputName")
          .limit(PG + 1)
          .lean(),
        ClientCompanyList.findOne({ campaignId, dataType: "Client" })
          .sort({ updatedAt: -1 })
          .select("approvedIds rejectedIds")
          .lean(),
      ]);

      // Build inputName → approved company name map and rejected set from ClientCompanyList
      const approvedByInput = new Map();
      const rejectedByInput = new Set();
      for (const e of clientList?.approvedIds || []) {
        if (e.inputName) approvedByInput.set(e.inputName, e.Company_Name || "");
      }
      for (const e of clientList?.rejectedIds || []) {
        if (e.inputName) rejectedByInput.add(e.inputName);
      }

      return sendResponse(res, 200, "Historical session fetched", {
        uploadSession,
        completelyMatched: completeDocs.slice(0, PG).map((d) => ({
          _id: d.companyId,
          Company_Name: d.companyName,
          matchedWith: d.matchedWith || d.inputName,
          ...(d.companySpecificId
            ? { companySpecificId: d.companySpecificId }
            : {}),
          ...(d.segment ? { segment: d.segment } : {}),
        })),
        completeHasMore: completeDocs.length > PG,
        // Partial history: simplified — inputName + approval status only (no suggestions)
        partiallyMatched: partialDocs.map((d) => {
          const inp = d.inputName || "";
          const approvedName = approvedByInput.get(inp);
          const isRejected = rejectedByInput.has(inp);
          return {
            inputName: inp,
            status: approvedName
              ? "approved"
              : isRejected
              ? "rejected"
              : "pending",
            approvedCompanyName: approvedName || null,
          };
        }),
        notMatched: notMatchedDocs.slice(0, PG).map((d) => d.inputName),
        notMatchedHasMore: notMatchedDocs.length > PG,
        duplicates: duplicateDocs.slice(0, PG).map((d) => d.inputName),
        duplicatesHasMore: duplicateDocs.length > PG,
      });
    }

    return sendError(next, "Session not found", 404);
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

const updateClientMatchAction = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { companyId, companyName, inputName, type, action } = req.body;
    // type: "approved" | "rejected"
    // action: "add" | "remove"
    // inputName: the uploaded company name (row identifier) so restore knows
    //            which partial row this decision belongs to

    if (!campaignId || !companyId || !type || !action) {
      return sendError(
        next,
        "campaignId, companyId, type and action are required",
        400
      );
    }

    const field = type === "approved" ? "approvedIds" : "rejectedIds";
    // Pull by both companyId AND inputName so two rows with the same DB company
    // but different input names are tracked independently.
    const pullMatch = inputName ? { companyId, inputName } : { companyId };
    const filter = { campaignId, dataType: "Client" };
    const sortOpt = { sort: { updatedAt: -1 } };

    if (action === "add") {
      // Remove any existing entry for this (companyId, inputName) pair first
      // to prevent duplicates, then push the new entry.
      await ClientCompanyList.findOneAndUpdate(
        filter,
        { $pull: { [field]: pullMatch } },
        sortOpt
      );
      await ClientCompanyList.findOneAndUpdate(
        filter,
        {
          $push: {
            [field]: {
              companyId,
              Company_Name: companyName,
              inputName: inputName || "",
            },
          },
        },
        sortOpt
      );
    } else {
      await ClientCompanyList.findOneAndUpdate(
        filter,
        { $pull: { [field]: pullMatch } },
        sortOpt
      );
    }

    const updated = await ClientCompanyList.findOne(
      filter,
      "approvedIds rejectedIds",
      sortOpt
    );
    return sendResponse(res, 200, "Action saved", {
      approvedCount: updated?.approvedIds?.length ?? 0,
      rejectedCount: updated?.rejectedIds?.length ?? 0,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

/**
 * GET /filtration/clientMatchEntries/:campaignId
 * Paginated endpoint for large match datasets.
 * Query params: matchType (complete|partial|notMatched|duplicate), uploadSession, page (0-based), limit (max 500)
 */
const getClientMatchEntries = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const {
      matchType = "complete",
      uploadSession,
      page = 0,
      limit = 100,
    } = req.query;
    if (!campaignId) return sendError(next, "Campaign ID is required", 400);

    // Resolve session: use provided or fall back to latest
    let session = uploadSession;
    if (!session) {
      const meta = await ClientMatchEntry.findOne({
        campaignId,
        dataType: "Client",
        matchType: "meta",
      })
        .sort({ uploadSession: -1 })
        .lean();
      if (!meta)
        return sendResponse(res, 200, "No data found", {
          entries: [],
          total: 0,
          hasMore: false,
        });
      session = meta.uploadSession;
    }

    const skip = parseInt(page) * Math.min(parseInt(limit), 500);
    const lim = Math.min(parseInt(limit), 500);

    const selectByType = {
      complete: "companyId companyName matchedWith companySpecificId segment",
      partial: "inputName companySpecificId segment suggestions",
      notMatched: "inputName",
      duplicate: "inputName",
    };
    const projection = selectByType[matchType] || "inputName";

    const [docs, total] = await Promise.all([
      ClientMatchEntry.find({
        campaignId,
        dataType: "Client",
        uploadSession: session,
        matchType,
      })
        .select(projection)
        .skip(skip)
        .limit(lim + 1)
        .lean(),
      ClientMatchEntry.countDocuments({
        campaignId,
        dataType: "Client",
        uploadSession: session,
        matchType,
      }),
    ]);

    const hasMore = docs.length > lim;
    const page_docs = hasMore ? docs.slice(0, lim) : docs;

    let entries;
    if (matchType === "complete") {
      entries = page_docs.map((d) => ({
        _id: d.companyId,
        Company_Name: d.companyName,
        matchedWith: d.matchedWith,
        ...(d.companySpecificId
          ? { companySpecificId: d.companySpecificId }
          : {}),
        ...(d.segment ? { segment: d.segment } : {}),
      }));
    } else if (matchType === "partial") {
      entries = page_docs.map((d) => ({
        inputName: d.inputName,
        suggestions: d.suggestions || [],
        ...(d.companySpecificId
          ? { companySpecificId: d.companySpecificId }
          : {}),
        ...(d.segment ? { segment: d.segment } : {}),
      }));
    } else {
      entries = page_docs.map((d) => d.inputName);
    }

    return sendResponse(res, 200, "Entries fetched", {
      entries,
      total,
      hasMore,
      uploadSession: session,
      page: parseInt(page),
      limit: lim,
    });
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export {
  callingDataFilter,
  callingDataFilterLightweight,
  getCampaignFiltersByCampaignId,
  getPrevCampFiltersByCampaignId,
  assignCallingDataToCampaign,
  companiesMatchedDataWithExcel,
  getMatchJobStatus,
  clientCallingDataFilter,
  assignCallingDataToCampaignClientSuggested,
  assignCallingDataToCampaignBoth,
  generateMagicLink,
  getSharedFilterStats,
  deactivateSharedLink,
  extendLinkExpiry,
  getClientMatchData,
  getClientMatchSessionData,
  updateClientMatchAction,
  getClientMatchEntries,
};
