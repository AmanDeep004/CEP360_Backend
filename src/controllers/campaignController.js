import express from 'express';
import { upload } from '../utils/campaignUtil.js';
import validations from '../middlewares/validation.js';
import campaignService from '../services/campaignService.js';
import { authorize } from '../middlewares/authMiddleware.js';
import validateRequest from '../middlewares/validateRequest.js';
import { ADMIN, PROGRAM_MANAGER, AGENT, RESOURCE_MANAGER, DATABASE_MANAGER } from '../utils/constants.js';

const router = express.Router();

router.post('/create', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    validations.campaign.add, 
    validateRequest, 
    async (req, res) => {
    try {
        const campaignData = req.body;
        const campaignManagerId = req.user.id;

        if (campaignManagerId !== campaignData.campaignManagerId) {
            return res.status(400).json({ success: false, message: 'You are not authorized to create campaign for another manager' });
        }

        const campaign = await campaignService.createCampaign(campaignData);
        res.status(201).json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.patch('/update/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    validations.campaign.update, 
    validateRequest, 
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        const data = req.body;
        const campaign = await campaignService.updateCampaign(campaignId, data);
        res.status(200).json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/delete/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    validations.campaign.delete, 
    validateRequest, 
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        await campaignService.deleteCampaign(campaignId);
        res.status(200).json({ success: true, message: 'Campaign deleted successfully' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/get/:campaignId', 
    validations.campaign.get, 
    validateRequest, 
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        const campaign = await campaignService.getCampaign(campaignId);
        res.status(200).json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getAll',
    validations.campaign.getAll, 
    validateRequest, 
    async (req, res) => {
    try {
        const role = req.user.role;
        const userId = req.user.id;

        const campaigns = await campaignService.getAllCampaignsByUser(userId, role);
        res.status(200).json({ success: true, campaigns });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/contact/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;
        const contact = await campaignService.getContactById(contactId);
        res.status(200).json({ success: true, contact });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.post('/addResource/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { resourceIds } = req.body;
        const campaign = await campaignService.addResource(campaignId, resourceIds);
        res.status(200).json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.post('/releaseResource/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { resourceIds } = req.body;
        const campaign = await campaignService.releaseResource(campaignId, resourceIds);
        res.status(200).json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.post('/assignContacts/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    validations.campaign.assignContacts,
    validateRequest,
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { agentId, contacts } = req.body;
        const { assignments, errors } = await campaignService.assignContacts(campaignId, agentId, contacts);
        res.status(200).json({ success: true, assignments, errors });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/fetchContacts/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER, AGENT), 
    validations.campaign.fetchContacts,
    validateRequest,
    async (req, res) => {
    try {
        const { campaignId } = req.params;
        const agentId = req.user.id;
        const role = req.user.role;
        const contacts = await campaignService.fetchContacts(campaignId, agentId, role);
        res.status(200).json({ success: true, contacts });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.patch('/updateContact/:contactId', 
    authorize(ADMIN, PROGRAM_MANAGER, AGENT), 
    validations.campaign.updateContact, 
    validateRequest, 
    async (req, res) => {
    try {
        const { contactId } = req.params;
        const { email, name, phone } = req.body;
        const userId = req.user.id;

        const updatedContact = await campaignService.updateContact(contactId, { email, name, phone }, userId);
        res.status(200).json({ success: true, contact: updatedContact });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.post('/upload/:campaignId', 
    authorize(ADMIN, PROGRAM_MANAGER), 
    upload.single('file'), 
    async (req, res) => {

    const { campaignId } = req.params;
    const file = req.file;

    try {
        const result = await campaignService.uploadFile(file.path, campaignId);
        if (result.success) {
            res.status(200).json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

router.post('/logCall/:contactId', 
    authorize(ADMIN, PROGRAM_MANAGER, AGENT), 
    validations.campaign.logCall, 
    validateRequest, 
    async (req, res) => {
    try {
        const { contactId } = req.params;
        const { callDate, callDuration, callStatus, notes } = req.body;
        const userId = req.user.id;

        const callLog = await campaignService.logCall(contactId, { callDate, callDuration, callStatus, notes }, userId);
        res.status(200).json({ success: true, callLog });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getCallLogs/:phoneNumber',
    validations.campaign.getCallLogs, 
    validateRequest,
    async (req, res) => {
    try {
        const callLogs = await campaignService.getCallLogs(req.params.phoneNumber);
        res.status(200).json({ success: true, callLogs });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

export default router;