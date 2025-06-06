import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import mongoose from 'mongoose';
import User from '../models/User.js';
import CallLog from '../models/CallLog.js';
import Contact from '../models/Contact.js';
import Campaign from '../models/Campaign.js';
import Assignment from '../models/Assignment.js';
import { CONTACT_STATUSES, FILE_UPLOAD_SUCCESS } from '../utils/constants.js';
import { mapCSVToSchema } from '../utils/campaignUtil.js';
import { validateCSVColumns } from '../utils/campaignUtil.js';
import { ACTIVE, INACTIVE, COMPLETED, ASSIGNED } from '../utils/constants.js';
import { ADMIN, PROGRAM_MANAGER, AGENT, DATABASE_MANAGER } from '../utils/constants.js';

const ALLOWED_STATUSES = [ACTIVE, INACTIVE, COMPLETED];

const validateCampaignData = async (data) => {
    if (data.status && !ALLOWED_STATUSES.includes(data.status)) {
        throw new Error(`Invalid status: ${data.status}. Allowed statuses are: ${ALLOWED_STATUSES.join(', ')}`);
    }

    const userIds = [data.campaignManagerId, data.teamLeaderId].filter(id => id && mongoose.Types.ObjectId.isValid(id));
    if (userIds.length !== [data.campaignManagerId, data.teamLeaderId].filter(id => id).length) {
        throw new Error('One or more user IDs are invalid');
    }

    const users = await User.find({ _id: { $in: userIds } });
    if (users.length !== userIds.length) {
        throw new Error('One or more referenced users do not exist');
    }
    
    if (data.startDate && data.endDate) {
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new Error('Invalid date format. Dates must be in ISO 8601 format.');
        }

        if (startDate >= endDate) {
            throw new Error('Start date must be before end date');
        }

        const differenceInHours = (endDate - startDate) / (1000 * 60 * 60);
        if (differenceInHours < 24) {
            throw new Error('Campagin start and end date should have minimum 1 day difference');
        }
    }
};

const validateAssignContacts = async (campaignId, agentId, contactIds) => {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const agent = await User.findById(agentId);
    if (!agent || agent.role !== AGENT) {
        throw new Error('Assigned agent not found or not an agent');
    }

    if (!campaign.resourcesAssigned.includes(agentId)) {
        throw new Error('Agent is not assigned to this campaign');
    }

    const validContacts = await Contact.find({ _id: { $in: contactIds }, campaignId });
    if (validContacts.length !== contactIds.length) {
        throw new Error('One or more contact IDs are invalid or do not belong to the specified campaign');
    }

    return { campaign, agent, validContacts };
};

const createCampaign = async (campaignData) => {
    await validateCampaignData(campaignData);

    const { name, type, category, startDate, endDate, 
        campaignManagerId, teamLeaderId, keyAccountManager, executedAt, 
        status, jcNumber, brandName, clientName, clientEmail, clientContact,
        comments } = campaignData;

    const campaign = await Campaign.create({
        name,
        type,
        category,
        startDate,
        endDate,
        campaignManagerId,
        teamLeaderId: teamLeaderId || null,
        keyAccountManager,
        executedAt,
        status,
        jcNumber,
        brandName,
        clientName,
        clientEmail,
        clientContact,
        comments
    });

    return campaign;
};

const updateCampaign = async (id, data) => {
    await validateCampaignData(data);

    const campaignData = {
        ...(data.name && { name: data.name }),
        ...(data.type && { type: data.type }),
        ...(data.category && { category: data.category }),
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(data.campaignManagerId && { campaignManagerId: data.campaignManagerId }),
        ...(data.teamLeaderId && { teamLeaderId: data.teamLeaderId }),
        ...(data.keyAccountManager && { keyAccountManager: data.keyAccountManager }),
        ...(data.executedAt && { executedAt: data.executedAt }),
        ...(data.status && { status: data.status }),
        ...(data.jcNumber && { jcNumber: data.jcNumber }),
        ...(data.brandName && { brandName: data.brandName }),
        ...(data.clientName && { clientName: data.clientName }),
        ...(data.clientEmail && { clientEmail: data.clientEmail }),
        ...(data.clientContact && { clientContact: data.clientContact }),
        ...(data.comments && { comments: data.comments }),
    };

    const campaign = await Campaign.findByIdAndUpdate(id, { $set: campaignData }, { new: true });
    if (!campaign) throw new Error('Campaign not found');

    return campaign;
};

const deleteCampaign = async (id) => {
    const campaign = await Campaign.findByIdAndDelete(id);
    if (!campaign) throw new Error('Campaign not found');
};

const getCampaign = async (id) => {
    const campaign = await Campaign.findById(id).populate([
        { path: 'campaignManagerId', select: 'name email' },
        { path: 'teamLeaderId', select: 'name email' },
        { path: 'resourcesAssigned', select: 'name email' },
        { path: 'resourcesReleased', select: 'name email' }
    ]);
    if (!campaign) throw new Error('Campaign not found');

    return campaign;
};

