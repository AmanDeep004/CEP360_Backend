import User from './User.js';
import mongoose from 'mongoose';
import Contact from './Contact.js';
import Campaign from './Campaign.js';
import { AGENT } from '../utils/constants.js';

const assignmentSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now, required: true }
}, { timestamps: true });

assignmentSchema.pre('save', async function (next) {
    const assignment = this;

    const campaign = await Campaign.findById(assignment.campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    const contact = await Contact.findById(assignment.contactId);
    if (!contact) {
        throw new Error('Contact not found');
    }

    const agent = await User.findById(assignment.agentId);
    if (!agent || agent.role !== AGENT) {
        throw new Error('Assigned agent not found or not an agent');
    }

    next();
});

export default mongoose.model('Assignment', assignmentSchema);