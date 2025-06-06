import User from './User.js';
import mongoose from 'mongoose';
import Assignment from './Assignment.js';
import { AGENT } from '../utils/constants.js';
import { CONTACT_STATUSES } from '../utils/constants.js';

const callLogSchema = new mongoose.Schema({
    assignmentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Assignment', 
        required: true 
    },
    phoneNumber: { type: String, required: true },
    calledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    callDate: { type: Date, required: false },
    callDuration: { type: Number, required: false },
    callStatus: { type: String, 
        enum: Object.values(CONTACT_STATUSES),
        default: CONTACT_STATUSES.YET_TO_CALL,
        required: true 
    },
    vendorStatus: { type: String, default: null },
    callId: { type: String, default: null },
    callRecordingId: { type: String, default: null },
    notes: { type: String }
}, { timestamps: true });


callLogSchema.pre('save', async function (next) {
    const callLog = this;

    const assignment = await Assignment.findById(callLog.assignmentId);
    if (!assignment) {
        throw new Error('Assignment not found');
    }

    const calledBy = await User.findById(callLog.calledBy);
    if (!calledBy || calledBy.role !== AGENT) {
        throw new Error('Caller not found or not an agent');
    }

    next();
});

export default mongoose.model('CallLog', callLogSchema);