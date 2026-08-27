const notificationService = require('../services/notificationService');

module.exports = {
  sendLineNotify: async (message) => {
    return await notificationService.sendToAdmin({ type: 'text', text: message });
  },
  sendLineCustomerMessage: notificationService.sendLineCustomerMessage,
  sendLinePush: notificationService.sendLinePush
};
