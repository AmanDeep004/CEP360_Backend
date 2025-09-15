import CampaignFilter from "../models/CallingDataFiltrationModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";
import errorHandler from "../utils/index.js";

const { asyncHandler, sendError, sendResponse } = errorHandler;

function buildMongoQuery(filters = [], exclusions = []) {
  const query = {};

  if (filters.length > 0) {
    query.$and = filters.map((f) => {
      return { [f.field]: f.value };
    });
  }

  if (exclusions.length > 0) {
    query.$and = [
      ...(query.$and || []),
      ...exclusions.map((f) => {
        return { [f.field]: { $ne: f.value } };
      }),
    ];
  }

  return query;
}

const callingDataFilter = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, filters = [], exclusions = [], status } = req.body;

    if (!campaignId) {
      return sendError(next, "Campaign ID is required", 400);
    }
    const query = buildMongoQuery(filters, exclusions);
    const contacts = await Contact.find(query).populate("company_id").lean();

    const filteredData = {
      contactCount: contacts.length,
      contacts,
    };

    //calculate the data summary and save it in filteredData

    const campaignFilter = await CampaignFilter.create({
      campaignId,
      filters,
      exclusions,
      revisionNo: 1,
      //   filteredData,
      status: status,
    });

    return sendResponse(res, 200, "Campaign filter created successfully", {
      filteredData,
    });
  } catch (err) {
    return sendError(
      next,
      err.message || "Failed to create campaign filter",
      500
    );
  }
});

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

export { callingDataFilter, getCampaignFiltersByCampaignId };
