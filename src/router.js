import express from 'express';
import callContoller from './controllers/callController.js'
import authController from './controllers/authController.js';
import userController from './controllers/userController.js';
import campaignContoller from './controllers/campaignController.js';
import { protect, authorize } from './middlewares/authMiddleware.js';
import reminderController from './controllers/reminderController.js';
import notificationController from './controllers/notificationController.js'
import { ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER } from './utils/constants.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.status(200).json({ success: true, message: "server is up and listening!!!" });
});

router.use('/auth', authController);


router.use(protect);
router.use('/campaign', campaignContoller);
router.use('/user',  authorize(ADMIN, PROGRAM_MANAGER, RESOURCE_MANAGER), userController);
router.use('/reminder', reminderController);
router.use('/notify', notificationController);
router.use('/call', callContoller);

export default router;