const getAllCampaignsByUser = async (userId, role) => {

    if (role === ADMIN) {
        return await Campaign.find().populate([
            { path: 'campaignManagerId', select: 'name email' },
            { path: 'teamLeaderId', select: 'name email' },
            { path: 'resourcesAssigned', select: 'name email' },
            { path: 'resourcesReleased', select: 'name email' }
        ]);
    } else if (role === PROGRAM_MANAGER) {
        return await Campaign.find({ campaignManagerId: userId }).populate([
            { path: 'campaignManagerId', select: 'name email' },
            { path: 'teamLeaderId', select: 'name email' },
            { path: 'resourcesAssigned', select: 'name email' },
            { path: 'resourcesReleased', select: 'name email' }
        ]);
    } else if (role === AGENT || role === DATABASE_MANAGER) {
        return await Campaign.find({ resourcesAssigned: { $in: [userId] } }).populate([
            { path: 'campaignManagerId', select: 'name email' },
            { path: 'teamLeaderId', select: 'name email' },
            { path: 'resourcesAssigned', select: 'name email' },
            { path: 'resourcesReleased', select: 'name email' }
        ]);
    } else {
        throw new Error('No campaigns found');
    }
};

const getContactById = async (id) => {
    const contact = await Contact.findById(id);
    if (!contact) throw new Error('Contact not found');
    return contact;
};

const addResource = async (id, resourceIds) => {
    const campaign = await Campaign.findById(id);
    if (!campaign) throw new Error('Campaign not found');

    const validResources = await User.find({ _id: { $in: resourceIds } });
    if (validResources.length !== resourceIds.length) {
        throw new Error('One or more resource IDs are invalid');
    }

    const nonAgentResources = validResources.filter(resource => resource.role !== AGENT);
    if (nonAgentResources.length > 0) {
        throw new Error('One or more resource IDs are not agents');
    }

    resourceIds.forEach(resourceId => {
        if (!campaign.resourcesAssigned.includes(resourceId)) {
            campaign.resourcesAssigned.push(resourceId);
        }
        const index = campaign.resourcesReleased.indexOf(resourceId);
        if (index > -1) {
            campaign.resourcesReleased.splice(index, 1);
        }
    });

    await campaign.save();
    return campaign;
};

const releaseResource = async (id, resourceIds) => {
    const campaign = await Campaign.findById(id);
    if (!campaign) throw new Error('Campaign not found');

    const validResources = await User.find({ _id: { $in: resourceIds } });
    if (validResources.length !== resourceIds.length) {
        throw new Error('One or more resource IDs are invalid');
    }

    const nonAgentResources = validResources.filter(resource => resource.role !== AGENT);
    if (nonAgentResources.length > 0) {
        throw new Error('One or more resource IDs are not agents');
    }

    resourceIds.forEach(resourceId => {
        const index = campaign.resourcesAssigned.indexOf(resourceId);
        if (index > -1) {
            campaign.resourcesAssigned.splice(index, 1);
        }
        if (!campaign.resourcesReleased.includes(resourceId)) {
            campaign.resourcesReleased.push(resourceId);
        }
    });

    await campaign.save();
    return campaign;
};

const assignContacts = async (campaignId, agentId, contactIds) => {
    const { campaign, agent, validContacts } = await validateAssignContacts(campaignId, agentId, contactIds);

    const assignments = [];
    const errors = [];

    for (const contactId of contactIds) {
        const existingAssignment = await Assignment.findOne({ contactId, campaignId });
        if (existingAssignment) {
            if (existingAssignment.agentId.toString() === agentId.toString()) {
                errors.push(`Agent is already assigned to contact ID: ${contactId}`);
            } else {
                existingAssignment.agentId = agentId;
                existingAssignment.assignedAt = Date.now();
                await existingAssignment.save();
            }
        } else {
            assignments.push({
                campaignId,
                contactId,
                agentId,
                assignedAt: Date.now()
            });
        }
    }

    if (assignments.length > 0) {
        await Assignment.insertMany(assignments);
        await Contact.updateMany(
            { _id: { $in: assignments.map(a => a.contactId) } },
            { $set: { status: ASSIGNED } }
        );
    }

    return { assignments, errors };
};

