import User from '../models/User.js';
import Reminder from '../models/Reminder.js';
import Contact from '../models/Contact.js';
import { AGENT, TODO, DONE, DUE } from '../utils/constants.js';

const validateContact = async (contactId) => {
    const contact = await Contact.findById(contactId).populate('campaignId');
    if (!contact) {
        throw new Error('Contact not found');
    }
    return contact;
};

const validateAgent = async (agentId) => {
    const agent = await User.findById(agentId);
    if (!agent || agent.role !== AGENT) {
        throw new Error('Agent not found or not an agent');
    }
};

const validateContactAndAgent = async (contactId, agentId) => {
    const contact = await validateContact(contactId);
    await validateAgent(agentId);
    return contact;
};

const addReminder = async (data) => {
    const { title, message, agentId, contactId, remindAt } = data;
    const remindAtDate = new Date(remindAt);
    if (remindAtDate < Date.now()) {
        throw new Error('Reminder date and time must be in the future');
    }
    const contact = await validateContactAndAgent(contactId, agentId);
    const reminder = new Reminder({ title, message, agentId, contactId, remindAt });
    await reminder.save();
    return reminder;
};

const updateReminder = async (id, data) => {
    if (data.contactId || data.agentId) {
        await validateContactAndAgent(data.contactId, data.agentId);
    }

    if (data.status && data.status !== TODO && data.status !== DONE) {
        throw new Error('Invalid status');
    }

    const reminder = await Reminder.findByIdAndUpdate(id, data, { new: true });
    if (!reminder) {
        throw new Error('Reminder not found');
    }
    return reminder;
};

const deleteReminder = async (id) => {
    const reminder = await Reminder.findByIdAndDelete(id);
    if (!reminder) {
        throw new Error('Reminder not found');
    }
    return reminder;
};

const getReminder = async (id) => {
    const reminder = await Reminder.findById(id).populate({
        path: 'contactId',
        select: 'name companyName emailId',
        populate: {
            path: 'campaignId',
            select: 'name'
        }
    });
    if (!reminder) {
        throw new Error('Reminder not found');
    }
    return reminder;
};

const getAllReminders = async (status) => {
    const query = status ? { status } : {};
    return await Reminder.find(query).populate({
        path: 'contactId',
        select: 'name companyName emailId',
        populate: {
            path: 'campaignId',
            select: 'name'
        }
    });
};

const getRemindersByAgentId = async (agentId, status) => {
    await validateAgent(agentId);
    const query = status ? { agentId, status } : { agentId };
    return await Reminder.find(query).populate({
        path: 'contactId',
        select: 'name companyName emailId',
        populate: {
            path: 'campaignId',
            select: 'name'
        }
    });
};

const getRemindersByContactId = async (contactId, status) => {
    await validateContact(contactId);
    const query = status ? { contactId, status } : { contactId };
    return await Reminder.find(query).populate({
        path: 'contactId',
        select: 'name companyName emailId',
        populate: {
            path: 'campaignId',
            select: 'name'
        }
    });
};

const getRemindersByCampaignId = async (campaignId, status) => {
    const query = status ? { status } : {};
    return await Reminder.find(query).populate({
        path: 'contactId',
        select: 'name companyName emailId',
        match: { campaignId },
        populate: {
            path: 'campaignId',
            select: 'name'
        }
    });
};

const markReminderAsDone = async (id) => {
    const reminder = await Reminder.findByIdAndUpdate(id, { status: DONE }, { new: true });
    if (!reminder) {
        throw new Error('Reminder not found');
    }
    return reminder;
};

const markReminderAsDue = async (id) => {
    const reminder = await Reminder.findByIdAndUpdate(id, { status: DUE }, { new: true });
    if (!reminder) {
        throw new Error('Reminder not found');
    }
    return reminder;
};

const reminderService = {
    addReminder,
    updateReminder,
    deleteReminder,
    getReminder,
    getAllReminders,
    getRemindersByAgentId,
    getRemindersByContactId,
    getRemindersByCampaignId,
    markReminderAsDone,
    markReminderAsDue
};

export default reminderService;