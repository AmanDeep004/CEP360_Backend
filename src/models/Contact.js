import User from './User.js';
import mongoose from 'mongoose';
import Campaign from './Campaign.js';
import { ASSIGNED, UNASSIGNED } from '../utils/constants.js';

const contactSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    status: {
        type: String,
        enum: [ASSIGNED, UNASSIGNED],
        default: UNASSIGNED,
        required: true
    },
    name: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    emailId: { type: String, required: true },
    companyName: { type: String, required: true },
    equipmentNumber: { type: String, required: true },
    customerTotalEquipments: { type: Number, required: true },
    customerCode: { type: String, required: true },
    branch: { type: String, required: true },
    contractEndDate: { type: String, required: true },
    contractType: { type: String, required: true },
    presentAmcValue: { type: Number, required: true },
    pd: { type: String, required: true },
    salesPerson: { type: String, required: true },
    serviceLeader: { type: String, required: true },
    aheadConnection: { type: String, required: true },
    paymentTerms: { type: String, required: true },
    isUpdated: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedOn: { type: Date },
    updatedValue: {
        type: Map,
        of: String,
        default: {
            phone: '',
            email: '',
            name: ''
        }
    }
}, { timestamps: true });

contactSchema.pre('save', async function (next) {
    const contact = this;
    const campaign = await Campaign.findById(contact.campaignId);

    if (!campaign) {
        throw new Error('Campaign not found');
    }

    next();
});

export default mongoose.model('Contact', contactSchema);