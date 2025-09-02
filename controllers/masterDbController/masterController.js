import errorHandler from "../../utils/index.js";
import Company from "../../models/MasterDBModel/companyModel.js";
import Contact from "../../models/MasterDBModel/contactModel.js";
import CompanyHistory from "../../models/MasterDBModel/companyHistory.js";
import ContactHistory from "../../models/MasterDBModel/contactHistory.js";
import dndModel from "../../models/MasterDBModel/dndModel.js";
import engagementModel from "../../models/MasterDBModel/enagagementHistoryModel.js";
import xlsx from "xlsx";
import fs from "fs";
import csv from "fast-csv";

const { asyncHandler, sendError, sendResponse } = errorHandler;

const BATCH_SIZE = 500;

const processBatch = async (batch, results) => {
  const companyOps = [];
  const contactOps = [];

  batch.forEach((data) => {
    if (!data.company_name) return;

    companyOps.push({
      updateOne: {
        filter: {
          $or: [
            { company_name: new RegExp(`^${data.company_name}$`, "i") },
            data.website ? { website: data.website } : {},
          ].filter((c) => Object.keys(c).length > 0),
        },
        update: { $setOnInsert: { ...data } },
        upsert: true,
      },
    });

    if (
      data.first_name ||
      data.last_name ||
      data.mobile_no ||
      data.office_email_1
    ) {
      contactOps.push({
        updateOne: {
          filter: {
            $or: [
              data.contact_id ? { contact_id: data.contact_id } : {},
              data.office_email_1
                ? { office_email_1: data.office_email_1 }
                : {},
              data.mobile_no ? { mobile_no: data.mobile_no } : {},
            ].filter((c) => Object.keys(c).length > 0),
          },
          update: { $setOnInsert: { ...data } },
          upsert: true,
        },
      });
    }
  });

  if (companyOps.length > 0) {
    const companyResult = await Company.bulkWrite(companyOps, {
      ordered: false,
    });
    results.companiesInserted += companyResult.upsertedCount || 0;
  }

  if (contactOps.length > 0) {
    const contactResult = await Contact.bulkWrite(contactOps, {
      ordered: false,
    });
    results.contactsInserted += contactResult.upsertedCount || 0;
  }
};

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

    // duplicate contact check
    const duplicateContact = await Contact.findOne({
      $and: [
        data.office_email_1 ? { office_email_1: data.office_email_1 } : {},
        data.mobile_no ? { mobile_no: data.mobile_no } : {},
      ].filter((c) => Object.keys(c).length > 0),
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
      company_id: company._id,
      batchName: data.batchName,
    });

    return sendResponse(res, 201, "Company & Contact processed successfully", {
      company,
      contact,
    });
  } catch (err) {
    return sendError(next, err.message || "Server error", 500);
  }
});

