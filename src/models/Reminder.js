import mongoose from 'mongoose';
import User from './User.js';
import Contact from './Contact.js';
import { AGENT } from '../utils/constants.js';
import { TODO, DUE, DONE } from '../utils/constants.js';

const reminderSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    agentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    contactId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Contact', 
        required: true 
    },
    remindAt: { type: Date, required: true },
    status: { 
        type: String, 
        enum: [TODO, DUE, DONE], 
        default: TODO 
    }
}, { timestamps: true });

reminderSchema.pre('save', async function (next) {
    const reminder = this;

    const contact = await Contact.findById(reminder.contactId);
    if (!contact) {
        throw new Error('Contact not found');
    }

    const agent = await User.findById(reminder.agentId);
    if (!agent || agent.role !== AGENT) {
        throw new Error('Agent not found or not an agent');
    }

    next();
});

export default mongoose.model('Reminder', reminderSchema);