const fetchContacts = async (campaignId, agentId, role) => {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
        throw new Error('Campaign not found');
    }

    let assignments = [];
    let contacts = [];

    if (role === AGENT) {
        const agent = await User.findById(agentId);
        if (!agent || agent.role !== AGENT) {
            throw new Error('Agent not found or not an agent');
        }
        assignments = await Assignment.find({ campaignId, agentId }).populate('contactId').populate('agentId', 'id, name');
    } else if (role === PROGRAM_MANAGER) {
        assignments = await Assignment.find({ campaignId }).populate('contactId').populate('agentId', 'id, name');
        const assignedContactIds = assignments.map(assignment => assignment.contactId._id.toString());
        const unassignedContacts = await Contact.find({ campaignId, _id: { $nin: assignedContactIds } });
        contacts = unassignedContacts.map(contact => ({
            ...contact.toObject(),
            agent: {},
            callLogs: []
        }));
    } else {
        throw new Error('Unauthorized role');
    }

    const assignedContacts = await Promise.all(assignments.map(async (assignment) => {
        const contact = assignment.contactId;
        const agent = assignment.agentId;
        const callLogs = await CallLog.find({ assignmentId: assignment._id })
            .sort({ callDate: -1 })
            .populate({
                path: 'assignmentId',
                select: 'campaignId contactId',
                populate: {
                    path: 'campaignId',
                    select: 'name'
                }
            })
            .populate({
                path: 'calledBy',
                select: 'id name'
            });
        return {
            ...contact.toObject(),
            agent: agent ? agent.toObject() : null,
            callLogs: callLogs.length ? callLogs : []
        };
    }));

    return [...contacts, ...assignedContacts];
};

const updateContact = async (contactId, data, userId) => {
    const { email, name, phone } = data;
    const contact = await Contact.findById(contactId);
    if (!contact) throw new Error('Contact not found');
    
    if (phone && !/^\d{10}$/.test(phone)) {
        throw new Error('Phone number must be a 10-digit number');
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email format');
    }

    contact.isUpdated = true;
    contact.updatedBy = userId;
    contact.updatedOn = Date.now();

    contact.updatedValue = {
        phone: phone,
        email: email,
        name: name
    };

    await contact.save();
    return contact;
};

const uploadFile = async (filePath, campaignId) => {
    if (!campaignId || !filePath) {
        return { success: false, message: 'Campaign ID and file are required' };
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const resolvedFilePath = path.resolve(filePath);
    const fileStream = fs.createReadStream(resolvedFilePath);

    try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        const contacts = [];
        let headersValidated = false;

        await new Promise((resolve, reject) => {
            fileStream.pipe(csv())
            .on('headers', (headers) => {
                if (!headersValidated) {
                    try {
                        validateCSVColumns(headers);
                        headersValidated = true;
                    } catch (error) {
                        reject(error);
                    }
                }
            })
            .on('data', async (row) => {
                try {
                    const mappedRow = mapCSVToSchema({ ...row, campaignId });
                    contacts.push(mappedRow);
                } catch (error) {
                    reject(error);
                }
            })
            .on('end', async () => {
                try {
                    await Contact.insertMany(contacts);
                    resolve();
                } catch (error) {
                    reject(new Error('Error processing file: ' + error.message));
                }
            })
            .on('error', (error) => {
                reject(new Error('Error processing file: ' + error.message));
            });
        });
        return { success: true, message: FILE_UPLOAD_SUCCESS };
    } catch (error) {
        return { success: false, message: error.message };
    } finally {
        fs.unlink(resolvedFilePath, (err) => {
            if (err) {
                console.error('Error removing file:', err);
            }
        });
    }
};

const logCall = async (contactId, data, userId) => {
    const { callDuration, callStatus, notes } = data;
    const callDate = Date.now();

    if (!Object.values(CONTACT_STATUSES).includes(callStatus)) {
        throw new Error('Invalid call status');
    }

    const contact = await Contact.findById(contactId);
    if (!contact) throw new Error('Contact not found');

    const assignment = await Assignment.findOne({ contactId });
    if (!assignment) throw new Error('Assignment not found for the contact');

    console.log(assignment.agentId.toString(), userId.toString());

    if (assignment.agentId.toString() !== userId.toString()) {
        throw new Error('User is not authorized to log this call, as they are not assigned to the contact');
    }

    if (!contact.phoneNumber) {
        throw new Error('Phone number not available for the contact');
    }   

    const callLog = await CallLog.create({
        assignmentId: assignment._id,
        phoneNumber: contact.phoneNumber,
        calledBy: assignment.agentId,
        callDate,
        callDuration,
        callStatus,
        notes
    });

    return callLog;
};

const getCallLogs = async (phoneNumber) => {

    if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
        throw new Error('Invalid phone number. It must be a 10-digit number.');
    }

    return await CallLog.find({ phoneNumber })
        .sort({ callDate: -1 })
        .populate({
            path: 'assignmentId',
            select: 'campaignId contactId',
            populate: {
                path: 'campaignId',
                select: 'name'
            }
        })
        .populate({
            path: 'calledBy',
            select: 'id name'
        });
};


const campaignService = { 
    createCampaign, 
    updateCampaign, 
    deleteCampaign, 
    getCampaign, 
    getAllCampaignsByUser, 
    uploadFile, 
    getContactById, 
    addResource, 
    releaseResource, 
    assignContacts,
    fetchContacts,
    updateContact,
    logCall,
    getCallLogs
};

export default campaignService;