const processCompanyContact = async (data) => {
  let company = await Company.findOne({
    $or: [
      { company_name: new RegExp(`^${data.company_name}$`, "i") },
      data.website ? { website: data.website } : {},
    ].filter((c) => Object.keys(c).length > 0),
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
      data.contact_id ? { contact_id: data.contact_id } : {},
      data.office_email_1 ? { office_email_1: data.office_email_1 } : {},
      data.mobile_no ? { mobile_no: data.mobile_no } : {},
    ].filter((c) => Object.keys(c).length > 0),
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
      batchName: data.batchName,
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

const batchCreateFromExcelOld = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) return sendError(next, "CSV file is required", 400);

    let batch = [];
    let results = { companiesInserted: 0, contactsInserted: 0, failed: 0 };
    let rowCount = 0;

    await new Promise((resolve, reject) => {
      const stream = fs
        .createReadStream(req.file.path)
        .pipe(csv.parse({ headers: true }));

      stream
        .on("error", (err) => reject(err))
        .on("data", async (row) => {
          rowCount++;
          batch.push(row);

          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            try {
              await processBatch(batch, results);
              batch = [];
              stream.resume();
            } catch (err) {
              reject(err);
            }
          }
        })
        .on("end", async () => {
          try {
            if (batch.length > 0) {
              await processBatch(batch, results);
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });

    fs.unlinkSync(req.file.path);

    return sendResponse(res, 200, "CSV batch insert completed", {
      ...results,
      totalProcessed: rowCount,
    });
  } catch (err) {
    return sendError(next, err.message || "Batch insert failed", 500);
  }
});
const processBatchOptimized = async (batch, results) => {
  const companyOps = [];
  const contactOps = [];
  const processedCompanies = new Map(); // To track companies in current batch

  // First pass: prepare company operations
  for (const data of batch) {
    if (!data.company_name?.trim()) continue;

    const companyName = data.company_name.trim();

    if (!processedCompanies.has(companyName)) {
      companyOps.push({
        updateOne: {
          filter: {
            $or: [
              { company_name: new RegExp(`^${companyName}$`, "i") },
              data.website?.trim() ? { website: data.website.trim() } : null,
            ].filter(Boolean),
          },
          update: {
            $setOnInsert: {
              company_id_kestone: data.company_id_kestone?.trim(),
              affinity_id_dell: data.affinity_id_dell?.trim(),
              company_id_google: data.company_id_google?.trim(),
              company_source: data.company_source?.trim(),
              company_name: companyName,
              year_founded: data.year_founded?.trim(),
              turnover_range: data.turnover_range?.trim(),
              employees_range: data.employees_range?.trim(),
              industry: data.industry?.trim(),
              sub_industry: data.sub_industry?.trim(),
              company_segment: data.company_segment?.trim(),
              website: data.website?.trim(),
              company_linkedIn_profile: data.company_linkedIn_profile?.trim(),
              company_phone1: data.company_phone1?.trim(),
              company_phone2: data.company_phone2?.trim(),
            },
          },
          upsert: true,
        },
      });
      processedCompanies.set(companyName, true);
    }
  }

  // Execute company operations
  let companyResult;
  if (companyOps.length > 0) {
    companyResult = await Company.bulkWrite(companyOps, { ordered: false });
    results.companiesInserted += companyResult.upsertedCount || 0;
  }

  // Get all companies for contact linking
  const companyNames = Array.from(processedCompanies.keys());
  const companies = await Company.find({
    company_name: {
      $in: companyNames.map((name) => new RegExp(`^${name}$`, "i")),
    },
  });

  const companyMap = new Map();
  companies.forEach((company) => {
    companyMap.set(company.company_name.toLowerCase(), company._id);
  });

  // Second pass: prepare contact operations
  for (const data of batch) {
    if (!data.company_name?.trim()) continue;
    if (
      !data.first_name?.trim() &&
      !data.last_name?.trim() &&
      !data.mobile_no?.trim() &&
      !data.office_email_1?.trim()
    )
      continue;

    const companyId = companyMap.get(data.company_name.trim().toLowerCase());
    if (!companyId) continue;

    // Build filter conditions
    const filterConditions = [];
    if (data.contact_id?.trim()) {
      filterConditions.push({ contact_id: data.contact_id.trim() });
    }
    if (data.office_email_1?.trim()) {
      filterConditions.push({
        office_email_1: data.office_email_1.trim().toLowerCase(),
      });
    }
    if (data.mobile_no?.trim()) {
      filterConditions.push({ mobile_no: data.mobile_no.trim() });
    }

    if (filterConditions.length === 0) continue;

    // Generate contact_id if not provided
    let contactId = data.contact_id?.trim();
    if (!contactId) {
      const randomNum = Math.floor(Math.random() * 10000);
      contactId = `CONT${String(randomNum).padStart(4, "0")}`;
    }

    contactOps.push({
      updateOne: {
        filter: { $or: filterConditions },
        update: {
          $setOnInsert: {
            contact_id: contactId,
            contact_source: data.contact_source?.trim(),
            contact_create_date: data.contact_create_date
              ? new Date(data.contact_create_date)
              : undefined,
            salutation: data.salutation?.trim(),
            first_name: data.first_name?.trim(),
            last_name: data.last_name?.trim(),
            gender: data.gender?.trim(),
            job_title: data.job_title?.trim(),
            job_seniority: data.job_seniority?.trim(),
            job_function: data.job_function?.trim(),
            designation: data.designation?.trim(),
            profile: data.profile?.trim(),
            contact_address_1: data.contact_address_1?.trim(),
            contact_address_2: data.contact_address_2?.trim(),
            contact_address_3: data.contact_address_3?.trim(),
            contact_city: data.contact_city?.trim(),
            contact_pin: data.contact_pin?.trim(),
            contact_state: data.contact_state?.trim(),
            contact_region: data.contact_region?.trim(),
            contact_country: data.contact_country?.trim(),
            contact_std_isd_code: data.contact_std_isd_code?.trim(),
            contact_location_tier: data.contact_location_tier?.trim(),
            contact_direct_phone1: data.contact_direct_phone1?.trim(),
            contact_direct_phone2: data.contact_direct_phone2?.trim(),
            contact_extn_no: data.contact_extn_no?.trim(),
            mobile_no: data.mobile_no?.trim(),
            office_email_1: data.office_email_1?.trim()?.toLowerCase(),
            office_email_2: data.office_email_2?.trim()?.toLowerCase(),
            personal_email1: data.personal_email1?.trim()?.toLowerCase(),
            personal_email2: data.personal_email2?.trim()?.toLowerCase(),
            contact_linkedIn_profile: data.contact_linkedIn_profile?.trim(),
            company_id: companyId,
            batchName: data.batchName?.trim() || "csv-import",
          },
        },
        upsert: true,
      },
    });
  }

  // Execute contact operations
  if (contactOps.length > 0) {
    const contactResult = await Contact.bulkWrite(contactOps, {
      ordered: false,
    });
    results.contactsInserted += contactResult.upsertedCount || 0;
  }
};

// Add field mapping function
const mapCsvFields = (row) => {
  const keys = Object.keys(row);
  const mapped = {};

  // Try to auto-map common field variations
  keys.forEach((key) => {
    const lowerKey = key.toLowerCase().trim();

    // Company mappings
    if (lowerKey.includes("company") && lowerKey.includes("name")) {
      mapped.company_name = row[key];
    } else if (lowerKey === "organization" || lowerKey === "firm") {
      mapped.company_name = row[key];
    }

    // Name mappings
    if (lowerKey.includes("first") && lowerKey.includes("name")) {
      mapped.first_name = row[key];
    } else if (lowerKey === "firstname") {
      mapped.first_name = row[key];
    }

    if (lowerKey.includes("last") && lowerKey.includes("name")) {
      mapped.last_name = row[key];
    } else if (lowerKey === "lastname" || lowerKey === "surname") {
      mapped.last_name = row[key];
    }

    // Email mappings
    if (lowerKey.includes("email") && !lowerKey.includes("personal")) {
      if (!mapped.office_email_1) {
        mapped.office_email_1 = row[key];
      } else {
        mapped.office_email_2 = row[key];
      }
    }

    // Phone mappings
    if (lowerKey.includes("mobile") || lowerKey.includes("phone")) {
      mapped.mobile_no = row[key];
    }

    // Contact ID mappings
    if (lowerKey.includes("contact") && lowerKey.includes("id")) {
      mapped.contact_id = row[key];
    }

    // Industry mappings
    if (lowerKey === "industry" || lowerKey.includes("sector")) {
      mapped.industry = row[key];
    }

    // Job title mappings
    if (lowerKey.includes("job") && lowerKey.includes("title")) {
      mapped.job_title = row[key];
    } else if (lowerKey === "position" || lowerKey === "role") {
      mapped.job_title = row[key];
    }

    // Location mappings
    if (lowerKey === "city") mapped.contact_city = row[key];
    if (lowerKey === "state") mapped.contact_state = row[key];
    if (lowerKey === "country") mapped.contact_country = row[key];

    // Website mappings
    if (lowerKey === "website" || lowerKey.includes("url")) {
      mapped.website = row[key];
    }
  });

  return mapped;
};

const batchCreateFromExcel = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) return sendError(next, "CSV file is required", 400);

    let batch = [];
    let results = { companiesInserted: 0, contactsInserted: 0, failed: 0 };
    let rowCount = 0;
    let headers = [];

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(req.file.path).pipe(
        csv.parse({
          headers: true,
          skipEmptyLines: true,
          trim: true,
          discardUnmappedColumns: false,
        })
      );

      stream
        .on("headers", (headerList) => {
          headers = headerList;
          console.log("CSV Headers detected:", headers);
          console.log("Total headers found:", headers.length);
        })
        .on("error", (err) => reject(err))
        .on("data", async (row) => {
          rowCount++;

          // Map CSV fields to your expected field names
          const mappedRow = mapCsvFields(row);

          // Debug: log first few rows
          if (rowCount <= 3) {
            console.log(`Row ${rowCount} original keys:`, Object.keys(row));
            console.log(`Row ${rowCount} mapped data:`, mappedRow);
          }

          batch.push(mappedRow);

          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            try {
              await processBatchOptimized(batch, results);
              console.log(
                `Processed batch of ${batch.length}. Results so far:`,
                results
              );
              batch = [];
              stream.resume();
            } catch (err) {
              console.error("Batch processing error:", err);
              results.failed += batch.length;
              batch = [];
              stream.resume();
            }
          }
        })
        .on("end", async () => {
          try {
            if (batch.length > 0) {
              await processBatchOptimized(batch, results);
              console.log(`Final batch processed. Final results:`, results);
            }
            resolve();
          } catch (err) {
            console.error("Final batch error:", err);
            results.failed += batch.length;
            resolve();
          }
        });
    });

    // Clean up uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch (err) {
      console.log("File cleanup error:", err.message);
    }

    return sendResponse(res, 200, "CSV batch insert completed", {
      ...results,
      totalProcessed: rowCount,
      csvHeaders: headers,
      successRate: `${(
        ((results.companiesInserted + results.contactsInserted) / rowCount) *
        100
      ).toFixed(2)}%`,
    });
  } catch (err) {
    console.error("Batch insert error:", err);
    return sendError(next, err.message || "Batch insert failed", 500);
  }
});

