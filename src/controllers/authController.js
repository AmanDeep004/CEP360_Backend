import express from 'express';
import authService from '../services/authService.js';
import { generateToken } from '../utils/token.js';
import validations from '../middlewares/validation.js';
import validateRequest from '../middlewares/validateRequest.js';

const router = express.Router();

router.post( '/register', validations.auth.register, validateRequest, async (req, res) => {
    try {
      const registerData = req.body;
      const user = await authService.registerUser(registerData);
      res.status(201).json({ success: true, user });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

router.post( '/login', validations.auth.login, validateRequest, async (req, res) => {
    try {
      const loginData = req.body;
      const user = await authService.loginUser(loginData);
      res.status(200).json({ success: true, token: generateToken(user), user });
    } catch (error) {
      res.status(401).json({ success: false, message: error.message });
    }
});

export default router;