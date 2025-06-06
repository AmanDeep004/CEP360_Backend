import { check, param, body } from 'express-validator';

const validations = {
    auth: {
        register: [
            check("employeeCode", "Employee Code is required").not().isEmpty(),
            check("password", "Password is required").not().isEmpty(),
            check("role", "Role is required").not().isEmpty(),
            check("email", "Invalid email").isEmail(),
            check("name", "Name is required").not().isEmpty(),
            check("status", "Status is required").not().isEmpty(),
        ],

        login: [
            check("email", "Invalid email").isEmail(),
            check("password", "Password is required").not().isEmpty(),
        ],
    },
    campaign: {
        add: [
            check("name", "Program Name is required").not().isEmpty(),
            check("type", "Program Type is required").not().isEmpty(),
            check("category", "Program Category is required").not().isEmpty(),
            check("startDate", "Start Date is required").not().isEmpty(),
            check("endDate", "End Date is required").not().isEmpty(),
            check("campaignManagerId", "Program Manager ID is required").isMongoId(),
            check("executedAt", "Program Executed At is required").not().isEmpty(),
            check("status", "Program Status is required").not().isEmpty(),
            check("brandName", "Brand Name is required").not().isEmpty(),
            check("clientName", "Client Name is required").not().isEmpty(),
            check("clientEmail", "Client Email is required").isEmail(),
            check("clientContact", "Client Contact is required").not().isEmpty(),
        ],
        update: [
            check("campaignId", "Invalid ID").isMongoId(),
        ],
        delete: [
            check("campaignId", "Invalid ID").isMongoId(),
        ],
        get: [
            check("campaignId", "Invalid ID").isMongoId(),
        ],
        getAll: [],
        assignContacts: [
            check('campaignId').isMongoId().withMessage('Invalid campaign ID'),
            check('agentId').isMongoId().withMessage('Invalid agent ID'),
            check('contacts').isArray().withMessage('Contacts should be an array'),
            check('contacts.*').isMongoId().withMessage('Invalid contact ID')
        ],
        fetchContacts: [
            check('campaignId').isMongoId().withMessage('Invalid campaign ID'),
        ],
        logCall: [
            param('contactId').isMongoId().withMessage('Invalid contact ID'),
            check('callStatus').isString().withMessage('Call status must be a string'),
        ],
        updateContact: [
            param('contactId').isMongoId().withMessage('Invalid contact ID'),
            body('email').isEmail().withMessage('Invalid email'),
            body('name').isString().withMessage('Name must be a string'),
            body('phone').isMobilePhone().withMessage('Invalid phone number'),
        ],
        getCallLogs: [
            param('phoneNumber').isMobilePhone().withMessage('Invalid phone number'),
        ],
    },
    user: {
        add: [
            check("employeeCode", "Employee Code is required").not().isEmpty(),
            check("password", "Password is required").not().isEmpty(),
            check("role", "Role is required").not().isEmpty(),
            check("email", "Invalid email").isEmail(),
            check("name", "Name is required").not().isEmpty(),
            check("type", "Type is required").not().isEmpty(),
            check("employeeBase", "Employee Base is required").not().isEmpty(),
            check("programName", "Program Name is required").not().isEmpty(),
            check("programType", "Program Type is required").not().isEmpty(),
            check("programManager", "Program Manager is required").not().isEmpty(),
            check("location", "Location is required").not().isEmpty(),
            check("status", "Status is required").not().isEmpty(),
            check("doj", "Date of Joining is required").not().isEmpty(),
        ],
        update: [
            check("role", "Role is required").not().isEmpty(),
            check("email", "Invalid email").isEmail(),
            check("name", "Name is required").not().isEmpty(),
        ],
        delete: [
            check("id", "Invalid ID").isMongoId(),
        ],
        get: [
            check("id", "Invalid ID").isMongoId(),
        ],
        getAll: [],
    },

}

export default validations;
