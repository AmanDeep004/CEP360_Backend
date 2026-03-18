import CampaignFilter from "../models/CallingDataFiltrationModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import Company from "../models/MasterDBModel/companyModel.js";
import Campaign from "../models/campaignModel.js";
import errorHandler from "../utils/index.js";
import CallingData from "../models/callingDataModal.js";
import ClientCompanyList from "../models/clientCompanyList.js";
import SharedFilter from "../models/sharedFilter.js";
import XLSX from "xlsx";
import csv from "csvtojson";
import fs from "fs";
import mongoose from "mongoose";

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
  "Contact_Country", "Contact_State", "Contact_Region", "Contact_City",
  "Job_Function", "Job_Seniority", "Job_Title",
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
    if (CONTACT_ONLY_FIELDS.has(field) && Array.isArray(value) && value.length) {
      q[field] = { $in: value };
    }
  }
  for (const { field, value } of exclusions) {
    if (CONTACT_ONLY_FIELDS.has(field) && Array.isArray(value) && value.length) {
      if (q[field]) {
        q.$and = (q.$and || []).concat({ [field]: { $nin: value } });
      } else {
        q[field] = { $nin: value };
      }
    }
  }
  if (companyIds.length > 0) {
    q.Company_ID = { $in: companyIds.map((id) => new mongoose.Types.ObjectId(id)) };
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
    if (mapped && Array.isArray(value) && value.length) q[mapped] = { $in: value };
  }
  for (const { field, value } of exclusions) {
    const mapped = COMPANY_FIELD_MAP[field];
    if (mapped && Array.isArray(value) && value.length) q[mapped] = { $nin: value };
  }
  return q;
}

/** Only the fields needed for CallingData mapping — keeps cursor docs lean */
const ASSIGN_PROJECT = {
  Contact_ID: 1, Contact_Source: 1, Contact_Create_Date: 1,
  Salutation: 1, First_Name: 1, Last_Name: 1, Full_Name: 1, Gender: 1,
  Job_Title: 1, Job_Seniority: 1, Job_Function: 1,
  Contact_Address_1: 1, Contact_Address_2: 1, Contact_Address_3: 1,
  Contact_City: 1, Contact_Pin: 1, Contact_State: 1, Contact_Region: 1,
  Contact_Country: 1, Contact_STD_ISD_Code: 1, Contact_Location_Tier: 1,
  Contact_Direct_Phone1: 1, Contact_Direct_Phone2: 1, Contact_Extn_No: 1,
  Mobile_No: 1, Office_Email_1: 1, Office_Email_2: 1,
  Personal_Email1: 1, Personal_Email2: 1,
  Contact_LinkedIn_Profile: 1,
  Unsubscribe_Flag: 1, Unsubscribe_Account_Tag: 1,
  DND_Flag: 1, DND_Account_Tag: 1,
  Last_Engagement: 1, Last_Engagement_Date: 1,
  Last_Engagement_Campaign: 1, Telecalling_Remarks: 1, EngagementPoints: 1,
  "company_info._id": 1, "company_info.Company_Name": 1,
  "company_info.Company_ID_Kestone": 1, "company_info.Affinity_ID_Dell": 1,
  "company_info.Company_ID_Google": 1, "company_info.Company_Source": 1,
  "company_info.Year_Founded": 1, "company_info.Turnover_Range": 1,
  "company_info.Employees_Range": 1, "company_info.Industry": 1,
  "company_info.Sub_Industry": 1, "company_info.Company_Segment": 1,
  "company_info.Website": 1, "company_info.Company_LinkedIn_Profile": 1,
  "company_info.Company_Phone1": 1, "company_info.Company_Phone2": 1,
};

/**
 * Build the optimised assignment pipeline:
 *   $match (contact fields only)         ← uses indexes, small docs
 *   $sort (EngagementPoints, date)        ← sort BEFORE $lookup → no 32MB limit
 *   $lookup + $unwind (companies)
 *   $match (company fields, if any)
 *   $project (only needed fields)
 */
