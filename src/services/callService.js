import dotenv from 'dotenv';
import axios from 'axios';
import CallLog from '../models/CallLog.js';
import { INITIATED, FAILED } from '../utils/constants.js'

dotenv.config();

const ACEFONE_API_URL = process.env.ACEFONE_API_URL;
const ACEFONE_API_TOKEN = process.env.ACEFONE_API_TOKEN;

export const initiateCall = async (data) => {
    const { agentId, customerNumber, assignmentId } = data;

    const phoneNumber = customerNumber;
    const calledBy = agentId;

    // Hardcoded agent number for now
    const agentNumber = '0602049340005';

    const callLog = await CallLog.create({
        calledBy,
        assignmentId,
        phoneNumber,
        vendorStatus: INITIATED,
        callStatus: INITIATED
    });

    try {
        const response = await axios.post(
            ACEFONE_API_URL + '/click_to_call',
            {
                agent_number: agentNumber,
                destination_number: customerNumber
            },
            {
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    Authorization: 'Bearer ' + ACEFONE_API_TOKEN
                }
            }
        );

        if (response.status !== 200) {
            console.error(`Unexpected response status: ${response.status}`);
            callLog.vendorStatus = FAILED;
        }

        await callLog.save();
        return callLog;

    } catch (error) {
        console.error('Error initiating call:', error.response?.data || error.message);

        callLog.vendorStatus = FAILED;
        await callLog.save();

        throw new Error('Failed to initiate call');
    }
};

const callService = {
    initiateCall
}

export default callService
