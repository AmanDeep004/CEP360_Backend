import axios from "axios";

class WhatsAppService {
  constructor() {
    this.apiKey = process.env.DOUBLETICK_API_KEY;
    this.sendWhatsappMessage = process.env.DOUBLETICK_SEND_MSG;
    this.templatesUrl = process.env.DOUBLETICK_ALLTEMPLATES_URL;

    this.http = axios.create({
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  /**
   * Get all available WhatsApp templates
   */
  async getAllTemplates() {
    try {
      const { data } = await this.http.get(this.templatesUrl);

      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error(
        "Get Templates Error:",
        error.response?.data || error.message
      );

      return {
        success: false,
        error:
          error.response?.data || error.message || "Failed to fetch templates",
      };
    }
  }

  /**
   * Send a WhatsApp template message
   */
  async sendTemplateMessage({
    templateName,
    from,
    to,
    placeholders = [],
    language = "en_US",
  }) {
    try {
      const payload = {
        messages: [
          {
            from,
            to,
            content: {
              language,
              templateName,
              templateData: {
                body: {
                  placeholders,
                },
              },
            },
          },
        ],
      };

      const { data } = await this.http.post(this.sendWhatsappMessage, payload);

      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error(
        "WhatsApp Send Error:",
        error.response?.data || error.message
      );

      return {
        success: false,
        error:
          error.response?.data ||
          error.message ||
          "Failed to send WhatsApp message",
      };
    }
  }

  /**
   * Send bulk personalized messages
   */
  async sendBulkMessages({ templateName, from, recipients, language = "en_US" }) {
    const results = [];

    for (const recipient of recipients) {
      const result = await this.sendTemplateMessage({
        templateName,
        from,
        to: recipient.to,
        placeholders: recipient.placeholders || [],
        language,
      });

      results.push({
        to: recipient.to,
        ...result,
      });

      // Prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return results;
  }
}

export default WhatsAppService;
