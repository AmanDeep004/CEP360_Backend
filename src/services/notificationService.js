import axios from 'axios';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { APPLICATION_JSON } from '../utils/constants.js';

dotenv.config();

const FROM_EMAIL = process.env.FROM_EMAIL;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const AUTHORIZATION_KEY = process.env.WHATSAPP_AUTHORIZATION_KEY;
const FROM_NUMBER = process.env.WHATSAPP_FROM_PHONE_NUMBER;
const TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME;
const LANGUAGE = process.env.WHATSAPP_LANGUAGE_CODE;

export const sendEmailNotification = async (toEmail, emailContent) => {

    if (!toEmail || !emailContent) {
        throw new Error('toEmail and emailContent are required');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        throw new Error('Invalid email format');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: FROM_EMAIL,
            pass: EMAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: FROM_EMAIL,
        to: toEmail,
        subject: 'Notification',
        html: emailContent
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
        return { success: true, message: 'Email sent successfully' };
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Failed to send email');
    }
};

export const sendWhatsAppNotification = async (to, name) => {

    if (!to || !name) {
        throw new Error('to and name are required');
    }

    if (!to.startsWith('+91')) {
        to = `+91${to}`;
    }

    if (!/^\+91\d{10}$/.test(to)) {
        throw new Error('Invalid phone number format');
    }

    const data = {
        messages: [
            {
                from: FROM_NUMBER,
                to,
                messageId: uuidv4(),
                content: {
                    templateName: TEMPLATE_NAME,
                    language: LANGUAGE,
                    templateData: {
                        header: {
                            type: 'TEXT',
                            placeholder: name
                        },
                        body: {
                            placeholders: [name]
                        }
                    }
                }
            }
        ]
    };

    try {
        console.log('Sending WhatsApp message:', data, 'to:', to, 'template:', TEMPLATE_NAME, WHATSAPP_API_URL, AUTHORIZATION_KEY);

        const response = await axios.post(WHATSAPP_API_URL, data, {
            headers: {
                'Authorization': AUTHORIZATION_KEY,
                'accept': APPLICATION_JSON,
                'content-type': APPLICATION_JSON
            }
        });

        console.log('WhatsApp message sent:', response.data);
        return { success: true, message: 'WhatsApp message sent successfully' };
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw new Error('Failed to send WhatsApp message');
    }
};

const notificationService = { sendEmailNotification, sendWhatsAppNotification };
export default notificationService;