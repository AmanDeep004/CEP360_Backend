import CampaignFilter from "../models/CallingDataFiltrationModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import Company from "../models/MasterDBModel/companyModel.js";
import errorHandler from "../utils/index.js";
import CallingData from "../models/callingDataModal.js";
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
      Contact_Country: "Contact_Country",
      Contact_Region: "Contact_Region",
      Job_Function: "Job_Function",
      Job_Seniority: "Job_Seniority",
      Industry: "company_info.Industry",
      Employees_Range: "company_info.Employees_Range",
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
        { $match: { ...includeQuery, ...excludeQuery } },
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
// here
const getPrevCampFiltersByCampaignId = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return sendError(next, "Camapign Id is required", 400);
    }
    console.log("Fetching previous campaign filters for ID:", campaignId);
    const filters = await CampaignFilter.find({ campaignId })
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

//assign all the calling data filtration to the particular campaign

const assignCallingDataToCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, uploadedBy, batch, dataSourceType } = req.body;

    if (!campaignId || !uploadedBy) {
      return sendError(next, "Required fields missing", 400);
    }

    // Get the last entered filter for this campaign
    const lastFilter = await CampaignFilter.findOne({ campaignId })
      .sort({ revisionNo: -1, createdAt: -1 })
      .lean();

    if (!lastFilter) {
      return sendError(next, "No campaign filter found for this campaign", 404);
    }

    const fieldMapping = {
      Contact_Country: "Contact_Country",
      Contact_Region: "Contact_Region",
      Job_Function: "Job_Function",
      Job_Seniority: "Job_Seniority",
      Industry: "company_info.Industry",
      Employees_Range: "company_info.Employees_Range",
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

    // Use aggregation pipeline to get contacts with company lookup
    const contactsPipeline = [
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
          ...includeQuery,
          ...excludeQuery,
        },
      },
    ];

    // Get all contacts matching the last filter
    const contacts = await Contact.aggregate(contactsPipeline);

    if (!contacts.length) {
      return sendError(next, "No contacts found for this filter", 404);
    }

    const callingDataEntries = contacts.map((row) => ({
      CampaignId: new mongoose.Types.ObjectId(campaignId),
      UploadedBy: new mongoose.Types.ObjectId(uploadedBy),
      source: "MasterDB",
      batch: batch || "",
      dataSourceType: dataSourceType || "Kestone",
      // isDataSourceApproved: isDataSourceApproved || false,

      // Contact fields
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
      Company_ID: row.company_info?._id
        ? new mongoose.Types.ObjectId(row.company_info._id)
        : null,
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
    }));

    //testing with single entry
    // const testDoc = callingDataEntries[0];
    // await CallingData.create(testDoc);

    const batchSize = 1000;
    let insertedCount = 0;
    for (let i = 0; i < callingDataEntries.length; i += batchSize) {
      const batch = callingDataEntries.slice(i, i + batchSize);
      try {
        await CallingData.insertMany(batch, { ordered: false });
        insertedCount += batch.length;
      } catch (err) {
        console.error("InsertMany error:", err);
      }
    }

    return sendResponse(
      res,
      200,
      "Calling data assigned to campaign successfully",
      {
        // count: insertedCount,
        contacts,
        campaignId,
        insertedCount,
      }
    );
  } catch (err) {
    console.error("Error assigning calling data to campaign:", err);
    return sendError(
      next,
      err.message || "Failed to assign calling data to campaign",
      500
    );
  }
});

const companiesMatchedDataWithExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "Please upload an Excel or CSV file", 400);
    }

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

export {
  callingDataFilter,
  callingDataFilterLightweight,
  getCampaignFiltersByCampaignId,
  getPrevCampFiltersByCampaignId,
  assignCallingDataToCampaign,
  companiesMatchedDataWithExcel,
};