//upload and process json array
const batchCreateData = asyncHandler(async (req, res, next) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data))
      return sendError(next, "Data must be an array", 400);

    const results = { success: [], failed: [] };
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

// const updateData = asyncHandler(async (req, res, next) => {
//   try {
//     const { id } = req.params;
//     const updateData = req.body;
//     const userId = req.user?._id;

//     let model, HistoryModel, existing;
//     existing = await Company.findById(id);
//     if (existing) {
//       model = Company;
//       HistoryModel = CompanyHistory;
//     } else {
//       existing = await Contact.findById(id);
//       if (existing) {
//         model = Contact;
//         HistoryModel = ContactHistory;

//         if (updateData.company_id) {
//           const company = await Company.findById(updateData.company_id);
//           if (!company) return sendError(next, "Invalid company_id", 400);
//         }
//       }
//     }

//     if (!existing) return sendError(next, "Record not found", 404);

//     // track updated fields
//     const updatedFields = Object.keys(updateData).filter(
//       (f) => String(existing[f]) !== String(updateData[f])
//     );

//     // save snapshot in history
//     await HistoryModel.create({
//       ref_id: existing._id, // universal reference
//       snapshot: existing.toObject(),
//       updatedFields,
//       updatedBy: userId,
//       changeType: "update",
//     });

