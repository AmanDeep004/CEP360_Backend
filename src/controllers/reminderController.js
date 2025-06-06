import express from 'express';
import reminderService from '../services/reminderService.js';

const router = express.Router();

router.get('/get/:id', 
    async (req, res) => {
    try {
        const reminder = await reminderService.getReminder(req.params.id);
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getAll', 
    async (req, res) => {
    try {
        const { status } = req.query;
        const reminders = await reminderService.getAllReminders(status);
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getByAgent/:agentId', 
    async (req, res) => {
    try {
        const { status } = req.query;
        const reminders = await reminderService.getRemindersByAgentId(req.params.agentId, status);
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getByContact/:contactId', 
    async (req, res) => {
    try {
        const { status } = req.query;
        const reminders = await reminderService.getRemindersByContactId(req.params.contactId, status);
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getByCampaign/:campaignId', 
    async (req, res) => {
    try {
        const { status } = req.query;
        const reminders = await reminderService.getRemindersByCampaignId(req.params.campaignId, status);
        res.status(200).json({ success: true, reminders });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.post('/add', 
    async (req, res) => {
    try {
        const reminder = await reminderService.addReminder(req.body);
        res.status(201).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.patch('/update/:id', 
    async (req, res) => {
    try {
        const reminder = await reminderService.updateReminder(req.params.id, req.body);
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.patch('/markAsDone/:id', 
    async (req, res) => {
    try {
        const reminder = await reminderService.markReminderAsDone(req.params.id);
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.patch('/markAsDue/:id', 
    async (req, res) => {
    try {
        const reminder = await reminderService.markReminderAsDue(req.params.id);
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/delete/:id', 
    async (req, res) => {
    try {
        const reminder = await reminderService.deleteReminder(req.params.id);
        res.status(200).json({ success: true, reminder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

export default router;