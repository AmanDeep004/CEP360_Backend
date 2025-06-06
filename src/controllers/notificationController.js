import express from 'express';
import notificationService from '../services/notificationService.js';

const router = express.Router();

router.post('/sendEmail', async (req, res) => {
    const { toEmail, emailContent } = req.body;

    try {
        const result = await notificationService.sendEmailNotification(toEmail, emailContent);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/sendWhatsApp', async (req, res) => {
    const { to, name } = req.body;

    try {
        const result = await notificationService.sendWhatsAppNotification(to, name);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;