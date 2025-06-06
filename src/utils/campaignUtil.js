import fs from 'fs';
import multer from 'multer';
import { REQUIRED_COLUMNS as requiredColumns, CAMPAIGN_ID } from "./constants.js";
import dotenv from 'dotenv';

dotenv.config();

export const validateCSVColumns = (headers) => {
    const missingColumns = Object.values(requiredColumns).filter(column => !headers.includes(column));
    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }
};

export const mapCSVToSchema = (row) => {
    const email = row[requiredColumns.EMAIL_ID];
    const phoneNumber = row[requiredColumns.PHONE_NUMBER];

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`Invalid email: ${email}`);
    }

    if (phoneNumber && !/^\d{10}$/.test(phoneNumber)) {
        throw new Error(`Invalid phone number: ${phoneNumber}`);
    }

    return {
        phoneNumber: phoneNumber,
        name: row[requiredColumns.NAME],
        emailId: email,
        companyName: row[requiredColumns.COMPANY_NAME],
        equipmentNumber: row[requiredColumns.EQUIPMENT_NUMBER],
        customerTotalEquipments: row[requiredColumns.CUSTOMER_TOTAL_EQUIPMENTS],
        customerCode: row[requiredColumns.CUSTOMER_CODE],
        branch: row[requiredColumns.BRANCH],
        contractEndDate: row[requiredColumns.CONTRACT_END_DATE],
        contractType: row[requiredColumns.CONTRACT_TYPE],
        presentAmcValue: parseFloat(row[requiredColumns.PRESENT_AMC_VALUE]),
        pd: row[requiredColumns.PD],
        salesPerson: row[requiredColumns.SALES_PERSON],
        serviceLeader: row[requiredColumns.SERVICE_LEADER],
        aheadConnection: row[requiredColumns.AHEAD_CONNECTION],
        paymentTerms: row[requiredColumns.PAYMENT_TERMS],
        campaignId: row[CAMPAIGN_ID]
    };
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

export const upload = multer({ storage });