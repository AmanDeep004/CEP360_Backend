import errorHandler from "../../utils/index.js";
import Company from "../../models/MasterDBModel/companyModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import CompanyHistory from "../../models/MasterDBModel/companyHistory.js";
import ContactHistory from "../../models/MasterDBModel/contactHistory.js";
import dndModel from "../../models/MasterDBModel/dndModel.js";
import engagementModel from "../../models/MasterDBModel/enagagementHistoryModel.js";
import xlsx from "xlsx";

const { asyncHandler, sendError, sendResponse } = errorHandler;

//controller for adding one record at a time
const createData = asyncHandler(async (req, res, next) => {
  try {
    const data = req.body;

    if (!data || !data.company_name) {
      return sendError(next, "Company name is required", 400);
    }
    if (!data.first_name && !data.last_name) {
      return sendError(next, "Contact name is required", 400);
    }

    let company = await Company.findOne({
      company_name: data.company_name,
    });

    if (!company) {
      company = await Company.create({
        company_name: data.company_name,
        industry: data.industry,
        website: data.website,
        company_phone1: data.company_phone1,
        company_phone2: data.company_phone2,
      });
    }

    // 🔍 Check for duplicate contact
    const duplicateContact = await Contact.findOne({
      $and: [
        { office_email_1: data.office_email_1 },
        { mobile_no: data.mobile_no },
      ].filter((cond) => Object.values(cond)[0]), // remove empty conditions
    });

    if (duplicateContact) {
      return sendResponse(
        res,
        200,
        "Contact already exists, returning existing record",
        duplicateContact
      );
    }

    const contact = await Contact.create({
      contact_id: data.contact_id,
      salutation: data.salutation,
      first_name: data.first_name,
      last_name: data.last_name,
      job_title: data.job_title,
      designation: data.designation,
      mobile_no: data.mobile_no,
      office_email_1: data.office_email_1,
      office_email_2: data.office_email_2,
      contact_city: data.contact_city,
      contact_state: data.contact_state,
      contact_country: data.contact_country,
      company_id: company._id, // link company
    });

    return sendResponse(res, 201, "Company & Contact processed successfully", {
      company,
      contact,
    });
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

//function to check company and contact and create if not exists
const processCompanyContact = async (data) => {
  let company = await Company.findOne({
    $or: [
      { company_name: new RegExp(`^${data.company_name}$`, "i") },
      data.website ? { website: data.website } : {},
    ],
  });

  let companyNew = false;
  if (!company) {
    company = await Company.create({
      company_id_kestone: data.company_id_kestone,
      affinity_id_dell: data.affinity_id_dell,
      company_id_google: data.company_id_google,
      company_source: data.company_source,
      company_name: data.company_name,
      year_founded: data.year_founded,
      turnover_range: data.turnover_range,
      employees_range: data.employees_range,
      industry: data.industry,
      sub_industry: data.sub_industry,
      company_segment: data.company_segment,
      website: data.website,
      company_linkedIn_profile: data.company_linkedIn_profile,
      company_phone1: data.company_phone1,
      company_phone2: data.company_phone2,
    });
    companyNew = true;
  }

  let contact = await Contact.findOne({
    $or: [
      { contact_id: data.contact_id },
      data.office_email_1 ? { office_email_1: data.office_email_1 } : {},
      data.mobile_no ? { mobile_no: data.mobile_no } : {},
    ],
  });

  let contactNew = false;
  if (!contact) {
    contact = await Contact.create({
      contact_id: data.contact_id,
      contact_source: data.contact_source,
      contact_create_date: data.contact_create_date,
      salutation: data.salutation,
      first_name: data.first_name,
      last_name: data.last_name,
      gender: data.gender,
      job_title: data.job_title,
      job_seniority: data.job_seniority,
      job_function: data.job_function,
      designation: data.designation,
      profile: data.profile,
      contact_address_1: data.contact_address_1,
      contact_address_2: data.contact_address_2,
      contact_address_3: data.contact_address_3,
      contact_city: data.contact_city,
      contact_pin: data.contact_pin,
      contact_state: data.contact_state,
      contact_region: data.contact_region,
      contact_country: data.contact_country,
      contact_std_isd_code: data.contact_std_isd_code,
      contact_location_tier: data.contact_location_tier,
      contact_direct_phone1: data.contact_direct_phone1,
      contact_direct_phone2: data.contact_direct_phone2,
      contact_extn_no: data.contact_extn_no,
      mobile_no: data.mobile_no,
      office_email_1: data.office_email_1,
      office_email_2: data.office_email_2,
      personal_email1: data.personal_email1,
      personal_email2: data.personal_email2,
      contact_linkedIn_profile: data.contact_linkedIn_profile,
      company_id: company._id,
    });
    contactNew = true;
  }

  return {
    company: { id: company._id, name: company.company_name, isNew: companyNew },
    contact: {
      id: contact._id,
      name: `${contact.first_name || ""} ${contact.last_name || ""}`.trim(),
      email: contact.office_email_1,
      isNew: contactNew,
    },
  };
};

const batchCreateData = asyncHandler(async (req, res, next) => {
  try {
    const { data } = req.body;

    if (!Array.isArray(data)) {
      return sendError(next, "Data must be an array", 400);
    }

    const results = {
      success: [],
      failed: [],
    };

    for (let i = 0; i < data.length; i++) {
      try {
        const processed = await processCompanyContact(data[i]);
        results.success.push({ index: i, ...processed });
      } catch (err) {
        results.failed.push({ index: i, error: err.message, raw: data[i] });
      }
    }

    return sendResponse(res, 200, "Batch insert completed", results);
  } catch (err) {
    return sendError(next, err.message || "Batch insert failed", 500);
  }
});

const batchCreateFromExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(next, "Excel/CSV file is required", 400);
    }

    // Detect file extension
    const ext = req.file.originalname.split(".").pop().toLowerCase();

    let rows = [];
    if (ext === "csv") {
      // Parse CSV
      const workbook = xlsx.readFile(req.file.path, {
        type: "file",
        raw: false,
      });
      const sheetName = workbook.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Parse Excel (XLSX / XLS)
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    // Process rows
    const results = { success: [], failed: [] };

    for (let i = 0; i < rows.length; i++) {
      try {
        const processed = await processCompanyContact(rows[i]);
        results.success.push({ index: i, ...processed });
      } catch (err) {
        results.failed.push({ index: i, error: err.message, raw: rows[i] });
      }
    }

    return sendResponse(res, 200, "Excel/CSV batch insert completed", results);
  } catch (err) {
    return sendError(next, err.message || "Batch insert failed", 500);
  }
});

