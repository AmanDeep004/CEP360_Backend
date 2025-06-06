import express from 'express';
import userService from '../services/userService.js';
import validations from '../middlewares/validation.js';
import { authorize } from '../middlewares/authMiddleware.js';
import validateRequest from '../middlewares/validateRequest.js';
import { ADMIN, PROGRAM_MANAGER, AGENT, RESOURCE_MANAGER, DATABASE_MANAGER } from '../utils/constants.js';

const router = express.Router();

router.post('/create', 
    validations.user.add, 
    validateRequest, 
    async (req, res) => {
    try {
        const data = req.body;
        const user = await userService.createUser(data);
        res.status(201).json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.patch('/update/:id', 
    validations.user.update, 
    validateRequest, 
    async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const user = await userService.updateUser(id, data);
        res.status(200).json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/delete/:id', 
    validations.user.delete, 
    validateRequest, 
    async (req, res) => {
    try {
        const { id } = req.params;
        await userService.deleteUser(id);
        res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/get/:id', 
    validations.user.get, 
    validateRequest, 
    async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userService.getUser(id);
        res.status(200).json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/getAll', 
    validations.user.getAll, 
    validateRequest, 
    async (req, res) => {
    try {
        const { role } = req.query;
        const users = await userService.getAllUsers(role);
        res.status(200).json({ success: true, users });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

export default router;