import ExternalRegistration from "../models/externalRegistrationModel.js";
import errorHandler from "../utils/index.js";
import { UserRoleEnum } from "../utils/enum.js";
import XLSX from "xlsx";
import CallingData from "../models/callingDataModal.js";

const { ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER, AGENT } = UserRoleEnum;
const { asyncHandler, sendError, sendResponse } = errorHandler;

//upload external registration data
const uploadExternalDataControllerOld = asyncHandler(async (req, res, next) => {
  try {
    // Check if file exists
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // Get CampaignId from request (adjust based on your route structure)
    const { CampaignId } = req.body; // or req.params or req.query

    if (!CampaignId) {
      return sendError(next, "CampaignId is required", 400);
    }

    // Read Excel file
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    if (!excelData || excelData.length === 0) {
      return sendError(next, "Excel file is empty", 400);
    }

    const results = {
      total: excelData.length,
      matched: 0,
      notMatched: 0,
      inserted: 0,
      errors: [],
    };

    // Process each row
    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];

      try {
        // Extract mobile and email fields from Excel
        const mobileNo = row.Mobile_No?.toString().trim();
        const contact_Direct_Phone1 =
          row.Contact_Direct_Phone1?.toString().trim();
        const contact_Direct_Phone2 =
          row.Contact_Direct_Phone2?.toString().trim();
        const officeEmail1 = row.Office_Email_1?.toString()
          .trim()
          .toLowerCase();
        const officeEmail2 = row.Office_Email_2?.toString()
          .trim()
          .toLowerCase();
        const personalEmail1 = row.Personal_Email1?.toString()
          .trim()
          .toLowerCase();
        const personalEmail2 = row.Personal_Email2?.toString()
          .trim()
          .toLowerCase();

        // Build OR conditions for matching
        const orConditions = [];

        // Add mobile number conditions
        if (mobileNo) {
          orConditions.push({ Mobile_No: mobileNo });
        }
        if (contact_Direct_Phone1) {
          orConditions.push({ Contact_Direct_Phone1: contact_Direct_Phone1 });
        }
        if (contact_Direct_Phone2) {
          orConditions.push({ Contact_Direct_Phone2: contact_Direct_Phone2 });
        }

        // Add email conditions
        if (officeEmail1) {
          orConditions.push({ Office_Email_1: officeEmail1 });
        }
        if (officeEmail2) {
          orConditions.push({ Office_Email_2: officeEmail2 });
        }
        if (personalEmail1) {
          orConditions.push({ Personal_Email1: personalEmail1 });
        }
        if (personalEmail2) {
          orConditions.push({ Personal_Email2: personalEmail2 });
        }

        // Skip if no valid contact info
        if (orConditions.length === 0) {
          results.errors.push({
            row: i + 1,
            message: "No mobile or email found",
            data: row,
          });
          continue;
        }

        // Build final query: CampaignId AND (mobile OR email)
        const matchQuery = {
          CampaignId: CampaignId,
          $or: orConditions,
        };

        // Check if exists in CallingData
        const existingCallingData = await CallingData.findOne(matchQuery);

        let isRegistered = false;
        let isAvailableInCallingData = false;

        // If match found in CallingData
        if (existingCallingData) {
          isRegistered = true;
          isAvailableInCallingData = true;
          results.matched++;

          // Update CallingData registration status with proper registrationSource
          await CallingData.findByIdAndUpdate(
            existingCallingData._id,
            {
              isRegistered: true,
              registeredOn: new Date(),
              registrationSource: "External Registration",
            },
            { new: true } // Return updated document
          );
          console.log(
            `✓ Matched and updated CallingData ID: ${existingCallingData._id}`
          );
        } else {
          results.notMatched++;
          console.log(`✗ No match found for row ${i + 1}`);
        }

        // Prepare ExternalRegistration document
        const registrationData = {
          Contact_Source: row.Contact_Source || "External Upload",
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
          Contact_Direct_Phone1: contact_Direct_Phone1,
          Contact_Direct_Phone2: contact_Direct_Phone2,
          Contact_Extn_No: row.Contact_Extn_No,
          Mobile_No: mobileNo,
          Office_Email_1: officeEmail1,
          Office_Email_2: officeEmail2,
          Personal_Email1: personalEmail1,
          Personal_Email2: personalEmail2,
          Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile,
          Unsubscribe_Flag: row.Unsubscribe_Flag,
          Unsubscribe_Account_Tag: row.Unsubscribe_Account_Tag,
          DND_Flag: row.DND_Flag,
          DND_Account_Tag: row.DND_Account_Tag,
          Last_Engagement: row.Last_Engagement,
          Last_Engagement_Date: row.Last_Engagement_Date,
          Last_Engagement_Campaign: row.Last_Engagement_Campaign,
          Telecalling_Remarks: row.Telecalling_Remarks,
          Company_Name: row.Company_Name,
          Company_ID_Kestone: row.Company_ID_Kestone,
          Affinity_ID_Dell: row.Affinity_ID_Dell,
          Company_ID_Google: row.Company_ID_Google,
          Company_Source: row.Company_Source,
          Year_Founded: row.Year_Founded,
          Turnover_Range: row.Turnover_Range,
          Employees_Range: row.Employees_Range,
          Industry: row.Industry,
          Sub_Industry: row.Sub_Industry,
          Company_Segment: row.Company_Segment,
          Website: row.Website,
          Company_LinkedIn_Profile: row.Company_LinkedIn_Profile,
          Company_Phone1: row.Company_Phone1,
          Company_Phone2: row.Company_Phone2,
          isRegistered,
          isAvailableInCallingData,
          registeredOn: isRegistered ? new Date() : null,
        };

        // Insert into ExternalRegistration
        const data = await ExternalRegistration.create(registrationData);
        console.log(`✓ Inserted ExternalRegistration ID: ${data._id}`);
        results.inserted++;
      } catch (error) {
        console.error(`✗ Error processing row ${i + 1}:`, error.message);
        results.errors.push({
          row: i + 1,
          message: error.message,
          data: row,
        });
      }
    }

    return sendResponse(
      res,
      200,
      "External registration data processed successfully",
      results
    );
  } catch (error) {
    console.error("Controller error:", error);
    return sendError(next, error.message, 500);
  }
});