//     // perform update
//     const updated = await model.findByIdAndUpdate(id, updateData, {
//       new: true,
//     });
//     return sendResponse(res, 200, "Record updated successfully", updated);
//   } catch (err) {
//     return sendError(next, err.message || "Update failed", 500);
//   }
// });

// //for deleting the data
// const deleteData = asyncHandler(async (req, res, next) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user?._id;

//     let model, HistoryModel, existing;
//     existing = await Contact.findById(id);
//     if (existing) {
//       model = Company;
//       HistoryModel = ContactHistory;

//       // prevent deleting company with contacts
//       const hasContacts = await Contact.findOne({ company_id: id });
//       if (hasContacts) return sendError(next, "Delete contacts first", 400);
//     } else {
//       existing = await Contact.findById(id);
//       if (existing) {
//         model = Contact;
//         HistoryModel = ContactHistory;
//       }
//     }

//     if (!existing) return sendError(next, "Record not found", 404);

//     // save snapshot in history
//     await HistoryModel.create({
//       ref_id: existing._id,
//       snapshot: existing.toObject(),
//       updatedFields: [],
//       updatedBy: userId,
//       changeType: "delete",
//     });

//     await model.findByIdAndDelete(id);
//     return sendResponse(res, 200, "Record deleted successfully", existing);
//   } catch (err) {
//     return sendError(next, err.message || "Delete failed", 500);
//   }
// });

