const db = require('../config/db');

// Send notification to LINE Notify Group (100% Free & Simple)
const sendLineNotify = async (message) => {
  try {
    const [[setting]] = await db.query("SELECT value FROM settings WHERE `key` = 'line_notify_token'");
    const token = setting ? setting.value : null;

    if (!token || token.trim() === '') {
      console.log('[LINE Notify] Token not configured. Skipping notification.');
      return;
    }

    const response = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`
      },
      body: new URLSearchParams({ message: message })
    });

    const data = await response.json();
    console.log('[LINE Notify] Send success. Response:', data);
  } catch (err) {
    console.error('[LINE Notify Error] Failed to send notification:', err.message);
  }
};

// Send direct message to customer via LINE Messaging API (LINE OA push)
const sendLineCustomerMessage = async (customerId, message) => {
  try {
    const [[customer]] = await db.query("SELECT line_id FROM customers WHERE id = ?", [customerId]);
    const lineId = customer ? customer.line_id : null;

    if (!lineId || lineId.trim() === '') {
      console.log(`[LINE Message] Customer ID ${customerId} does not have a LINE ID configured. Skipping push message.`);
      return;
    }

    const [[tokenSetting]] = await db.query("SELECT value FROM settings WHERE `key` = 'line_channel_token'");
    const channelToken = tokenSetting ? tokenSetting.value : null;

    if (!channelToken || channelToken.trim() === '') {
      console.log('[LINE Message] Channel Access Token not configured. Skipping message push.');
      return;
    }

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`
      },
      body: JSON.stringify({
        to: lineId,
        messages: [{ type: 'text', text: message }]
      })
    });

    const data = await response.json();
    console.log('[LINE Message] Push success. Response:', data);
  } catch (err) {
    console.error('[LINE Message Error] Failed to push message to customer:', err.message);
  }
};

module.exports = {
  sendLineNotify,
  sendLineCustomerMessage
};