function buildAssignPipeline(preLookupMatch, postLookupMatch) {
  const pipeline = [
    { $match: preLookupMatch },
    { $sort: { EngagementPoints: -1, Last_Engagement_Date: -1 } },
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
function mapContactToEntry(row, { campaignId, uploadedBy, batchLabel, dataSourceType, source }) {
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
    Affinity_ID_Dell: row.company_info?.Affinity_ID_Dell || "",
    Company_ID_Google: row.company_info?.Company_ID_Google || "",
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
    return { inserted: unique.length, duplicates: entries.length - unique.length };
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
  const cursor = Contact.aggregate(pipeline).option({ allowDiskUse: true }).cursor();

  let chunk = [];
  let insertedCount = 0;
  let duplicateCount = 0;
  let totalProcessed = 0;

  for await (const row of cursor) {
    chunk.push(mapContactToEntry(row, opts));
    if (chunk.length >= CHUNK_SIZE) {
      const { inserted, duplicates } = await insertContactsChunk(chunk, opts.campaignId);
      insertedCount += inserted;
      duplicateCount += duplicates;
      totalProcessed += chunk.length;
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    const { inserted, duplicates } = await insertContactsChunk(chunk, opts.campaignId);
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
      ], { allowDiskUse: true }),
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

//for client suggestion apis
const companiesMatchedDataWithExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "Please upload an Excel or CSV file", 400);
    }
    const { campaignId, dataType } = req.body;

    const filePath = req.file.path;
    let companyNames = [];

    const ext = (req.file.originalname || filePath).toLowerCase();
    if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      companyNames = sheet
        .map(
          (row) =>
            row.CompanyName ||
            row.Company_Name ||
            row.company_name ||
            row.company ||
            row.companyNames ||
            null
        )
        .filter(Boolean);
    } else if (ext.endsWith(".csv")) {
      const rows = await csv().fromFile(filePath);
      companyNames = rows
        .map(
          (row) =>
            row.CompanyName ||
            row.Company_Name ||
            row.company_name ||
            row.company ||
            row.companyNames ||
            null
        )
        .filter(Boolean);
    } else {
      fs.unlinkSync(filePath);
      return sendError(
        next,
        "Unsupported file format. Upload .csv or .xlsx",
        400
      );
    }

    fs.unlinkSync(filePath);
    await ClientCompanyList.create({
      campaignId,
      dataType,
      companyNames,
    });

    if (!Array.isArray(companyNames) || companyNames.length === 0) {
      return sendError(next, "No valid company names found in the file", 400);
    }

    const regexArr = companyNames.map((name) => ({
      Company_Name: {
        $regex: name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      },
    }));

    const allMatches = await Company.find({ $or: regexArr }).lean();

    function similarity(a, b) {
      if (!a || !b) return 0;
      a = a.toLowerCase();
      b = b.toLowerCase();
      if (a === b) return 1;
      const aWords = new Set(a.split(/\s+/));
      const bWords = new Set(b.split(/\s+/));
      const intersection = new Set([...aWords].filter((x) => bWords.has(x)));
      const union = new Set([...aWords, ...bWords]);
      return intersection.size / union.size;
    }

    const completelyMatched = [];
    const partiallyMatched = [];

    for (const inputName of companyNames) {
      const matches = allMatches.filter(
        (c) =>
          c.Company_Name &&
          c.Company_Name.toLowerCase().includes(inputName.toLowerCase())
      );

      const exact = matches.find(
        (c) =>
          c.Company_Name &&
          c.Company_Name.trim().toLowerCase() === inputName.trim().toLowerCase()
      );

      if (exact) {
        completelyMatched.push({
          _id: exact._id,
          Company_Name: exact.Company_Name,
          matchedWith: inputName,
        });
        continue;
      }

      const partials = matches
        .map((c) => ({
          _id: c._id,
          Company_Name: c.Company_Name,
          matchedWith: inputName,
          matchPercent: Math.round(similarity(inputName, c.Company_Name) * 100),
        }))
        .filter((obj) => obj.matchPercent > 0);

      if (partials.length > 0) {
        partials.sort((a, b) => b.matchPercent - a.matchPercent);
        partiallyMatched.push({
          input: inputName,
          suggestions: partials,
        });
      }
    }

    return sendResponse(res, 200, "Company name match results", {
      completelyMatched,
      partiallyMatched,
    });
  } catch (err) {
    console.error("Error in companiesMatchedDataWithExcel:", err);
    return sendError(next, err.message || "Failed to match companies", 500);
  }
});

