import mongoose from 'mongoose';
import User from './User.js'; // Assuming User model is defined
import { ACTIVE, COMPLETED, INACTIVE } from '../utils/constants.js';

const campaignSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, required: true },
    category: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    campaignManagerId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    teamLeaderId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: false,
    },
    keyAccountManager: { type: String, required: false },
    executedAt: { type: String, required: true },
    status: { 
        type: String, 
        required: true,
        enum: [ACTIVE, COMPLETED, INACTIVE],
        default: ACTIVE,
    },
    jcNumber: { type: String, required: false },
    brandName: { type: String, required: true },
    clientName: { type: String, required: true },
    clientEmail: { type: String, required: true },
    clientContact: { type: String, required: true },
    comments: { type: String },
    resourcesAssigned: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }],
    resourcesReleased: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }],
}, { timestamps: true});

campaignSchema.pre('save', async function (next) {
    const campaign = this;
    const userIds = [
        campaign.programManagerId,
        campaign.teamLeaderId,
        campaign.keyAccountManager,
        ...campaign.resourcesAssigned,
        ...campaign.resourcesReleased
    ].filter(id => id && mongoose.Types.ObjectId.isValid(id));

    const users = await User.find({ _id: { $in: userIds } });
    if (users.length !== userIds.length) {
        throw new Error('One or more referenced users do not exist');
    }
    next();
});

export default mongoose.model('Campaign', campaignSchema);