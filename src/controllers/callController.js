import express from 'express';
import callService from '../services/callService.js';

const router = express.Router();

router.post('/initiate', async (req, res) => {
    try {
        const { agentId, customerNumber, assignmentId } = req.body;

        if (!agentId || !customerNumber || !assignmentId) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const callLog = await callService.initiateCall({ agentId, customerNumber, assignmentId });
        res.status(200).json({ success: true, callLog });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;