//for retreiving all data

const updateData = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params; // contact id
    const updateData = req.body;
    const user = req.user; // logged in user

    // 🔍 Check contact exists
    const existing = await Contact.findById(id);
    if (!existing) return sendError(next, "Contact not found", 404);

    // 🔍 Validate company_id if provided
    if (updateData.company_id) {
      const company = await Company.findById(updateData.company_id);
      if (!company) return sendError(next, "Invalid company_id", 400);
    }

    // Track updated fields
    const updatedFields = Object.keys(updateData).filter(
      (field) => String(existing[field]) !== String(updateData[field])
    );

    // Save snapshot in history
    await ContactHistory.create({
      contact_id: existing._id,
      snapshot: existing.toObject(),
      updatedFields,
      updatedBy: {
        _id: user._id,
        name: user.full_name,
        email: user.email,
      },
      changeType: "update",
    });

    // Update main contact
    const updated = await Contact.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    return sendResponse(res, 200, "Contact updated successfully", updated);
  } catch (err) {
    return sendError(next, err.message || "Update failed", 500);
  }
});
const deleteData = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params; // contact id
    const user = req.user;

    // 🔍 Check contact exists
    const existing = await Contact.findById(id);
    if (!existing) return sendError(next, "Contact not found", 404);

    // Save snapshot in history
    await ContactHistory.create({
      contact_id: existing._id,
      snapshot: existing.toObject(),
      updatedFields: [],
      updatedBy: {
        _id: user._id,
        name: user.full_name,
        email: user.email,
      },
      changeType: "delete",
    });

    // Delete from main collection
    await Contact.findByIdAndDelete(id);

    return sendResponse(res, 200, "Contact deleted successfully", existing);
  } catch (err) {
    return sendError(next, err.message || "Delete failed", 500);
  }
});

// find all db data with pagination and filters
const getAllDataOld = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const skip = (page - 1) * limit;

    const filters = { ...req.query };
    delete filters.page;
    delete filters.limit;

    const [total, data] = await Promise.all([
      Contact.countDocuments(filters),
      Contact.find(filters)
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

const getAllData = asyncHandler(async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
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

//for getting data by id
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

const companyDesignationWiseDataCount = asyncHandler(async (req, res, next) => {
  try {
    const result = await Contact.aggregate([
      {
        $group: {
          _id: "$designation",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          designation: "$_id",
          count: 1,
          _id: 0,
        },
      },
    ]);

    return sendResponse(
      res,
      200,
      "Designation-wise contact count fetched",
      result
    );
  } catch (err) {
    return sendError(next, err.message || "Fetch failed", 500);
  }
});

export {
  createData,
  companyDesignationWiseDataCount,
  batchCreateData,
  batchCreateFromExcel,
  updateData,
  getAllData,
  deleteData,
  getDataById,
};
