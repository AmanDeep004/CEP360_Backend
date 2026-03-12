import axios from 'axios';

const testBatchEmail = async () => {
  try {
    console.log('🚀 Testing batch email endpoint...\n');

    const payload = {
      delayMs: 200,
      emails: [
        {
          to: "user1@example.com",
          from: {
            email: "noreply@yourdomain.com",
            name: "Your Company"
          },
          subject: "Welcome to Our Platform",
          templateId: "6798dce48a12b451b01e3f98",
          customData: {
            username: "John",
            login_link: "https://yourdomain.com/login"
          },
          ccEmails: ["cc1@example.com"],
          bccEmails: ["bcc1@example.com"]
        },
        {
          to: ["user2@example.com", "user3@example.com"],
          from: {
            email: "support@yourdomain.com",
            name: "Support Team"
          },
          subject: "Your Invoice is Ready",
          htmlContent: "<h1>Your Invoice</h1><p>Please find details below</p>",
          textContent: "Your Invoice details below",
          attachments: [
            {
              filename: "invoice.pdf",
              url: "https://example.com/invoice.pdf" // or use base64 content
            }
          ]
        }
      ]
    };

    console.log('📤 Sending request to: http://localhost:4020/api/mailercloud/send-batch');
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));
    console.log('\n⏳ Waiting for response...\n');

    const response = await axios.post(
      'http://localhost:4020/api/mailercloud/send-batch',
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout
      }
    );

    console.log('✅ SUCCESS!');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ ERROR!');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error.message);
    }
  }
};

testBatchEmail();