const uploadExternalDataController = asyncHandler(async (req, res, next) => {
  try {
    // Check if file exists
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // Get CampaignId from request
    const { CampaignId } = req.body;

    if (!CampaignId) {
      return sendError(next, "CampaignId is required", 400);
    }

    // Read Excel file
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    if (!excelData || excelData.length === 0) {
      return sendError(next, "Excel file is empty", 400);
    }

    const results = {
      total: excelData.length,
      matched: 0,
      notMatched: 0,
      inserted: 0,
      duplicatesSkipped: 0,
      errors: [],
    };

    // Process each row
    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];

      try {
        // Extract mobile and email fields from Excel
        const mobileNo = row.Mobile_No?.toString().trim();
        const contact_Direct_Phone1 =
          row.Contact_Direct_Phone1?.toString().trim();
        const contact_Direct_Phone2 =
          row.Contact_Direct_Phone2?.toString().trim();
        const officeEmail1 = row.Office_Email_1?.toString()
          .trim()
          .toLowerCase();
        const officeEmail2 = row.Office_Email_2?.toString()
          .trim()
          .toLowerCase();
        const personalEmail1 = row.Personal_Email1?.toString()
          .trim()
          .toLowerCase();
        const personalEmail2 = row.Personal_Email2?.toString()
          .trim()
          .toLowerCase();

        // Build OR conditions for matching
        const orConditions = [];

        // Add mobile number conditions
        if (mobileNo) {
          orConditions.push({ Mobile_No: mobileNo });
        }
        if (contact_Direct_Phone1) {
          orConditions.push({ Contact_Direct_Phone1: contact_Direct_Phone1 });
        }
        if (contact_Direct_Phone2) {
          orConditions.push({ Contact_Direct_Phone2: contact_Direct_Phone2 });
        }

        // Add email conditions
        if (officeEmail1) {
          orConditions.push({ Office_Email_1: officeEmail1 });
        }
        if (officeEmail2) {
          orConditions.push({ Office_Email_2: officeEmail2 });
        }
        if (personalEmail1) {
          orConditions.push({ Personal_Email1: personalEmail1 });
        }
        if (personalEmail2) {
          orConditions.push({ Personal_Email2: personalEmail2 });
        }

        // Skip if no valid contact info
        if (orConditions.length === 0) {
          results.errors.push({
            row: i + 1,
            message: "No mobile or email found",
            data: row,
          });
          continue;
        }

        // Check if this exact record already exists in ExternalRegistration
        const duplicateCheck = {
          $or: orConditions,
        };

        const existingExternalRecord = await ExternalRegistration.findOne(
          duplicateCheck
        );

        if (existingExternalRecord) {
          results.duplicatesSkipped++;
          console.log(
            `⚠ Duplicate found in ExternalRegistration, skipping row ${i + 1}`
          );
          continue; // Skip this record
        }

        // Build final query: CampaignId AND (mobile OR email)
        const matchQuery = {
          CampaignId: CampaignId,
          $or: orConditions,
        };

        // Check if exists in CallingData
        const existingCallingData = await CallingData.findOne(matchQuery);

        let isRegistered = false;
        let isAvailableInCallingData = false;

        // If match found in CallingData
        if (existingCallingData) {
          isRegistered = true;
          isAvailableInCallingData = true;
          results.matched++;

          // Update CallingData registration status
          await CallingData.findByIdAndUpdate(
            existingCallingData._id,
            {
              isRegistered: true,
              registeredOn: new Date(),
              registrationSource: {
                source: "External Registration",
                uploadedAt: new Date(),
              },
            },
            { new: true }
          );

          console.log(
            `✓ Matched and updated CallingData ID: ${existingCallingData._id}`
          );
        } else {
          results.notMatched++;
          console.log(`✗ No match found for row ${i + 1}`);
        }

        // Prepare ExternalRegistration document
        const registrationData = {
          CampaignId: CampaignId,
          Contact_Source: row.Contact_Source || "File",
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
          Contact_Direct_Phone1: contact_Direct_Phone1,
          Contact_Direct_Phone2: contact_Direct_Phone2,
          Contact_Extn_No: row.Contact_Extn_No,
          Mobile_No: mobileNo,
          Office_Email_1: officeEmail1,
          Office_Email_2: officeEmail2,
          Personal_Email1: personalEmail1,
          Personal_Email2: personalEmail2,
          Contact_LinkedIn_Profile: row.Contact_LinkedIn_Profile,
          Unsubscribe_Flag: row.Unsubscribe_Flag,
          Unsubscribe_Account_Tag: row.Unsubscribe_Account_Tag,
          DND_Flag: row.DND_Flag,
          DND_Account_Tag: row.DND_Account_Tag,
          Last_Engagement: row.Last_Engagement,
          Last_Engagement_Date: row.Last_Engagement_Date,
          Last_Engagement_Campaign: row.Last_Engagement_Campaign,
          Telecalling_Remarks: row.Telecalling_Remarks,
          Company_Name: row.Company_Name,
          Company_ID_Kestone: row.Company_ID_Kestone,
          Affinity_ID_Dell: row.Affinity_ID_Dell,
          Company_ID_Google: row.Company_ID_Google,
          Company_Source: row.Company_Source,
          Year_Founded: row.Year_Founded,
          Turnover_Range: row.Turnover_Range,
          Employees_Range: row.Employees_Range,
          Industry: row.Industry,
          Sub_Industry: row.Sub_Industry,
          Company_Segment: row.Company_Segment,
          Website: row.Website,
          Company_LinkedIn_Profile: row.Company_LinkedIn_Profile,
          Company_Phone1: row.Company_Phone1,
          Company_Phone2: row.Company_Phone2,
          //   isRegistered: row.Registration_Status,
          //   isRegistered: Registration_Status,
          isRegistered: ["true", "t", "yes", "y", "1"].includes(
            String(row.Registration_Status).trim().toLowerCase()
          ),
          isAvailableInCallingData,
          registeredOn: row.Registration_Status ? row.Registration_Date : null,
        };

        // Insert into ExternalRegistration
        const data = await ExternalRegistration.create(registrationData);
        console.log(`✓ Inserted ExternalRegistration ID: ${data._id}`);
        results.inserted++;
      } catch (error) {
        console.error(`✗ Error processing row ${i + 1}:`, error.message);
        results.errors.push({
          row: i + 1,
          message: error.message,
          data: row,
        });
      }
    }

    return sendResponse(
      res,
      200,
      "External registration data processed successfully",
      results
    );
  } catch (error) {
    console.error("Controller error:", error);
    return sendError(next, error.message, 500);
  }
});

