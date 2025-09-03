import XLSX from "xlsx";
import fs from "fs";
import errorHandler from "../../utils/index.js";
import Company from "../../models/MasterDBModel/companyModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import CompanyHistory from "../../models/MasterDBModel/companyHistory.js";
import ContactHistory from "../../models/MasterDBModel/contactHistory.js";
import dndModel from "../../models/MasterDBModel/dndModel.js";
import engagementModel from "../../models/MasterDBModel/enagagementHistoryModel.js";
const { asyncHandler, sendError, sendResponse } = errorHandler;

const batchCreateFromExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "No file uploaded", 400);
    }

    // Parse Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!rows.length) {
      return sendError(next, "Uploaded file is empty", 400);
    }

    // --- Step 1: Collect all unique company names & contact ids ---
    const companyNames = new Set();
    const contactIds = new Set();

    for (const row of rows) {
      if (row.company_name) companyNames.add(row.company_name.trim());
      if (row.contact_id) contactIds.add(row.contact_id.trim());
    }

    // --- Step 2: Fetch existing records in bulk ---
    const [existingCompanies, existingContacts] = await Promise.all([
      Company.find({ company_name: { $in: [...companyNames] } }).lean(),
      Contact.find({ contact_id: { $in: [...contactIds] } })
        .select("contact_id")
        .lean(),
    ]);

    const companyCache = new Map();
    existingCompanies.forEach((c) => companyCache.set(c.company_name, c._id));

    const existingContactIds = new Set(
      existingContacts.map((c) => c.contact_id)
    );

    // --- Step 3: Prepare bulk arrays ---
    const newCompanies = [];
    const contactBuffer = []; // buffer contacts, assign company_id later

    for (const row of rows) {
      const companyName = row.company_name?.trim();
      if (!companyName) continue;

      if (!companyCache.has(companyName)) {
        // prepare new company insert
        newCompanies.push({
          company_name: companyName,
          company_id_kestone: row.company_id_kestone || "",
          affinity_id_dell: row.affinity_id_dell || "",
          company_id_google: row.company_id_google || "",
          company_source: row.company_source || "",
          year_founded: row.year_founded || "",
          turnover_range: row.turnover_range || "",
          employees_range: row.employees_range || "",
          industry: row.industry || "",
          sub_industry: row.sub_industry || "",
          company_segment: row.company_segment || "",
          website: row.website || "",
          company_linkedIn_profile: row.company_linkedIn_profile || "",
          company_phone1: row.company_phone1 || "",
          company_phone2: row.company_phone2 || "",
        });
        // temporarily mark as "to-be-created"
        companyCache.set(companyName, null);
      }

      const contactId =
        row.contact_id?.trim() || `${Date.now()}_${Math.random()}`;
      if (existingContactIds.has(contactId)) {
        continue; // skip duplicate
      }

      // Buffer contacts (company_id will be filled after company insert)
      contactBuffer.push({ row, contactId, companyName });
    }

    // --- Step 4: Insert new companies in bulk ---
    if (newCompanies.length > 0) {
      const insertedCompanies = await Company.insertMany(newCompanies);
      insertedCompanies.forEach((c) => companyCache.set(c.company_name, c._id));
    }

    // --- Step 5: Build final contacts with guaranteed company_id ---
    const newContacts = contactBuffer.map(({ row, contactId, companyName }) => {
      return {
        contact_id: contactId,
        contact_source: row.contact_source || "",
        contact_create_date: row.contact_create_date || new Date(),
        salutation: row.salutation || "",
        first_name: row.first_name || "",
        last_name: row.last_name || "",
        gender: row.gender || "",
        job_title: row.job_title || "",
        job_seniority: row.job_seniority || "",
        job_function: row.job_function || "",
        designation: row.designation || "",
        profile: row.profile || "",
        contact_address_1: row.contact_address_1 || "",
        contact_address_2: row.contact_address_2 || "",
        contact_address_3: row.contact_address_3 || "",
        contact_city: row.contact_city || "",
        contact_pin: row.contact_pin || "",
        contact_state: row.contact_state || "",
        contact_region: row.contact_region || "",
        contact_country: row.contact_country || "",
        contact_std_isd_code: row.contact_std_isd_code || "",
        contact_location_tier: row.contact_location_tier || "",
        contact_direct_phone1: row.contact_direct_phone1 || "",
        contact_direct_phone2: row.contact_direct_phone2 || "",
        contact_extn_no: row.contact_extn_no || "",
        mobile_no: row.mobile_no || "",
        office_email_1: row.office_email_1 || "",
        office_email_2: row.office_email_2 || "",
        personal_email1: row.personal_email1 || "",
        personal_email2: row.personal_email2 || "",
        contact_linkedIn_profile: row.contact_linkedIn_profile || "",
        batchName: row.batchName || "default_batch",
        company_id: companyCache.get(companyName), //
      };
    });

    // --- Step 6: Insert contacts in bulk ---
    let insertedContacts = [];
    if (newContacts.length > 0) {
      insertedContacts = await Contact.insertMany(newContacts, {
        ordered: false,
      });
    }

    // Cleanup temp file
    fs.unlinkSync(req.file.path);

    return sendResponse(res, 201, "Batch insert successful", {
      companiesCreated: newCompanies.length,
      contactsCreated: insertedContacts.length,
      skippedContacts: existingContactIds.size,
    });
  } catch (err) {
    console.error("Batch insert error:", err);
    return sendError(next, err.message || "Batch insert failed", 500);
  }
});
const getAllData = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    // const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const limit = parseInt(req.query.limit);
    const skip = (page - 1) * limit;

    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;
    const search = filters.search;
    delete filters.search;

    // Build search filter if search param is present
    let searchFilter = {};
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      searchFilter = {
        $or: [
          { first_name: regex },
          { last_name: regex },
          { designation: regex },
          { office_email_1: regex },
          { office_email_2: regex },
          { mobile_no: regex },
          { contact_city: regex },
          { contact_state: regex },
          { contact_country: regex },
        ],
      };
    }

    // Combine filters and searchFilter
    const finalFilter = Object.keys(searchFilter).length
      ? { ...filters, ...searchFilter }
      : filters;

    const [total, data] = await Promise.all([
      Contact.countDocuments(finalFilter),
      Contact.find(finalFilter)
        .populate(
          "company_id",
          "company_name website industry company_phone1 company_phone2"
        )
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return sendResponse(res, 200, "Contacts fetched successfully", {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});

const updateData = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatePayload = req.body;
    const user = req.user;

    console.log(user, "user data");

    const existing = await Contact.findById(id);
    if (!existing) return sendError(next, "Contact not found", 404);

    // Validate company_id if provided
    if (updatePayload.company_id) {
      const company = await Company.findById(updatePayload.company_id);
      if (!company) return sendError(next, "Invalid company_id", 400);
    }

    //  Find fields which are changed
    const updatedFields = Object.keys(updatePayload).filter((field) => {
      return (
        String(existing[field] ?? "") !== String(updatePayload[field] ?? "")
      );
    });

    // Agar koi field change hi nahi hui to directly return
    if (updatedFields.length === 0) {
      return sendResponse(res, 200, "No changes detected", existing);
    }

    //  Save snapshot to ContactHistory
    await ContactHistory.create({
      contact_id: existing._id,
      snapshot: existing.toObject(), // old data snapshot
      updatedFields, // kaunse fields change hue
      updatedBy: {
        id: user._id,
        name: user.employeeName,
        email: user.email,
        employeeCode: user.employeeCode,
        role: user.role,
        mobile: user.mobile,
        location: user.location,
        designation: user.designation,
      },
      changeType: "update",
    });

    //  Update main Contact
    const updatedContact = await Contact.findByIdAndUpdate(id, updatePayload, {
      new: true,
      runValidators: true,
    }).populate("company_id", "company_name website industry"); // optional populate

    return sendResponse(
      res,
      200,
      "Contact updated successfully",
      updatedContact
    );
  } catch (err) {
    console.error("Update contact error:", err);
    return sendError(next, err.message || "Update failed", 500);
  }
});

export { batchCreateFromExcel, getAllData, updateData };
