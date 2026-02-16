import { getCallingDataById } from "../controllers/callingDataController.js";
import callHistoryModel from "../models/callHistoryModel.js";
import Campaign from "../models/campaignModel.js";
import Contact from "../models/MasterDBModel/contactModel.js";

const checkEndedCampaigns = async () => {
  try {
    const now = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endedCampaign = await Campaign.find({
      // endDate: { $gte: yesterday, $gte: now },
      endDate: { $lte: now },
    });
    const endedCampaignIds = endedCampaign.map((Campaign) => Campaign._id);
    return endedCampaignIds;
  } catch (error) {
    console.error("Error checking ended campaigns:", error);

    return [];
  }
};

//passing the [ids] of ended campaign
const getAllCallHistoriesForCampaignOld = async (endedCampaigns) => {
  try {
    if (!endedCampaigns || endedCampaigns.length === 0) {
      return [];
    }

    console.log(
      "getAllCallHistoriesForCampaign called with campaign IDs:",
      endedCampaigns
    );
    const redundantData = [];
    const dispositionList = [
      "Company Closed",
      "Helpdesk Number",
      "No Number",
      "No Number Found (WebSearch)",
      "Out Of Order",
      "Website Not Found",
      "Wrong Number",
    ];
    for (const campaign of endedCampaigns) {
      const callHistories = await callHistoryModel
        .find({
          campaign_id: campaign._id,
          "chatHistory.remarks": { $in: dispositionList },
        })
        .populate("campaign_id", "name startDate endDate")
        .populate("callingData_id", "Contact_ID First_Name Last_Name")
        .lean();
      console.log(
        `Found ${callHistories.length} call histories with redundant remarks`
      );

      if (redundantChats.length > 0) {
        allRedundantData.push({
          campaignId: callHistory.campaign_id._id,
          campaignName: callHistory.campaign_id.name,
          callingDataId: callHistory.callingData_id._id,
          contactId: callHistory.callingData_id.Contact_ID,
          contactName:
            callHistory.callingData_id.Full_Name ||
            `${callHistory.callingData_id.First_Name || ""} ${
              callHistory.callingData_id.Last_Name || ""
            }`.trim(),
          companyName: callHistory.callingData_id.Company_Name,
          callHistoryId: callHistory._id,
          chatHistory: redundantChats, // Complete chat history for DB update
          redundantChats: redundantChats.map((chat) => ({
            contactNo: chat.contactNo,
            remarks: chat.remarks,
            reason: chat.reason,
            callingDate: chat.callingDate,
            agentName: chat.agentName,
          })),
          totalRedundantCalls: redundantChats.length,
        });
      }
      // redundantData.push(...callHistories);
      return redundantData;

      console.log("redundantData", redundantData);
      //............
      for (const callHistory of callHistories) {
        // Filter chat history to only include redundant remarks
        const redundantChats = callHistory.chatHistory.filter((chat) =>
          redundantRemarks.includes(chat.remarks)
        );

        if (redundantChats.length > 0) {
          redundantData.push({
            campaignId: campaign._id,
            campaignName: campaign.name,
            callingDataId: callHistory.callingData_id?._id,
            contactId: callHistory.callingData_id?.Contact_ID,
            contactName: callHistory.callingData_id?.Full_Name,
            companyName: callHistory.callingData_id?.Company_Name,
            callHistoryId: callHistory._id,
            redundantChats: redundantChats.map((chat) => ({
              contactNo: chat.contactNo,
              remarks: chat.remarks,
              reason: chat.reason,
              callingDate: chat.callingDate,
              agentName: chat.agentName,
            })),
            totalRedundantCalls: redundantChats.length,
          });
        }
      }

      const remarkCounts = {};
      redundantData.forEach((data) => {
        data.redundantChats.forEach((chat) => {
          remarkCounts[chat.remarks] = (remarkCounts[chat.remarks] || 0) + 1;
        });
      });

      console.log("\nBreakdown by Remark Type:");
      Object.entries(remarkCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([remark, count]) => {
          console.log(`  ${remark}: ${count}`);
        });
      console.log("=".repeat(60));

      // Print detailed data (first 5 records)
      console.log("\n Sample Redundant Data (First 5):");
      redundantData.slice(0, 5).forEach((data, index) => {
        console.log(`\n${index + 1}. Campaign: ${data.campaignName}`);
        console.log(
          `   Contact: ${data.contactName || "N/A"} (${
            data.contactId || "N/A"
          })`
        );
        console.log(`   Company: ${data.companyName || "N/A"}`);
        console.log(`   Redundant Calls: ${data.totalRedundantCalls}`);
        data.redundantChats.forEach((chat, i) => {
          console.log(
            `     ${i + 1}) ${chat.remarks} - ${chat.reason} (${new Date(
              chat.callingDate
            ).toLocaleDateString()})`
          );
        });
      });

      return redundantData;
    }
  } catch (error) {
    return [];
  }
};