// const getAllData = asyncHandler(async (req, res, next) => {
//   try {
//     // const { type } = req.params;
//     // const page = parseInt(req.query.page) || 1;
//     // const limit = Math.min(parseInt(req.query.limit) || 50, 500); // safety cap
//     // const skip = (page - 1) * limit;

//     // let model;
//     // switch (type) {
//     //   case "company":
//     //     model = Company;
//     //     break;
//     //   case "contact":
//     //     model = Contact;
//     //     break;
//     //   case "dnd":
//     //     model = DndDetail;
//     //     break;
//     //   case "engagement":
//     //     model = EngagementHistory;
//     //     break;
//     //   default:
//     //     return sendError(next, "Invalid type", 400);
//     // }

//     // // Build filter dynamically (if any query params provided)
//     // const filters = { ...req.query };
//     // delete filters.page;
//     // delete filters.limit;

//     // const [total, data] = await Promise.all([
//     //   model.countDocuments(filters),
//     //   model.find(filters).skip(skip).limit(limit).lean(),
//     // ]);

//     // return sendResponse(res, 200, `${type} fetched successfully`, {
//     //   total,
//     //   page,
//     //   limit,
//     //   totalPages: Math.ceil(total / limit),
//     //   data,
//     // });
//     return sendResponse(res, 200, "fetched successfully", getAllData);
//   } catch (err) {
//     return sendError(next, err.message || "Server error", 500);
//   }
// });

// const getDataById = asyncHandler(async (req, res, next) => {
//   try {
//     // const { type, id } = req.params;

//     // let model;
//     // switch (type) {
//     //   case "company":
//     //     model = Company;
//     //     break;
//     //   case "contact":
//     //     model = Contact;
//     //     break;
//     //   case "dnd":
//     //     model = DndDetail;
//     //     break;
//     //   case "engagement":
//     //     model = EngagementHistory;
//     //     break;
//     //   default:
//     //     return sendError(next, "Invalid type", 400);
//     // }

