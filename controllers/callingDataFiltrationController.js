import CampaignFilter from "../models/CallingDataFiltrationModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import Company from "../models/MasterDBModel/companyModel.js";
import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import CallingData from "../models/callingDataModal.js";
import ClientCompanyList from "../models/clientCompanyList.js";
import ClientMatchResult from "../models/clientMatchResultModel.js";
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
  { campaignId, uploadedBy, batchLabel, dataSourceType, source, companyMetaMap = {} }
) {
  const companyIdStr = row.company_info?._id ? String(row.company_info._id) : "";
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
      segment:           meta.segment           || "",
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
      .sort({
        revisionNo: 1,
        createdAt: 1,
      })
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
  const dbExactMap = new Map(); // raw lowercase name → company (for complete match)
  const dbNormMap  = new Map(); // normalized name → company (for partial match)
  const invertedIndex = new Map();
  for (const c of allDbCompanies) {
    const raw = (c.Company_Name || "").trim().toLowerCase();
    if (raw && !dbExactMap.has(raw)) {
      dbExactMap.set(raw, { _id: c._id, Company_Name: c.Company_Name });
    }
    const norm = normalizeCompanyName(c.Company_Name || "");
    if (!norm) continue;
    if (!dbNormMap.has(norm)) {
      dbNormMap.set(norm, {
        _id: c._id,
        Company_Name: c.Company_Name,
        simpleName: simplifyName(c.Company_Name),
      });
    }
    for (const word of norm.split(/\s+/).filter((w) => w.length > 2)) {
      if (!invertedIndex.has(word)) invertedIndex.set(word, new Set());
      invertedIndex.get(word).add(norm);
    }
  }
  _dbIndexCache = { dbExactMap, dbNormMap, invertedIndex };
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
  _matchResultCache.delete(String(campaignId));
  // Also wipe the DB so stale persisted results don't outlive a new upload
  ClientMatchResult.deleteMany({ campaignId, dataType: "Client" }).catch((e) =>
    console.warn("[MatchResult] Failed to invalidate DB cache:", e.message)
  );
};

// ── Persistent DB helpers (survive server restarts) ───────────────────────────

// Chunk sizes chosen to stay comfortably under MongoDB's 16 MB document limit.
const COMPLETE_CHUNK   = 2000; // ~100 bytes each → ~200 KB per chunk
const PARTIAL_CHUNK    =  300; // ~200–500 bytes each (suggestions) → ~150 KB per chunk
const NOT_MATCHED_CHUNK = 5000; // plain strings → ~150 KB per chunk

/**
 * Persist match results to MongoDB in chunks.
 * Runs fire-and-forget so it never delays the HTTP response.
 */
const persistMatchResultToDb = async (campaignId, { completelyMatched, partiallyMatched, notMatched, duplicates = [] }) => {
  try {
    // Wipe stale results for this campaign first
    await ClientMatchResult.deleteMany({ campaignId, dataType: "Client" });

    const chunks = [];

    for (let i = 0; i < completelyMatched.length; i += COMPLETE_CHUNK) {
      chunks.push({ campaignId, dataType: "Client", chunkType: "complete", chunkIndex: Math.floor(i / COMPLETE_CHUNK), data: completelyMatched.slice(i, i + COMPLETE_CHUNK) });
    }
    for (let i = 0; i < partiallyMatched.length; i += PARTIAL_CHUNK) {
      chunks.push({ campaignId, dataType: "Client", chunkType: "partial", chunkIndex: Math.floor(i / PARTIAL_CHUNK), data: partiallyMatched.slice(i, i + PARTIAL_CHUNK) });
    }
    for (let i = 0; i < notMatched.length; i += NOT_MATCHED_CHUNK) {
      chunks.push({ campaignId, dataType: "Client", chunkType: "notMatched", chunkIndex: Math.floor(i / NOT_MATCHED_CHUNK), data: notMatched.slice(i, i + NOT_MATCHED_CHUNK) });
    }
    if (duplicates.length > 0) {
      chunks.push({ campaignId, dataType: "Client", chunkType: "duplicates", chunkIndex: 0, data: duplicates });
    }

    if (chunks.length > 0) {
      await ClientMatchResult.insertMany(chunks, { ordered: false });
    }
    console.log(`[MatchResult] Persisted ${chunks.length} chunks for campaign ${campaignId}`);
  } catch (err) {
    console.error("[MatchResult] Failed to persist to DB:", err.message);
  }
};