const getAllCallHistoriesForCampaign = async (endedCampaigns) => {
  try {
    if (!endedCampaigns || endedCampaigns.length === 0) {
      console.log("No ended campaigns to process");
      return [];
    }

    const dispositionList = [
      "Company Closed",
      "Helpdesk Number",
      "No Number",
      "No Number Found (WebSearch)",
      "Out Of Order",
      "Website Not Found",
      "Wrong Number",
    ];

    const allRedundantData = [];

    for (const campaign of endedCampaigns) {
      console.log(
        `\nProcessing Campaign: ${campaign.name} (ID: ${campaign._id})`
      );

      const callHistories = await callHistoryModel
        .find({
          campaign_id: campaign._id,
          "chatHistory.remarks": { $in: dispositionList },
        })
        .populate("campaign_id", "name startDate endDate")
        .populate(
          "callingData_id",
          "Contact_ID First_Name Last_Name Full_Name Company_Name"
        )
        .lean();

      // console.log(
      //   `   Found ${callHistories.length} call histories with redundant remarks`
      // );

      // Process each call history
      for (const callHistory of callHistories) {
        // Filter to only include redundant remarks
        const redundantChats = callHistory.chatHistory.filter((chat) =>
          dispositionList.includes(chat.remarks)
        );

        if (redundantChats.length > 0) {
          allRedundantData.push({
            campaignId: callHistory.campaign_id._id,
            campaignName: callHistory.campaign_id.name,
            callingDataId: callHistory.callingData_id._id,
            contactId: callHistory.callingData_id.Contact_ID,
            contactName:
              callHistory.callingData_id.Full_Name ||
              `${callHistory.callingData_id.First_Name || ""} ${
                callHistory.callingData_id.Last_Name || ""
              }`.trim(),
            companyName: callHistory.callingData_id.Company_Name,
            callHistoryId: callHistory._id,
            chatHistory: redundantChats, // Complete chat history for DB update
            redundantChats: redundantChats.map((chat) => ({
              contactNo: chat.contactNo,
              remarks: chat.remarks,
              reason: chat.reason,
              callingDate: chat.callingDate,
              agentName: chat.agentName,
            })),
            totalRedundantCalls: redundantChats.length,
          });
        }
      }
    }

    // Count by remark type
    const remarkCounts = {};
    allRedundantData.forEach((data) => {
      data.redundantChats.forEach((chat) => {
        remarkCounts[chat.remarks] = (remarkCounts[chat.remarks] || 0) + 1;
      });
    });

    // console.log("\nBreakdown by Remark Type:");
    Object.entries(remarkCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([remark, count]) => {
        console.log(`   ${remark}: ${count}`);
      });

    allRedundantData.slice(0, 3).forEach((data, index) => {
      // console.log(`\n${index + 1}. Campaign: ${data.campaignName}`);
      // console.log(`   Contact ID: ${data.contactId}`);
      // console.log(`   Contact Name: ${data.contactName || "N/A"}`);
      // console.log(`   Company: ${data.companyName || "N/A"}`);
      // console.log(`   Redundant Calls: ${data.totalRedundantCalls}`);
      data.redundantChats.forEach((chat, i) => {
        // console.log(
        //   `      ${i + 1}) ${chat.remarks} - ${chat.reason} (${new Date(
        //     chat.callingDate
        //   ).toLocaleDateString()})`
        // );
      });
    });
    // console.log("=".repeat(60));

    return allRedundantData;
  } catch (error) {
    console.error("Error getting call histories:", error);
    return [];
  }
};

const updatingIncorrectDataInMasterDB = async (filtData) => {
  try {
    console.log("redundantData received for MasterDB update:", filtData);
    for (const data of filtData) {
      const res = await Contact.findOneAndUpdate(
        { Contact_ID: data.contactId },
        {
          $set: {
            "discrepencyInData.status": true,
            "discrepencyInData.chatHistory": data.chatHistory,
            "discrepencyInData.misc": {
              campaignId: data.campaignId,
              campaignName: data.campaignName,
              callHistoryId: data.callHistoryId,
              updatedAt: new Date(),
              totalRedundantCalls: data.totalRedundantCalls,
            },
          },
        },
        { new: true }
      );
      console.log(res, "result");
    }
  } catch (error) {
    console.error("Error updating MasterDB with correct data:", error);
  }
};

export {
  checkEndedCampaigns,
  getAllCallHistoriesForCampaign,
  updatingIncorrectDataInMasterDB,
};
