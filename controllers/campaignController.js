import Campaign from "../models/campaignModel.js";
import CallingData from "../models/callingDataModal.js";
import errorHandler from "../utils/index.js";
import User from "../models/userModel.js";
import AgentAssigned from "../models/agentAssigned.js";
import { UserRoleEnum, ProgramType, EmailTrigger } from "../utils/enum.js";
import { sendEmail } from "../services/microsoftGraphMailer.js";
import { campaignAssignedToPMTemplate } from "../services/notificationEmailTemplates.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;
const {
  SUPERADMIN,
  ADMIN,
  PRESALES_MANAGER,
  PROGRAM_MANAGER,
  RESOURCE_MANAGER,
  AGENT,
  DATABASE_MANAGER,
} = UserRoleEnum;

/**
 * @desc    Create new campaign
 * @route   POST /api/campaigns
 * @access  Private/Admin/Program Manager
 */

const createCampaign = asyncHandler(async (req, res, next) => {
  try {
    const {
      name,
      type,
      category,
      startDate,
      endDate,
      programManager,
      status,
      keyAccountManager,
      jcNumber,
      brandName,
      brandId,
      clientName,
      clientEmail,
      clientContact,
      registrationTarget,
      attendeeTarget,
      eventTopic,
      hasTargetAccountList,
      targetDatabaseSize,
      targetCompanyIndustry,
      targetCity,
      targetCompanySize,
      jobTitles,
      jobFunctions,
      comments,
      clientDataType,
    } = req.body;

    // Dates cannot be in the past at creation time
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDate && new Date(startDate) < today) {
      return sendError(next, "Start date cannot be in the past", 400);
    }
    if (endDate && new Date(endDate) < today) {
      return sendError(next, "End date cannot be in the past", 400);
    }

    // Check for duplicate name
    const campaignExists = await Campaign.exists({ name: name.trim() });

    if (campaignExists) {
      return sendError(next, "Campaign with this name already exists", 400);
    }

    // Create new campaign
    const campaign = await Campaign.create({
      name: name.trim(),
      type,
      category,
      startDate,
      endDate,
      programManager,
      status: status || "active",
      keyAccountManager,
      jcNumber,
      brandName,
      brandId,
      clientName,
      clientEmail,
      clientContact,
      registrationTarget,
      attendeeTarget,
      eventTopic,
      hasTargetAccountList,
      targetDatabaseSize,
      targetCompanyIndustry,
      targetCity,
      targetCompanySize,
      jobTitles,
      jobFunctions,
      comments,
      clientDataType,
    });

    // Fire-and-forget: notify all assigned Program Managers
    if (campaign.programManager?.length) {
      const createdByName = req.user?.employeeName || "";
      User.find({ _id: { $in: campaign.programManager } })
        .select("employeeName email")
        .lean()
        .then((pmUsers) => {
          pmUsers.forEach((pm) => {
            if (!pm.email) return;
            sendEmail(
              pm.email,
              `You have been assigned to campaign: ${campaign.name}`,
              campaignAssignedToPMTemplate({
                pmName: pm.employeeName,
                campaignName: campaign.name,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
                clientName: campaign.clientName,
                brandName: campaign.brandName,
                createdByName,
              }),
              {
                trigger: EmailTrigger.CAMPAIGN_ASSIGNED_TO_PM,
                campaignId: campaign._id,
                recipientUserId: pm._id,
              }
            );
          });
        })
        .catch((err) => console.error(`[Email] PM campaign notification failed: ${err.message}`));
    }

    return sendResponse(res, 200, "Campaign created successfully", campaign);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all campaigns
 * @route   GET /api/campaigns
 * @access  Private
 */
const getAllCampaigns = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);
    const search = req.query.search?.trim();

    const filter = {};

    // PM can only see their own campaigns
    if (req.user.role === PROGRAM_MANAGER) {
      filter.programManager = req.user._id;
    }

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { name: regex },
        { clientName: regex },
        { brandName: regex },
        { type: regex },
      ];
    }

    // No page param → flat array (backward compat for dropdowns)
    if (!page) {
      const campaigns = await Campaign.find(filter)
        .populate({ path: "programManager", select: "employeeName email" })
        .sort({ createdAt: -1 })
        .lean();
      return sendResponse(res, 200, "Campaigns retrieved successfully", campaigns);
    }

    const skip = (page - 1) * limit;
    const [total, campaigns] = await Promise.all([
      Campaign.countDocuments(filter),
      Campaign.find(filter)
        .populate({ path: "programManager", select: "employeeName email" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Campaigns retrieved successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: campaigns,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get single campaign
 * @route   GET /api/campaigns/:id
 * @access  Private
 */
const getCampaign = asyncHandler(async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate({
        path: "programManager",
        select: "employeeName email",
      })
      .lean();

    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    return sendResponse(res, 200, "Campaign retrieved successfully", campaign);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Update campaign
 * @route   PUT /api/campaigns/:id
 * @access  Private/Admin/Program Manager
 */
const updateCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { _id, ...updateData } = req.body;
    console.log("Update Data:", updateData);

    // Snapshot old PM list before update so we can diff newly added PMs
    const oldCampaign = await Campaign.findById(_id).select("programManager").lean();
    const oldPmIds = new Set(
      (oldCampaign?.programManager || []).map((id) => id.toString())
    );

    const updatedCampaign = await Campaign.findByIdAndUpdate(_id, updateData, {
      new: true,
      runValidators: true,
    }).populate({ path: "programManager", select: "employeeName email role" });
    console.log("Updated Campaign:", updatedCampaign);

    if (!updatedCampaign) return sendError(next, "Campaign not found", 404);

    // Fire-and-forget: notify only newly added PMs
    const newlyAddedPMs = (updatedCampaign.programManager || []).filter(
      (pm) => !oldPmIds.has(pm._id.toString())
    );
    if (newlyAddedPMs.length > 0) {
      newlyAddedPMs.forEach((pm) => {
        if (!pm.email) return;
        sendEmail(
          pm.email,
          `You have been assigned to campaign: ${updatedCampaign.name}`,
          campaignAssignedToPMTemplate({
            pmName: pm.employeeName,
            campaignName: updatedCampaign.name,
            startDate: updatedCampaign.startDate,
            endDate: updatedCampaign.endDate,
            clientName: updatedCampaign.clientName,
            brandName: updatedCampaign.brandName,
            createdByName: req.user?.employeeName || "",
          }),
          {
            trigger: EmailTrigger.CAMPAIGN_ASSIGNED_TO_PM,
            campaignId: updatedCampaign._id,
            recipientUserId: pm._id,
          }
        );
      });
    }

    return sendResponse(
      res,
      200,
      "Campaign updated successfully",
      updatedCampaign.toObject()
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
/**
 * @desc    Get campaigns by user ID with role-based access
 * @route   GET /api/campaigns/user/:userId
 * @access  Private
 */
const getCampaignsByUserId = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).select("role");
    if (!user) return sendError(next, "User not found", 404);

    let campaigns = [];

    switch (user.role) {
      case PROGRAM_MANAGER:
        campaigns = await Campaign.find({ programManager: user._id })
          .populate({
            path: "programManager",
            select: "employeeName email role",
          })
          .sort({ createdAt: -1 }) // Sort by creation date, newest first
          .lean();
        break;

      case AGENT:
        // Get all campaign assignments for this agent
        const agentAssignments = await AgentAssigned.find({
          agent_id: user._id,
        })
          .populate({
            path: "campaign_id",
            populate: {
              path: "programManager",
              select: "employeeName email role",
            },
          })
          .sort({ assigned_date: -1 }) // Sort by assignment date, newest first
          .lean();

        // Extract unique campaigns and remove null/undefined campaigns
        const campaignMap = new Map();

        agentAssignments.forEach((assignment) => {
          if (assignment.campaign_id && assignment.campaign_id._id) {
            const campaignId = assignment.campaign_id._id.toString();

            // Only add if not already in map (keeps the earliest assignment)
            if (!campaignMap.has(campaignId)) {
              campaignMap.set(campaignId, {
                ...assignment.campaign_id,
                assignmentDetails: {
                  isAssigned: assignment.isAssigned,
                  assigned_date: assignment.assigned_date,
                  released_date: assignment.released_date,
                },
              });
            }
          }
        });

        // Convert map to array
        campaigns = Array.from(campaignMap.values());
        break;

      case PRESALES_MANAGER:
      case RESOURCE_MANAGER:
      case DATABASE_MANAGER:
      case ADMIN:
      case SUPERADMIN:
        // These roles can see all campaigns
        campaigns = await Campaign.find({})
          .populate({
            path: "programManager",
            select: "employeeName email role",
          })
          .sort({ createdAt: -1 }) // Sort by creation date, newest first
          .lean();
        break;

      default:
        return sendError(next, "Invalid user role", 400);
    }

    return sendResponse(
      res,
      200,
      "Campaigns retrieved successfully",
      campaigns
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});
/**
 * @desc    Delete campaign
 * @route   DELETE /api/campaigns/:id
 * @access  Private/Admin
 */
const deleteCampaign = asyncHandler(async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    await campaign.deleteOne();

    return sendResponse(res, 200, "Campaign deleted successfully", null);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

//update camapign data source type
const updateCampaignDataSourceType = asyncHandler(async (req, res, next) => {
  try {
    const { dataSourceType } = req.body;

    if (!dataSourceType) {
      return sendError(next, "dataSourceType is required", 400);
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    campaign.dataSourceType = dataSourceType;
    await campaign.save();

    return sendResponse(
      res,
      200,
      "Data Source Type updated successfully",
      campaign
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

//update campaign stage
const updateCampaignStage = asyncHandler(async (req, res, next) => {
  try {
    const { stage } = req.body;

    if (!stage) {
      return sendError(next, "Stage is required", 400);
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return sendError(next, "Campaign not found", 404);
    }

    campaign.stage = stage;
    await campaign.save();

    return sendResponse(
      res,
      200,
      `Stage updated to ${stage} successfully`,
      campaign
    );
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Create a Reconfirmation campaign from an existing campaign.
 *          Copies all campaign details (including PMs) and bulk-inserts
 *          all registered calling data from the source campaign as fresh
 *          (unassigned, un-registered) records in the new campaign.
 * @route   POST /api/campaign/createReconfirmation/:campaignId
 * @access  Private / Admin / Presales Manager / Program Manager
 */
const CONTACT_FIELDS = [
  "Contact_ID", "Contact_Source", "Contact_Create_Date",
  "Salutation", "First_Name", "Last_Name", "Full_Name",
  "Gender", "Job_Title", "Job_Seniority", "Job_Seniority_Secondary", "Job_Seniority_Tertiary", "Job_Function",
  "Contact_Address_1", "Contact_Address_2", "Contact_Address_3",
  "Contact_City", "Contact_Pin", "Contact_State", "Contact_Region", "Contact_Country",
  "Contact_STD_ISD_Code", "Contact_Location_Tier",
  "Contact_Direct_Phone1", "Contact_Direct_Phone2", "Contact_Extn_No",
  "Mobile_No", "Office_Email_1", "Office_Email_2", "Personal_Email1", "Personal_Email2",
  "Contact_LinkedIn_Profile",
  "Unsubscribe_Flag", "Unsubscribe_Account_Tag", "DND_Flag", "DND_Account_Tag",
  "Last_Engagement", "Last_Engagement_Date", "EngagementPoints", "Last_Engagement_Campaign",
  "Telecalling_Remarks",
  "Company_ID", "Company_Name", "Company_ID_Kestone",
  // "Affinity_ID_Dell", "Company_ID_Google",
  "Company_Source",
  "Year_Founded", "Turnover_Range", "Employees_Range",
  "Industry", "Sub_Industry", "Company_Segment",
  "Website", "Company_LinkedIn_Profile", "Company_Phone1", "Company_Phone2",
  "source", "batch", "dataSourceType",
];

const createReconfirmationCampaign = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    // 1. Fetch original campaign
    const original = await Campaign.findById(campaignId).lean();
    if (!original) return sendError(next, "Campaign not found", 404);

    // 2. Build unique name: Reconfirmation_Name, then _2, _3 …
    const baseName = `Reconfirmation_${original.name}`;
    let newName = baseName;
    if (await Campaign.exists({ name: baseName })) {
      let counter = 2;
      while (await Campaign.exists({ name: `${baseName}_${counter}` })) {
        counter++;
      }
      newName = `${baseName}_${counter}`;
    }

    // 3. Create new campaign — copy all details, reset workflow state
    const newCampaign = await Campaign.create({
      name: newName,
      parentCampaignId: campaignId,
      type: original.type,
      category: original.category,
      startDate: original.startDate,
      endDate: original.endDate,
      programManager: original.programManager, // same PM(s)
      status: "active",
      keyAccountManager: original.keyAccountManager,
      jcNumber: original.jcNumber,
      brandName: original.brandName,
      brandId: original.brandId,
      clientName: original.clientName,
      clientEmail: original.clientEmail,
      clientContact: original.clientContact,
      registrationTarget: original.registrationTarget,
      attendeeTarget: original.attendeeTarget,
      eventTopic: original.eventTopic,
      hasTargetAccountList: original.hasTargetAccountList,
      targetDatabaseSize: original.targetDatabaseSize,
      targetCompanyIndustry: original.targetCompanyIndustry,
      targetCity: original.targetCity,
      targetCompanySize: original.targetCompanySize,
      jobTitles: original.jobTitles,
      jobFunctions: original.jobFunctions,
      comments: original.comments,
      dataSourceType: original.dataSourceType,
      // fresh workflow state
      stage: "NotFiltered",
      isCallingDataAssigned: false,
    });

    // 4. Fetch all registered contacts from source campaign
    const registeredDocs = await CallingData.find({
      CampaignId: campaignId,
      isRegistered: true,
    })
      .select(CONTACT_FIELDS.join(" "))
      .lean();

    if (registeredDocs.length === 0) {
      return sendResponse(res, 201, "Reconfirmation campaign created. No registered contacts to copy.", {
        campaign: newCampaign,
        copiedCount: 0,
      });
    }

    // 5. Build new CallingData docs — contact/company info preserved, all tracking reset
    const newDocs = registeredDocs.map((doc) => {
      const contactData = {};
      CONTACT_FIELDS.forEach((f) => {
        if (doc[f] !== undefined) contactData[f] = doc[f];
      });

      return {
        ...contactData,
        CampaignId: newCampaign._id,
        UploadedBy: req.user._id,
        // reset assignment
        agentId: undefined,
        pmId: undefined,
        pmName: undefined,
        reassigned_to: { status: false, previously_assigned_to: [] },
        // reset registration — they need to reconfirm
        isRegistered: false,
        registeredOn: null,
        registrationSource: "Not Registered",
        // reset communication & activity
        callHistory: undefined,
        emailTemplates: {},
        whatsappTemplates: [],
        priority: { isActive: false, priorityDate: null, setAt: null, note: "" },
        discrepencyInData: { status: false, chatHistory: [], misc: {} },
        isDataSourceApproved: false,
      };
    });

    // 6. Bulk insert (ordered:false continues on individual doc errors)
    await CallingData.insertMany(newDocs, { ordered: false });

    return sendResponse(res, 201, "Reconfirmation campaign created successfully", {
      campaign: newCampaign,
      copiedCount: newDocs.length,
    });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

/**
 * @desc    Get all reconfirmation campaigns derived from a parent campaign
 * @route   GET /api/campaign/getReconfirmationCampaigns/:campaignId
 * @access  Private
 */
const getReconfirmationCampaigns = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const campaigns = await Campaign.find({ parentCampaignId: campaignId })
      .populate({ path: "programManager", select: "employeeName email" })
      .sort({ createdAt: -1 })
      .lean();
    return sendResponse(res, 200, "Reconfirmation campaigns retrieved successfully", campaigns);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const checkEndedCampaigns = asyncHandler(async () => {
  try {
    const now = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endedCampaign = await Campaign.find({
      endDate: { $gte: yesterday, $gte: now },
    });
    return endedCampaign;
  } catch (error) {
    return [];
  }
});

const updateAllowedTemplates = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId, whatsapp, email } = req.body;
    if (!campaignId) return sendError(next, "Campaign ID is required", 400);

    const campaign = await Campaign.findByIdAndUpdate(
      campaignId,
      { "allowedTemplates.whatsapp": whatsapp || [], "allowedTemplates.email": email || [] },
      { new: true }
    ).select("name allowedTemplates");

    if (!campaign) return sendError(next, "Campaign not found", 404);
    return sendResponse(res, 200, "Templates updated successfully", campaign);
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

const getCampaignAllowedTemplates = asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return sendError(next, "Campaign ID is required", 400);

    const campaign = await Campaign.findById(campaignId).select("name allowedTemplates").lean();
    if (!campaign) return sendError(next, "Campaign not found", 404);

    return sendResponse(res, 200, "Allowed templates fetched", campaign.allowedTemplates || { whatsapp: [], email: [] });
  } catch (error) {
    return sendError(next, error.message, 500);
  }
});

export {
  createCampaign,
  getAllCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignsByUserId,
  updateCampaignDataSourceType,
  updateCampaignStage,
  checkEndedCampaigns,
  createReconfirmationCampaign,
  getReconfirmationCampaigns,
  updateAllowedTemplates,
  getCampaignAllowedTemplates,
};