/**
 * Load match results from MongoDB (used when in-memory cache is cold).
 * Returns null if nothing is persisted yet.
 */
const loadMatchResultFromDb = async (campaignId) => {
  const [completeDocs, partialDocs, notMatchedDocs, duplicateDocs] = await Promise.all([
    ClientMatchResult.find({ campaignId, dataType: "Client", chunkType: "complete" })
      .sort({ chunkIndex: 1 }).select("data").lean(),
    ClientMatchResult.find({ campaignId, dataType: "Client", chunkType: "partial" })
      .sort({ chunkIndex: 1 }).select("data").lean(),
    ClientMatchResult.find({ campaignId, dataType: "Client", chunkType: "notMatched" })
      .sort({ chunkIndex: 1 }).select("data").lean(),
    ClientMatchResult.find({ campaignId, dataType: "Client", chunkType: "duplicates" })
      .sort({ chunkIndex: 1 }).select("data").lean(),
  ]);

  if (!completeDocs.length && !partialDocs.length && !notMatchedDocs.length) return null;

  return {
    completelyMatched: completeDocs.flatMap((d) => d.data),
    partiallyMatched:  partialDocs.flatMap((d) => d.data),
    notMatched:        notMatchedDocs.flatMap((d) => d.data),
    duplicates:        duplicateDocs.flatMap((d) => d.data),
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
// Returns the max suggestions to include per partial-match entry.
// Scales inversely with dataset size to keep total response under ~25MB.
// Budget formula: assumes worst-case 50% partial matches, ~100 bytes/suggestion.
// suggestionsLimit = 500_000 / totalNames  (min 10, max MAX_CANDIDATES)
const getSuggestionsLimit = (totalNames) =>
  Math.min(MAX_CANDIDATES, Math.max(10, Math.floor(500_000 / totalNames)));

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
      const name = pickVal(row, ["CompanyName", "Company_Name", "company_name", "company", "companyNames"]);
      if (!name) return null;
      return {
        name,
        companySpecificId: pickVal(row, ["CompanySpecificId", "Company_Specific_Id", "company_specific_id", "companyspecificid", "SpecificId", "Specific_Id"]),
        segment:           pickVal(row, ["Segment", "segment", "Segment_Name", "SegmentName", "segment_name"]),
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
      const workbook = XLSX.readFile(filePath, { cellText: true, cellDates: false });
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      companyRows = filterAndCount(sheet.map(parseRow));
    } else {
      const rows = await csv().fromFile(filePath);
      companyRows = filterAndCount(rows.map(parseRow));
    }
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }

  if (!companyRows.length) {
    failMatchJob(jobId, "No valid company names found in the file");
    return;
  }

  // Flat names array (for backward-compat with ClientCompanyList + progress messages)
  const companyNames = companyRows.map((r) => r.name);

  // Deduplicate: first occurrence of each name → matchRows; extras → duplicates.
  // e.g. "ABC Corp" × 3  →  1 in matchRows, 2 in duplicates.
  const seenNameKeys = new Set();
  const matchRows  = [];
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
  const matchNames = matchRows.map((r) => r.name);

  updateMatchJob(
    jobId,
    `Parsed ${companyNames.length.toLocaleString()} companies. Scanning database...`,
    8
  );
  await yieldControl();

  // Stage 2 — load DB index (shared cache, rebuilt every 30 min)
  const { dbExactMap, dbNormMap, invertedIndex } = await getOrBuildDbIndex();

  updateMatchJob(
    jobId,
    `Index ready. Matching ${companyNames.length.toLocaleString()} companies...`,
    20
  );
  await yieldControl();

  // Stage 3 — batch match with inverted index + bidirectional containment
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(matchRows.length / BATCH_SIZE);
  const completelyMatched = [];
  const partiallyMatched = [];
  const matchedInputSet = new Set();    // tracks matched input names (lowercase)

  for (let b = 0; b < totalBatches; b++) {
    const batch = matchRows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const done = Math.min((b + 1) * BATCH_SIZE, matchRows.length);
    const percent = 20 + Math.round((b / totalBatches) * 70);
    updateMatchJob(
      jobId,
      `Matching companies... ${done.toLocaleString()} / ${companyRows.length.toLocaleString()}`,
      percent
    );
    await yieldControl();

    for (const { name: inputName, companySpecificId, segment } of batch) {
      const inputKey = inputName.toLowerCase();

      // 1. Exact match — raw case-insensitive, no normalization (checked first,
      //    before normInput so names like "Ltd & Co" still get an exact match)
      if (dbExactMap.has(inputKey)) {
        const c = dbExactMap.get(inputKey);
        completelyMatched.push({
          _id: c._id,
          Company_Name: c.Company_Name,
          matchedWith: inputName,
          ...(companySpecificId ? { companySpecificId } : {}),
          ...(segment          ? { segment }          : {}),
        });
        matchedInputSet.add(inputKey);
        continue;
      }

      // Partial match needs a normalized form — skip if normalization yields nothing
      const normInput = normalizeCompanyName(inputName);
      if (!normInput) continue;

      // 2. Get candidate DB companies sharing at least one word with the input
      //    Sort by ascending index frequency so rare/specific words (e.g. "assam")
      //    are processed before common words (e.g. "the", "bank") — ensures the
      //    MAX_CANDIDATES cap doesn't cut off the correct DB entry prematurely.
      const inputWords = normInput.split(/\s+/).filter((w) => w.length > 2);
      inputWords.sort(
        (a, b) =>
          (invertedIndex.get(a)?.size || 0) - (invertedIndex.get(b)?.size || 0)
      );
      const candidateNorms = new Set();
      outer: for (const w of inputWords) {
        for (const cn of invertedIndex.get(w) || []) {
          candidateNorms.add(cn);
          if (candidateNorms.size >= MAX_CANDIDATES) break outer;
        }
      }

      // 3. Score all candidates — containment and Jaccard both go to partiallyMatched
      const simpleInput = simplifyName(inputName);
      const scored = [];

      for (const cNorm of candidateNorms) {
        const c = dbNormMap.get(cNorm);
        if (!c) continue;

        let score = 0;

        // Check A: normalized containment (stopwords stripped from both sides)
        if (normInput.includes(cNorm) || cNorm.includes(normInput)) {
          const aLen = inputWords.length;
          const bLen =
            cNorm.split(/\s+/).filter((w) => w.length > 2).length || 1;
          score = Math.min(aLen, bLen) / Math.max(aLen, bLen, 1);
        } else {
          // Check B: Jaccard word-overlap on normalized tokens
          const aWords = new Set(inputWords);
          const bWords = new Set(
            cNorm.split(/\s+/).filter((w) => w.length > 2)
          );
          const inter = [...aWords].filter((w) => bWords.has(w)).length;
          const unionSize = new Set([...aWords, ...bWords]).size;
          score = unionSize > 0 ? inter / unionSize : 0;
        }

        // Check C: simple toLower containment (no stopword stripping).
        // Catches cases where stopword removal hides meaningful words
        // e.g. "co" stripped from "co-operative" breaks normalized containment.
        if (score < 0.3) {
          const simpleDb = c.simpleName;
          if (
            simpleDb.includes(simpleInput) ||
            simpleInput.includes(simpleDb)
          ) {
            const aLen = simpleInput.split(/\s+/).length;
            const bLen = simpleDb.split(/\s+/).length || 1;
            score = Math.max(
              score,
              Math.min(aLen, bLen) / Math.max(aLen, bLen, 1)
            );
          }
        }

        if (score >= 0.3) {
          scored.push({
            _id: c._id,
            Company_Name: c.Company_Name,
            matchPercent: Math.round(score * 100),
          });
        }
      }

      if (scored.length > 0) {
        scored.sort((a, b) => b.matchPercent - a.matchPercent);
        partiallyMatched.push({
          input: inputName,
          suggestions: scored.slice(0, getSuggestionsLimit(matchRows.length)),
          ...(companySpecificId ? { companySpecificId } : {}),
          ...(segment          ? { segment }          : {}),
        });
        matchedInputSet.add(inputKey);
      }
    }
  }

  const notMatched = [
    ...matchNames.filter((name) => !matchedInputSet.has(name.toLowerCase())),
    // Rows that had no company name in the uploaded file — can't be matched
    ...Array.from({ length: invalidRowCount }, () => "(No Company Name)"),
  ];

  // Stage 4 — save in chunks to stay within MongoDB's 16MB document limit
  // insertMany sends all chunks in one round-trip instead of 50 sequential creates
  updateMatchJob(jobId, "Saving results...", 93);
  await yieldControl();

  const SAVE_CHUNK = 10_000;
  const chunks = [];
  for (let i = 0; i < companyNames.length; i += SAVE_CHUNK) {
    chunks.push({
      campaignId,
      dataType,
      companyNames: companyNames.slice(i, i + SAVE_CHUNK),
    });
  }
  await ClientCompanyList.deleteMany({ campaignId, dataType });
  await ClientCompanyList.insertMany(chunks, { ordered: false });

  // Cache results in memory so getClientMatchData returns instantly on next call
  setCachedMatchResult(campaignId, { completelyMatched, partiallyMatched, notMatched, duplicates });

  // Persist to DB in the background — survives server restarts so cache misses
  // load from DB instead of re-running the full algorithm (which can take minutes).
  persistMatchResultToDb(campaignId, { completelyMatched, partiallyMatched, notMatched, duplicates });

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
      datatype = datatype || "Client",
      companyIds = [],
      companyMetaMap = {},
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

    const lastFilter = await CampaignFilter.findOne({ campaignId }).sort({
      revisionNo: -1,
    });

    let revisionNo = 1;
    let listName = "List1";
    if (lastFilter) {
      revisionNo = lastFilter.revisionNo + 1;
      listName = `List${revisionNo}`;
    }

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
      misc: { companyIdsUsed: companyIds, companyNamesUsed, companyMetaMap },
    });

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
      const { campaignId, uploadedBy, dataSourceType = "Client" } = req.body;
      if (!campaignId || !uploadedBy) {
        return sendError(next, "Required fields missing", 400);
      }

      const lastFilter = await CampaignFilter.findOne({
        campaignId,
        dataType: "Client",
      })
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

    // Always fetch the latest doc for approvedIds/rejectedIds (updated independently)
    const latestDoc = await ClientCompanyList.findOne({
      campaignId,
      dataType: "Client",
    })
      .sort({ updatedAt: -1 })
      .select("approvedIds rejectedIds")
      .lean();

    const approvedIds = (latestDoc?.approvedIds || []).map((e) => ({
      _id: String(e.companyId),
      Company_Name: e.Company_Name,
    }));
    const rejectedIds = (latestDoc?.rejectedIds || []).map((e) => ({
      _id: String(e.companyId),
      Company_Name: e.Company_Name,
    }));

    // ── Fast path: return from in-memory cache ────────────────────────────────
    const cached = getCachedMatchResult(campaignId);
    if (cached) {
      try {
        return sendResponse(res, 200, "Client match data fetched", {
          completelyMatched: cached.completelyMatched,
          partiallyMatched: cached.partiallyMatched,
          notMatched: cached.notMatched,
          duplicates: cached.duplicates || [],
          approvedIds,
          rejectedIds,
        });
      } catch (serializeErr) {
        console.error("[getClientMatchData] Cache response serialization failed:", serializeErr.message);
        return res.status(200).json({
          success: false,
          message: "Match data is too large to send in one response. Please re-upload a smaller file or contact support.",
          data: {
            completelyMatchedCount: cached.completelyMatched.length,
            partiallyMatchedCount:  cached.partiallyMatched.length,
            notMatchedCount:        cached.notMatched.length,
            approvedIds,
            rejectedIds,
            tooLarge: true,
          },
        });
      }
    }

    // ── DB path: cache miss — try loading persisted results before re-matching ──
    const dbResult = await loadMatchResultFromDb(campaignId);
    if (dbResult) {
      console.log(`[getClientMatchData] Loaded from DB for campaign ${campaignId}`);
      setCachedMatchResult(campaignId, dbResult); // warm the memory cache
      try {
        return sendResponse(res, 200, "Client match data fetched", {
          ...dbResult,
          duplicates: dbResult.duplicates || [],
          approvedIds,
          rejectedIds,
        });
      } catch (serializeErr) {
        console.error("[getClientMatchData] DB response serialization failed:", serializeErr.message);
        return res.status(200).json({
          success: false,
          message: "Match data is too large to send in one response. Please re-upload a smaller file or contact support.",
          data: {
            completelyMatchedCount: dbResult.completelyMatched.length,
            partiallyMatchedCount:  dbResult.partiallyMatched.length,
            notMatchedCount:        dbResult.notMatched.length,
            approvedIds,
            rejectedIds,
            tooLarge: true,
          },
        });
      }
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

    const companyNames = docs.flatMap((d) => d.companyNames || []);

    // Use shared DB index cache — avoids reloading 3.7 lakh companies every time
    const { dbNormMap, invertedIndex } = await getOrBuildDbIndex();

    const completelyMatched = [];
    const partiallyMatched = [];
    const matchedInputSet = new Set();
    const matchedCompanyIdSet = new Set(); // prevents same DB company appearing twice

    // Process in batches with yieldControl so the event loop isn't blocked
    // during large cache-miss re-matches
    const REMATCH_BATCH = 500;
    for (let batchStart = 0; batchStart < companyNames.length; batchStart += REMATCH_BATCH) {
      await yieldControl();
    const batch = companyNames.slice(batchStart, batchStart + REMATCH_BATCH);
    for (const inputName of batch) {
      const normInput = normalizeCompanyName(inputName);
      if (!normInput) continue;
      const inputKey = inputName.toLowerCase();

      if (dbNormMap.has(normInput)) {
        const c = dbNormMap.get(normInput);
        const cIdStr = String(c._id);
        if (!matchedCompanyIdSet.has(cIdStr)) {
          matchedCompanyIdSet.add(cIdStr);
          completelyMatched.push({
            _id: c._id,
            Company_Name: c.Company_Name,
            matchedWith: inputName,
          });
        }
        matchedInputSet.add(inputKey);
        continue;
      }

      const inputWords = normInput.split(/\s+/).filter((w) => w.length > 2);
      // Sort rarest words first so specific words are processed before common
      // ones hit the MAX_CANDIDATES cap
      inputWords.sort(
        (a, b) =>
          (invertedIndex.get(a)?.size || 0) - (invertedIndex.get(b)?.size || 0)
      );
      const candidateNorms = new Set();
      outer2: for (const w of inputWords) {
        for (const cn of invertedIndex.get(w) || []) {
          candidateNorms.add(cn);
          if (candidateNorms.size >= MAX_CANDIDATES) break outer2;
        }
      }

      const simpleInput = simplifyName(inputName);
      const scored = [];
      for (const cNorm of candidateNorms) {
        const c = dbNormMap.get(cNorm);
        if (!c) continue;

        let score = 0;

        // Check A: normalized containment
        if (normInput.includes(cNorm) || cNorm.includes(normInput)) {
          const aLen = inputWords.length;
          const bLen =
            cNorm.split(/\s+/).filter((w) => w.length > 2).length || 1;
          score = Math.min(aLen, bLen) / Math.max(aLen, bLen, 1);
        } else {
          // Check B: Jaccard on normalized tokens
          const aWords = new Set(inputWords);
          const bWords = new Set(
            cNorm.split(/\s+/).filter((w) => w.length > 2)
          );
          const inter = [...aWords].filter((w) => bWords.has(w)).length;
          const unionSize = new Set([...aWords, ...bWords]).size;
          score = unionSize > 0 ? inter / unionSize : 0;
        }

        // Check C: simple toLower containment — preserves words stripped by normalization
        if (score < 0.3) {
          const simpleDb = c.simpleName;
          if (
            simpleDb.includes(simpleInput) ||
            simpleInput.includes(simpleDb)
          ) {
            const aLen = simpleInput.split(/\s+/).length;
            const bLen = simpleDb.split(/\s+/).length || 1;
            score = Math.max(
              score,
              Math.min(aLen, bLen) / Math.max(aLen, bLen, 1)
            );
          }
        }

        if (score >= 0.3) {
          scored.push({
            _id: c._id,
            Company_Name: c.Company_Name,
            matchPercent: Math.round(score * 100),
          });
        }
      }

      if (scored.length > 0) {
        scored.sort((a, b) => b.matchPercent - a.matchPercent);
        partiallyMatched.push({ input: inputName, suggestions: scored.slice(0, getSuggestionsLimit(companyNames.length)) });
        matchedInputSet.add(inputKey);
      }
    } // end inner batch loop
    } // end outer batch loop

    const notMatched = companyNames.filter(
      (name) => !matchedInputSet.has(name.toLowerCase())
    );

    // Populate in-memory cache and persist to DB so future cold starts skip re-matching
    setCachedMatchResult(campaignId, { completelyMatched, partiallyMatched, notMatched });
    persistMatchResultToDb(campaignId, { completelyMatched, partiallyMatched, notMatched });

    try {
      return sendResponse(res, 200, "Client match data fetched", {
        completelyMatched,
        partiallyMatched,
        notMatched,
        approvedIds,
        rejectedIds,
      });
    } catch (serializeErr) {
      // Response payload too large to serialize (e.g. "Invalid string length").
      // Return summary counts so the frontend can still show progress.
      console.error("[getClientMatchData] Response serialization failed:", serializeErr.message);
      return res.status(200).json({
        success: false,
        message: "Match data is too large to send in one response. Please re-upload a smaller file or contact support.",
        data: {
          completelyMatchedCount: completelyMatched.length,
          partiallyMatchedCount:  partiallyMatched.length,
          notMatchedCount:        notMatched.length,
          approvedIds,
          rejectedIds,
          tooLarge: true,
        },
      });
    }
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

// PATCH: persist approve/reject action — stores { companyId, Company_Name }
const updateClientMatchAction = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { companyId, companyName, type, action } = req.body;
    // type: "approved" | "rejected"
    // action: "add" | "remove"

    if (!campaignId || !companyId || !type || !action) {
      return sendError(
        next,
        "campaignId, companyId, type and action are required",
        400
      );
    }

    const field = type === "approved" ? "approvedIds" : "rejectedIds";
    const filter = { campaignId, dataType: "Client" };
    const sortOpt = { sort: { updatedAt: -1 } };

    if (action === "add") {
      // Remove any existing entry for this companyId first (prevents duplicates),
      // then push the new entry with the company name included.
      await ClientCompanyList.findOneAndUpdate(
        filter,
        { $pull: { [field]: { companyId } } },
        sortOpt
      );
      await ClientCompanyList.findOneAndUpdate(
        filter,
        { $push: { [field]: { companyId, Company_Name: companyName } } },
        sortOpt
      );
    } else {
      await ClientCompanyList.findOneAndUpdate(
        filter,
        { $pull: { [field]: { companyId } } },
        sortOpt
      );
    }

    const updated = await ClientCompanyList.findOne(filter, "approvedIds rejectedIds", sortOpt);
    return sendResponse(res, 200, "Action saved", {
      approvedCount: updated?.approvedIds?.length ?? 0,
      rejectedCount: updated?.rejectedIds?.length ?? 0,
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
  updateClientMatchAction,
};