//     // const item = await model.findById(id).lean();
//     // if (!item) return sendError(next, `${type} not found`, 404);
//     // return sendResponse(res, 200, `${type} fetched successfully`, item);
//     return sendResponse(res, 200, "fetched successfully", "getDataById");
//   } catch (err) {
//     return sendError(next, err.message || "Server error", 500);
//   }
// });

// const deleteDataById = asyncHandler(async (req, res, next) => {
//   try {
//     // const { type, id } = req.params;

//     // let model;
//     // switch (type) {
//     //   case "company":
//     //     model = Company;
//     //     break;
//     //   case "contact":
//     //     model = Contact;
//     //     break;
//     //   case "dnd":
//     //     model = DndDetail;
//     //     break;
//     //   case "engagement":
//     //     model = EngagementHistory;
//     //     break;
//     //   default:
//     //     return sendError(next, "Invalid type", 400);
//     // }

//     // const deleted = await model.findByIdAndDelete(id);
//     // if (!deleted) return sendError(next, `${type} not found`, 404);

//     // return sendResponse(res, 200, `${type} deleted successfully`, deleted);
//     return sendResponse(res, 200, "deleted successflly", "deleteDataById");
//   } catch (err) {
//     return sendError(next, err.message || "Server error", 500);
//   }
// });

// Update
const updateData = asyncHandler(async (req, res, next) => {
  try {
    const { type, id } = req.params;
    const updateData = req.body;
    const userId = req.user?._id;

    let model, HistoryModel;
    if (type === "company") {
      model = Company;
      HistoryModel = CompanyHistory;
    } else if (type === "contact") {
      model = Contact;
      HistoryModel = ContactHistory;
    } else return sendError(next, "Invalid type", 400);

    const existing = await model.findById(id);
    if (!existing) return sendError(next, `${type} not found`, 404);

    const updatedFields = Object.keys(updateData).filter(
      (f) => existing[f] !== updateData[f]
    );
    await HistoryModel.create({
      [`${type}_id`]: existing._id,
      snapshot: existing.toObject(),
      updatedFields,
      updatedBy: userId,
      changeType: "update",
    });

    const updated = await model.findByIdAndUpdate(id, updateData, {
      new: true,
    });
    return sendResponse(res, 200, `${type} updated successfully`, updated);
  } catch (err) {
    return sendError(next, err.message || "Update failed", 500);
  }
});

// Delete
const deleteData = asyncHandler(async (req, res, next) => {
  try {
    const { type, id } = req.params;
    const userId = req.user?._id;

    let model, HistoryModel;
    if (type === "company") {
      model = Company;
      HistoryModel = CompanyHistory;
    } else if (type === "contact") {
      model = Contact;
      HistoryModel = ContactHistory;
    } else return sendError(next, "Invalid type", 400);

    const existing = await model.findById(id);
    if (!existing) return sendError(next, `${type} not found`, 404);

    await HistoryModel.create({
      [`${type}_id`]: existing._id,
      snapshot: existing.toObject(),
      updatedFields: [],
      updatedBy: userId,
      changeType: "delete",
    });

    await model.findByIdAndDelete(id);
    return sendResponse(res, 200, `${type} deleted successfully`, existing);
  } catch (err) {
    return sendError(next, err.message || "Delete failed", 500);
  }
});

const getAllData = asyncHandler(async (req, res, next) => {
  try {
    const { type } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const skip = (page - 1) * limit;

    let model;
    if (type === "company") model = Company;
    else if (type === "contact") model = Contact;
    else return sendError(next, "Invalid type", 400);

    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;

    const [total, data] = await Promise.all([
      model.countDocuments(filters),
      model.find(filters).skip(skip).limit(limit).lean(),
    ]);

    return sendResponse(res, 200, `${type} fetched successfully`, {
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

const getDataById = asyncHandler(async (req, res, next) => {
  try {
    const { type, id } = req.params;
    let model;
    if (type === "company") model = Company;
    else if (type === "contact") model = Contact;
    else return sendError(next, "Invalid type", 400);

    const item = await model.findById(id).lean();
    if (!item) return sendError(next, `${type} not found`, 404);

    return sendResponse(res, 200, `${type} fetched successfully`, item);
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});

export {
  createData,
  batchCreateData,
  batchCreateFromExcel,
  updateData,
  getAllData,
  deleteData,
  getDataById,
};