const getAllExternalRegistrations = asyncHandler(async (req, res, next) => {
  try {
    const { CampaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { CampaignId };

    // Search on multiple fields
    if (req.query.search && req.query.search.trim() !== "") {
      const search = req.query.search.trim();
      const regex = new RegExp(search, "i");

      filter.$or = [
        { Full_Name: regex },
        { First_Name: regex },
        { Last_Name: regex },
        { Mobile_No: regex },
        { Office_Email_1: regex },
        { Office_Email_2: regex },
        { Personal_Email1: regex },
        { Personal_Email2: regex },
        { Contact_Direct_Phone1: regex },
        { Contact_Direct_Phone2: regex },
        { Company_Name: regex },
      ];
    }

    // Filter by isRegistered
    if (req.query.isRegistered !== undefined) {
      const val = req.query.isRegistered.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isRegistered = val === "true";
      }
    }

    // Filter by isAvailableInCallingData
    if (req.query.isAvailableInCallingData !== undefined) {
      const val = req.query.isAvailableInCallingData.toLowerCase();
      if (val === "true" || val === "false") {
        filter.isAvailableInCallingData = val === "true";
      }
    }

    // Filter by Contact_Source
    if (req.query.Contact_Source) {
      filter.Contact_Source = req.query.Contact_Source;
    }

    // Fetch data and count
    const [total, data] = await Promise.all([
      ExternalRegistration.countDocuments(filter),
      ExternalRegistration.find(filter)
        .sort({ createdAt: -1 }) // Latest first
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(
      res,
      200,
      "External registrations fetched successfully",
      {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        data,
      }
    );
  } catch (err) {
    return sendError(next, err.message, 500);
  }
});

export { uploadExternalDataController, getAllExternalRegistrations };