//filter for client calling data
const clientCallingDataFilter = asyncHandler(async (req, res, next) => {
  try {
    const {
      campaignId,
      filters = [],
      exclusions = [],
      datatype = datatype || "Client",
      companyIds = [],
    } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }
    if (!datatype) {
      return sendError(next, "Data Type is required", 400);
    }

    // const fieldMapping = {
    //   Contact_Country: "Contact_Country",
    //   Contact_Region: "Contact_Region",
    //   Job_Function: "Job_Function",
    //   Job_Seniority: "Job_Seniority",
    //   Industry: "company_info.Industry",
    //   Employees_Range: "company_info.Employees_Range",
    // };
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

    const companyIdFilter =
      Array.isArray(companyIds) && companyIds.length > 0
        ? {
            Company_ID: {
              $in: companyIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
          }
        : {};

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
          ...companyIdFilter,
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

    // Parallel query for unique companies
    const [statsResult, uniqueCompaniesCount] = await Promise.all([
      Contact.aggregate(statsPipeline, { allowDiskUse: true }),
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
            ...companyIdFilter,
          },
        },
        { $group: { _id: "$Company_ID" } },
        { $count: "uniqueCompanies" },
      ], { allowDiskUse: true }),
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
      misc: { companyIdsUsed: companyIds },
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

    const preLookup = buildPreLookupMatch(lastFilter.filters || [], lastFilter.exclusions || []);
    const postLookup = buildPostLookupMatch(lastFilter.filters || [], lastFilter.exclusions || []);
    const pipeline = buildAssignPipeline(preLookup, postLookup);

    const { totalProcessed, insertedCount, duplicateCount } = await streamInsertContacts(pipeline, {
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
      return sendResponse(res, 200, "All contacts already exist in this campaign. No new data added.", {
        contacts: totalProcessed,
        campaignId,
        insertedCount: 0,
        duplicateCount,
        uniqueCount: 0,
        batchNumber,
        batchLabel,
      });
    }

    await Campaign.findByIdAndUpdate(
      { _id: campaignId },
      {
        isCallingDataAssigned: true,
        $push: { filterBatches: { filterBatchId: new mongoose.Types.ObjectId(lastFilter._id) } },
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
      message: duplicateCount > 0
        ? `${duplicateCount} duplicate contacts skipped. ${insertedCount} new contacts added.`
        : "All new contacts inserted successfully.",
    });
  } catch (err) {
    console.error("Error assigning calling data to campaign:", err);
    return sendError(next, err.message || "Failed to assign calling data to campaign", 500);
  }
});

