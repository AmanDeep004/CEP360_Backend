import { getCallingDataById } from "../controllers/callingDataController.js";
import callHistoryModel from "../models/callHistoryModel.js";
import Campaign from "../models/campaignModel.js";

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

const getAllCallHistoriesForCampaign = async (endedCampaigns) => {
  try {
    if (!endedCampaigns || endedCampaigns.length === 0) {
      return [];
    }
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
        .populate("callingData_id")
        .lean();
      console.log(
        `   Found ${callHistories.length} call histories with redundant remarks`
      );

      redundantData.push(...callHistories);

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
      console.log("\n📝 Sample Redundant Data (First 5):");
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

export { checkEndedCampaigns, getAllCallHistoriesForCampaign };
