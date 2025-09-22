import CampaignFilter from "../models/CallingDataFiltrationModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import errorHandler from "../utils/index.js";

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
    const { campaignId, filters = [], exclusions = [] } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
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

const getPrevCampFiltersByCampaignId = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return sendError(next, "Camapign Id is required", 400);
    }
    const filters = await CampaignFilter.find({ campaignId })
      .sort({
        revisionNo: -1,
        createdAt: -1,
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

export {
  callingDataFilter,
  callingDataFilterLightweight,
  getCampaignFiltersByCampaignId,
  getPrevCampFiltersByCampaignId,
};
