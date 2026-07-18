require('dotenv').config();

// LINE config parameters
const lineConfig = {
  // We can use LINE Notify or LINE Messaging API token
  notifyToken: process.env.LINE_NOTIFY_TOKEN || null,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || null
};

module.exports = lineConfig;