//assign  calling data filtration(Client masterdatabase)
const assignCallingDataToCampaignClientSuggested = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, uploadedBy, dataSourceType = "Client" } = req.body;
    if (!campaignId || !uploadedBy) {
      return sendError(next, "Required fields missing", 400);
    }

    const lastFilter = await CampaignFilter.findOne({ campaignId, dataType: "Client" })
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
    const preLookup = buildPreLookupMatch(lastFilter.filters || [], lastFilter.exclusions || [], companyIds);
    const postLookup = buildPostLookupMatch(lastFilter.filters || [], lastFilter.exclusions || []);
    const pipeline = buildAssignPipeline(preLookup, postLookup);

    const { totalProcessed, insertedCount, duplicateCount } = await streamInsertContacts(pipeline, {
      campaignId,
      uploadedBy,
      batchLabel,
      dataSourceType,
      source: "ClientSuggested",
    });

    if (totalProcessed === 0) {
      return sendError(next, "No contacts found for this filter", 404);
    }

    if (insertedCount === 0) {
      return sendResponse(res, 200, "All contacts already exist in this campaign. No new data added.", {
        contacts: totalProcessed,
        campaignId,
        insertedCount: 0,
        duplicateCount,
        uniqueCount: 0,
        batchNumber,
        batchLabel,
      });
    }

    await Campaign.findByIdAndUpdate(
      { _id: campaignId },
      {
        isCallingDataAssigned: true,
        $push: { filterBatches: { filterBatchId: new mongoose.Types.ObjectId(lastFilter._id) } },
      },
      { new: true }
    );

    return sendResponse(res, 200, "Client-suggested calling data processed successfully", {
      contacts: totalProcessed,
      campaignId,
      insertedCount,
      duplicateCount,
      uniqueCount: insertedCount,
      batchNumber,
      batchLabel,
      message: duplicateCount > 0
        ? `${duplicateCount} duplicate contacts skipped. ${insertedCount} new contacts added.`
        : "All new contacts inserted successfully.",
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to assign client-suggested calling data", 500);
  }
});
//assign calling data for both filter (client + kestone)
const assignCallingDataToCampaignBoth = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, uploadedBy } = req.body;
    if (!campaignId || !uploadedBy) {
      return sendError(next, "Campaign Id / UploadedBy missing", 400);
    }

    const bothFilter = await CampaignFilter.findOne({ campaignId, dataType: "Both" }).lean();
    if (!bothFilter) return sendError(next, "Both filter not found for this campaign", 404);

    const kestoneFilter = await CampaignFilter.findOne({ campaignId, dataType: "Kestone" })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();
    if (!kestoneFilter) return sendError(next, "No Kestone filter found for this campaign", 404);

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);

    const batchNumber = (campaign.filterBatches?.length || 0) + 1;
    const batchLabel = `Batch-${batchNumber}`;

    // ── Extract client filters from bothFilter ──
    const clientFilters = bothFilter.filterSources
      ? bothFilter.filters
          .map((f) => {
            const src = bothFilter.filterSources.find((s) => s.field === f.field);
            if (!src) return null;
            const vals = src.sources.filter((s) => s.source === "Client").map((s) => s.value);
            return vals.length ? { field: f.field, value: vals } : null;
          })
          .filter(Boolean)
      : bothFilter.filters;

    // ── Build pipelines ──
    const kestonePipeline = buildAssignPipeline(
      buildPreLookupMatch(kestoneFilter.filters || [], kestoneFilter.exclusions || []),
      buildPostLookupMatch(kestoneFilter.filters || [], kestoneFilter.exclusions || [])
    );
    const clientPipeline = buildAssignPipeline(
      buildPreLookupMatch(clientFilters, []),
      buildPostLookupMatch(clientFilters, [])
    );

    // ── Client contacts inserted first → they take precedence over Kestone ──
    // When Kestone streams, per-chunk dedup will skip contacts already inserted by Client.
    const clientResult = await streamInsertContacts(clientPipeline, {
      campaignId, uploadedBy, batchLabel, dataSourceType: "Client", source: "Both",
    });

    const kestoneResult = await streamInsertContacts(kestonePipeline, {
      campaignId, uploadedBy, batchLabel, dataSourceType: "Kestone", source: "Both",
    });

    const totalProcessed = clientResult.totalProcessed + kestoneResult.totalProcessed;
    const insertedCount = clientResult.insertedCount + kestoneResult.insertedCount;
    const duplicateCount = clientResult.duplicateCount + kestoneResult.duplicateCount;

    if (totalProcessed === 0) {
      return sendError(next, "No contacts found for Both filter", 404);
    }

    if (insertedCount === 0) {
      return sendResponse(res, 200, "All contacts already exist. No new data added.", {
        campaignId, insertedCount: 0, duplicateCount, uniqueCount: 0, batchNumber, batchLabel,
      });
    }

    await Campaign.findByIdAndUpdate(
      { _id: campaignId },
      {
        isCallingDataAssigned: true,
        $push: { filterBatches: { filterBatchId: new mongoose.Types.ObjectId(bothFilter._id) } },
      }
    );

    return sendResponse(res, 200, "Both-filter calling data processed successfully", {
      campaignId,
      insertedCount,
      duplicateCount,
      uniqueCount: insertedCount,
      batchNumber,
      batchLabel,
      message: duplicateCount > 0
        ? `${duplicateCount} duplicate contacts skipped. ${insertedCount} new contacts added.`
        : "All new contacts inserted successfully.",
    });
  } catch (err) {
    return sendError(next, err.message || "Failed to assign calling data with Both filter", 500);
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

export {
  callingDataFilter,
  callingDataFilterLightweight,
  getCampaignFiltersByCampaignId,
  getPrevCampFiltersByCampaignId,
  assignCallingDataToCampaign,
  companiesMatchedDataWithExcel,
  clientCallingDataFilter,
  assignCallingDataToCampaignClientSuggested,
  assignCallingDataToCampaignBoth,
  generateMagicLink,
  getSharedFilterStats,
  deactivateSharedLink,
  extendLinkExpiry,
};
