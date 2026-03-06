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
        { $match: { "discrepencyInData.status": { $ne: true }, ...includeQuery, ...excludeQuery } },
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
          $unwind: {
            path: "$company_info",
            preserveNullAndEmptyArrays: true,
          },
        },
        { $match: { "discrepencyInData.status": { $ne: true }, ...includeQuery, ...excludeQuery } },
        { $group: { _id: "$Company_ID" } },
        { $count: "uniqueCompanies" },
      ]),
    ]);

    const stats = statsResult[0] || { crossTabData: [], totalContacts: 0 };
    const uniqueCompanies = uniqueCompaniesCount[0]?.uniqueCompanies || 0;

    const crossTabData = stats.crossTabData || [];

    // ================= BUILD TABLE =================
    const industries = [...new Set(crossTabData.map((i) => i.industry))].sort();

    const seniorities = [...new Set(crossTabData.map((i) => i.seniority))].sort();

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
            ...companyIdFilter,
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
    const { campaignId, uploadedBy, batch, dataSourceType } = req.body;
    if (!campaignId || !uploadedBy) {
      return sendError(next, "Required fields missing", 400);
    }

    // Fetch last filter for this campaign
    const lastFilter = await CampaignFilter.findOne({ campaignId })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();

    if (!lastFilter) {
      return sendError(next, "No campaign filter found for this campaign", 404);
    }

    // Fetch campaign
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    // Batch label
    const existingBatchCount = campaign.filterBatches?.length || 0;
    const batchNumber = existingBatchCount + 1;
    const batchLabel = `Batch-${batchNumber}`;

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

    const includeQuery = buildMongoQuery(lastFilter.filters || [], "$in");
    const excludeQuery = buildMongoQuery(lastFilter.exclusions || [], "$nin");

    // Get contacts from Master DB
    const contacts = await Contact.aggregate([
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
      { $match: { "discrepencyInData.status": { $ne: true }, ...includeQuery, ...excludeQuery } },
      {
        $sort: {
          EngagementPoints: -1, // Higher points first
          Last_Engagement_Date: -1, // Latest engagement first (tie breaker)
        },
      },
    ]);

    if (!contacts.length) {
      return sendError(next, "No contacts found for this filter", 404);
    }

    // Prepare CallingData entries
    const callingDataEntries = contacts.map((row) => ({
      CampaignId: new mongoose.Types.ObjectId(campaignId),
      UploadedBy: new mongoose.Types.ObjectId(uploadedBy),
      source: "MasterDB",
      batch: batchLabel,
      dataSourceType: dataSourceType || "Kestone",

      // Contact Details
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

      // Company
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
      Company_LinkedIn_Profile:
        row.company_info?.Company_LinkedIn_Profile || "",
      Company_Phone1: row.company_info?.Company_Phone1 || "",
      Company_Phone2: row.company_info?.Company_Phone2 || "",
      Last_Engagement_Date: row.Last_Engagement_Date || "",
      EngagementPoints: row.EngagementPoints,
    }));

    // Detect duplicates
    const existingContactIds = await CallingData.find(
      {
        CampaignId: campaignId,
        Contact_ID: { $in: callingDataEntries.map((e) => e.Contact_ID) },
      },
      { Contact_ID: 1 }
    ).lean();

    const existingIds = new Set(existingContactIds.map((e) => e.Contact_ID));

    const uniqueCallingDataEntries = callingDataEntries.filter(
      (entry) => !existingIds.has(entry.Contact_ID)
    );

    const duplicateCount =
      callingDataEntries.length - uniqueCallingDataEntries.length;

    // If all contacts are duplicates → still success
    if (uniqueCallingDataEntries.length === 0) {
      return sendResponse(
        res,
        200,
        "All contacts already exist in this campaign. No new data added.",
        {
          contacts: contacts.length,
          campaignId,
          insertedCount: 0,
          duplicateCount,
          uniqueCount: 0,
          batchNumber,
          batchLabel,
        }
      );
    }

    // Insert unique entries
    const batchSize = 1000;
    let insertedCount = 0;

    for (let i = 0; i < uniqueCallingDataEntries.length; i += batchSize) {
      const batch = uniqueCallingDataEntries.slice(i, i + batchSize);

      try {
        await CallingData.insertMany(batch, { ordered: false });
        insertedCount += batch.length;
      } catch (err) {
        console.error("InsertMany error:", err);
      }
    }

    // Update campaign
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
      contacts: contacts.length,
      campaignId,
      insertedCount,
      duplicateCount,
      uniqueCount: uniqueCallingDataEntries.length,
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

      // 1. Fetch last client filter
      const lastFilter = await CampaignFilter.findOne({
        campaignId,
        dataType: "Client",
      })
        .sort({ revisionNo: -1, createdAt: -1 })
        .lean();

      if (!lastFilter) {
        return sendError(next, "No client filter found for this campaign", 404);
      }

      // 2. Fetch campaign for batch calculation
      const campaign = await Campaign.findById(campaignId).lean();
      if (!campaign) {
        return sendError(next, "Campaign not found", 404);
      }

      const existingBatchCount = campaign.filterBatches?.length || 0;
      const batchNumber = existingBatchCount + 1;
      const batchLabel = `Batch-${batchNumber}`;

      // 3. Field mapping
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
        if (!Array.isArray(filtersArr)) return q;

        filtersArr.forEach(({ field, value }) => {
          const mappedField = fieldMapping[field] || field;
          if (Array.isArray(value) && value.length > 0) {
            q[mappedField] = { [operator]: value };
          }
        });

        return q;
      };

      const includeQuery = buildMongoQuery(lastFilter.filters || [], "$in");
      const excludeQuery = buildMongoQuery(lastFilter.exclusions || [], "$nin");

      // 4. Aggregation: Fetch contacts from Master DB
      const contacts = await Contact.aggregate([
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
            ...(lastFilter.misc?.companyIdsUsed?.length
              ? {
                  Company_ID: {
                    $in: lastFilter.misc.companyIdsUsed.map(
                      (id) => new mongoose.Types.ObjectId(id)
                    ),
                  },
                }
              : {}),
            ...includeQuery,
            ...excludeQuery,
          },
        },
        {
          $sort: {
            EngagementPoints: -1, // Higher points first
            Last_Engagement_Date: -1, // Latest engagement first (tie breaker)
          },
        },
      ]);

      if (!contacts.length) {
        return sendError(next, "No contacts found for this filter", 404);
      }

      // 5. Prepare entries for CallingData
      const callingDataEntries = contacts.map((row) => ({
        CampaignId: new mongoose.Types.ObjectId(campaignId),
        UploadedBy: new mongoose.Types.ObjectId(uploadedBy),
        source: "ClientSuggested",
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
        Last_Engagement_Date: row.Last_Engagement_Date || "",
        EngagementPoints: row.EngagementPoints,
      }));

      // 6. Duplicate detection
      const existingContactIds = await CallingData.find(
        {
          CampaignId: campaignId,
          Contact_ID: { $in: callingDataEntries.map((e) => e.Contact_ID) },
        },
        { Contact_ID: 1 }
      ).lean();

      const existingIds = new Set(existingContactIds.map((e) => e.Contact_ID));

      const uniqueCallingDataEntries = callingDataEntries.filter(
        (entry) => !existingIds.has(entry.Contact_ID)
      );

      const duplicateCount =
        callingDataEntries.length - uniqueCallingDataEntries.length;

      // 7. If all duplicates → SUCCESS
      if (uniqueCallingDataEntries.length === 0) {
        return sendResponse(
          res,
          200,
          "All contacts already exist in this campaign. No new data added.",
          {
            contacts: contacts.length,
            campaignId,
            insertedCount: 0,
            duplicateCount,
            uniqueCount: 0,
            batchNumber,
            batchLabel,
          }
        );
      }

      // 8. Insert unique entries in batches
      const batchSize = 1000;
      let insertedCount = 0;

      for (let i = 0; i < uniqueCallingDataEntries.length; i += batchSize) {
        const batch = uniqueCallingDataEntries.slice(i, i + batchSize);
        try {
          await CallingData.insertMany(batch, { ordered: false });
          insertedCount += batch.length;
        } catch (err) {
          console.error("InsertMany error:", err);
        }
      }

      // 9. Update campaign (push filterBatchId)
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
          contacts: contacts.length,
          campaignId,
          insertedCount,
          duplicateCount,
          uniqueCount: uniqueCallingDataEntries.length,
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

    // 1. Fetch Both filter
    const bothFilter = await CampaignFilter.findOne({
      campaignId,
      dataType: "Both",
    }).lean();

    if (!bothFilter) {
      return sendError(next, "Both filter not found for this campaign", 404);
    }

    // 2. Fetch latest Kestone filter
    const kestoneFilter = await CampaignFilter.findOne({
      campaignId,
      dataType: "Kestone",
    })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();

    if (!kestoneFilter) {
      return sendError(next, "No Kestone filter found for this campaign", 404);
    }

    // 3. Fetch campaign for batch calc
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    const existingBatchCount = campaign.filterBatches?.length || 0;
    const batchNumber = existingBatchCount + 1;
    const batchLabel = `Batch-${batchNumber}`;

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
      if (!Array.isArray(filtersArr)) return q;

      filtersArr.forEach(({ field, value }) => {
        const mappedField = fieldMapping[field] || field;
        if (Array.isArray(value) && value.length > 0) {
          q[mappedField] = { [operator]: value };
        }
      });

      return q;
    };

    // 4. Build queries
    const kestoneInclude = buildMongoQuery(kestoneFilter.filters, "$in");
    const kestoneExclude = buildMongoQuery(kestoneFilter.exclusions, "$nin");

    const kestonePipeline = [
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
      { $match: { "discrepencyInData.status": { $ne: true }, ...kestoneInclude, ...kestoneExclude } },
      { $addFields: { sourceType: "Kestone" } },
    ];

    // Client filters from "Both"
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

    const clientInclude = buildMongoQuery(clientFilters, "$in");

    const clientPipeline = [
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
      { $match: { "discrepencyInData.status": { $ne: true }, ...clientInclude } },
      {
        $sort: {
          EngagementPoints: -1, // Higher points first
          Last_Engagement_Date: -1, // Latest engagement first (tie breaker)
        },
      },
      { $addFields: { sourceType: "Client" } },
    ];

    const kestoneContacts = await Contact.aggregate(kestonePipeline);
    const clientContacts = await Contact.aggregate(clientPipeline);

    if (!kestoneContacts.length && !clientContacts.length) {
      return sendError(next, "No contacts found for Both filter", 404);
    }

    // 5. Unique Map by Contact_ID
    const uniqueMap = new Map();

    const addToMap = (c, type) => {
      if (!c.Contact_ID) return;
      uniqueMap.set(c.Contact_ID, {
        contact: c,
        batch: type,
        dataSourceType: type,
      });
    };

    // Add Kestone first
    kestoneContacts.forEach((c) => addToMap(c, "Kestone"));

    // Client overrides
    clientContacts.forEach((c) => addToMap(c, "Client"));

    const mergedContacts = Array.from(uniqueMap.values());

    // 6. Prepare final calling data entries
    const callingDataEntries = mergedContacts.map(
      ({ contact, batch, dataSourceType }) => ({
        CampaignId: new mongoose.Types.ObjectId(campaignId),
        UploadedBy: new mongoose.Types.ObjectId(uploadedBy),
        source: "Both",
        batch: batchLabel,
        dataSourceType,

        Contact_ID: contact.Contact_ID,
        Contact_Source: contact.Contact_Source,
        Contact_Create_Date: contact.Contact_Create_Date,
        Salutation: contact.Salutation,
        First_Name: contact.First_Name,
        Last_Name: contact.Last_Name,
        Full_Name: contact.Full_Name,
        Gender: contact.Gender,
        Job_Title: contact.Job_Title,
        Job_Seniority: contact.Job_Seniority,
        Job_Function: contact.Job_Function,
        Contact_Address_1: contact.Contact_Address_1,
        Contact_Address_2: contact.Contact_Address_2,
        Contact_Address_3: contact.Contact_Address_3,
        Contact_City: contact.Contact_City,
        Contact_Pin: contact.Contact_Pin,
        Contact_State: contact.Contact_State,
        Contact_Region: contact.Contact_Region,
        Contact_Country: contact.Contact_Country,
        Contact_STD_ISD_Code: contact.Contact_STD_ISD_Code,
        Contact_Location_Tier: contact.Contact_Location_Tier,
        Contact_Direct_Phone1: contact.Contact_Direct_Phone1,
        Contact_Direct_Phone2: contact.Contact_Direct_Phone2,
        Contact_Extn_No: contact.Contact_Extn_No,
        Mobile_No: contact.Mobile_No,
        Office_Email_1: contact.Office_Email_1,
        Office_Email_2: contact.Office_Email_2,
        Personal_Email1: contact.Personal_Email1,
        Personal_Email2: contact.Personal_Email2,
        Contact_LinkedIn_Profile: contact.Contact_LinkedIn_Profile,
        Unsubscribe_Flag: contact.Unsubscribe_Flag,
        Unsubscribe_Account_Tag: contact.Unsubscribe_Account_Tag,
        DND_Flag: contact.DND_Flag,
        DND_Account_Tag: contact.DND_Account_Tag,
        Last_Engagement: contact.Last_Engagement,
        Last_Engagement_Date: contact.Last_Engagement_Date,
        Last_Engagement_Campaign: contact.Last_Engagement_Campaign,
        Telecalling_Remarks: contact.Telecalling_Remarks,

        Company_ID: contact.company_info?._id || null,
        Company_Name: contact.company_info?.Company_Name || "",
        Last_Engagement_Date: contact.Last_Engagement_Date || "",
        EngagementPoints: contact.EngagementPoints,
      })
    );

    // 7. Duplicate check by Contact_ID
    const existingContactIds = await CallingData.find(
      {
        CampaignId: campaignId,
        Contact_ID: { $in: callingDataEntries.map((e) => e.Contact_ID) },
      },
      { Contact_ID: 1 }
    ).lean();

    const existingIds = new Set(existingContactIds.map((e) => e.Contact_ID));

    const uniqueEntries = callingDataEntries.filter(
      (entry) => !existingIds.has(entry.Contact_ID)
    );

    const duplicateCount = callingDataEntries.length - uniqueEntries.length;

    // All duplicates → success
    if (uniqueEntries.length === 0) {
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

    // 8. Insert in batches
    const batchSize = 1000;
    let insertedCount = 0;

    for (let i = 0; i < uniqueEntries.length; i += batchSize) {
      const batchSlice = uniqueEntries.slice(i, i + batchSize);

      try {
        await CallingData.insertMany(batchSlice, { ordered: false });
        insertedCount += batchSlice.length;
      } catch (err) {
        console.error("InsertMany error:", err);
      }
    }

    // 9. Update campaign with filterBatchId
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
        uniqueCount: uniqueEntries.length,
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
