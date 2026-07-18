const db = require('../config/db');

// Helper to query dynamic settings from DB
const getSetting = async (key) => {
  try {
    const [[row]] = await db.query('SELECT value FROM settings WHERE `key` = ?', [key]);
    return row ? row.value : null;
  } catch (err) {
    console.error(`[Settings Query Error] Failed to get setting ${key}:`, err);
    return null;
  }
};

// Helper function to send LINE Notify message (Group Alert)
const sendLineNotify = async (message) => {
  const token = await getSetting('line_notify_token');
  if (!token || token.trim() === '') {
    console.log(`[LINE NOTIFY WARNING] No token found in settings table. Message would be: "${message}"`);
    return { success: false, message: 'No Token Configured' };
  }

  try {
    const response = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`
      },
      body: new URLSearchParams({ message: message })
    });
    const parsed = await response.json();
    if (response.status === 200) {
      console.log('[LINE NOTIFY] Message sent successfully!');
      return { success: true, response: parsed };
    } else {
      console.error('[LINE NOTIFY ERROR]', parsed);
      return { success: false, response: parsed };
    }
  } catch (err) {
    console.error('[LINE NOTIFY CONNECTION ERROR]', err);
    return { success: false, error: err.message };
  }
};

// Send direct push message to customer via LINE Messaging API (LINE OA Personal Message)
const sendLineCustomerMessage = async (customerId, message) => {
  try {
    const [[customer]] = await db.query("SELECT line_id, fullname FROM customers WHERE id = ?", [customerId]);
    const lineId = customer ? customer.line_id : null;

    if (!lineId || lineId.trim() === '') {
      console.log(`[LINE Customer Message] Customer ID ${customerId} (${customer ? customer.fullname : 'Unknown'}) does not have a LINE ID. Skipping push.`);
      return { success: false, message: 'No LINE ID' };
    }

    const channelToken = await getSetting('line_channel_token');
    if (!channelToken || channelToken.trim() === '') {
      console.log('[LINE Customer Message] Channel Access Token not configured in settings. Skipping push.');
      return { success: false, message: 'No Channel Token' };
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

    const parsed = await response.json();
    if (response.status === 200) {
      console.log(`[LINE Customer Message] Push notification successfully sent to ${customer.fullname}!`);
      return { success: true, response: parsed };
    } else {
      console.error('[LINE Customer Message ERROR]', parsed);
      return { success: false, response: parsed };
    }
  } catch (err) {
    console.error('[LINE Customer Message CONNECTION ERROR]', err);
    return { success: false, error: err.message };
  }
};

// Send notification when car is received ("รับรถเข้าซ่อมสำเร็จ")
const sendCarReceivedNotification = async (repairId, customerName, plate, description) => {
  const msg = `\n🚗 [รับรถเข้าระบบสำเร็จ]\n• เลขที่ใบซ่อม: #${repairId}\n• ลูกค้า: คุณ ${customerName}\n• ทะเบียนรถ: ${plate}\n• อาการแจ้งซ่อม: ${description}\n\n*ช่างกำลังดำเนินการตรวจเช็คสภาพเบื้องต้น*`;
  await sendLineNotify(msg);

  // Push personal message to customer
  try {
    const [[repair]] = await db.query('SELECT customer_id FROM repairs WHERE id = ?', [repairId]);
    if (repair && repair.customer_id) {
      const customerMsg = `🚗 สวัสดีครับคุณ ${customerName}, รถทะเบียน ${plate} ได้เข้ารับบริการที่อู่ BT Auto เรียบร้อยแล้วครับ (เลขที่ใบซ่อม #${repairId})\nอาการแจ้งซ่อม: ${description}\n\n*ช่างกำลังดำเนินการตรวจเช็คสภาพตัวรถอย่างละเอียดและจะแจ้งราคาให้ทราบต่อไปครับ*`;
      await sendLineCustomerMessage(repair.customer_id, customerMsg);
    }
  } catch (err) {
    console.error('[NotificationService Exception]', err);
  }
};

// Send notification when price quotation is set ("ใบเสนอราคาพร้อมให้อนุมัติ")
const sendQuoteReadyNotification = async (repairId, customerName, cost) => {
  const msg = `\n💰 [ใบเสนอราคาประเมินพร้อมอนุมัติ]\n• เลขที่ใบซ่อม: #${repairId}\n• ลูกค้า: คุณ ${customerName}\n• ราคาประเมินเบื้องต้น: ${parseFloat(cost).toLocaleString()} บาท\n\n*กรุณาตรวจสอบรายละเอียดและอนุมัติการซ่อมบำรุง*`;
  await sendLineNotify(msg);

  // Push personal message to customer
  try {
    const [[repair]] = await db.query('SELECT customer_id FROM repairs WHERE id = ?', [repairId]);
    if (repair && repair.customer_id) {
      const customerMsg = `💰 [ใบเสนอราคาพร้อมให้อนุมัติ]\nเรียนคุณ ${customerName}, ยอดประเมินค่าใช้จ่ายสำหรับใบสั่งซ่อม #${repairId} คือ ${parseFloat(cost).toLocaleString()} บาทครับ\n\n*โปรดตรวจสอบรายการชิ้นส่วนที่ใบสั่งซ่อมและกรุณายืนยันอนุมัติการซ่อมผ่านลิงก์ใบสั่งซ่อมหรือติดต่อทางอู่ได้เลยครับ*`;
      await sendLineCustomerMessage(repair.customer_id, customerMsg);
    }
  } catch (err) {
    console.error('[NotificationService Exception]', err);
  }
};

// Send notification when repair is completed ("ซ่อมเสร็จสิ้น พร้อมส่งมอบ")
const sendRepairCompletedNotification = async (repairId, customerName, cost) => {
  const msg = `\n✅ [งานซ่อมเสร็จสิ้น - พร้อมรับรถ]\n• เลขที่ใบซ่อม: #${repairId}\n• ลูกค้า: คุณ ${customerName}\n• ยอดค่าใช้จ่ายจริง: ${parseFloat(cost).toLocaleString()} บาท\n\n*รถยนต์ของท่านผ่านการตรวจสอบคุณภาพเรียบร้อย สามารถเข้ามาติดต่อรับรถคืนได้ที่อู่ BT Auto*`;
  await sendLineNotify(msg);

  // Push personal message to customer
  try {
    const [[repair]] = await db.query('SELECT customer_id FROM repairs WHERE id = ?', [repairId]);
    if (repair && repair.customer_id) {
      const customerMsg = `✅ [งานซ่อมเสร็จเรียบร้อย!]\nเรียนคุณ ${customerName}, รถยนต์ของท่านซ่อมบำรุงและผ่านการตรวจสอบเสร็จเรียบร้อยแล้วครับ (ใบสั่งซ่อม #${repairId})\nยอดค่าบริการซ่อมจริง: ${parseFloat(cost).toLocaleString()} บาท\n\n*สามารถนำเอกสารหรือติดต่อแผนกต้อนรับเพื่อตรวจรับมอบรถคืนและชำระค่าบริการได้เลยครับ ขอบพระคุณครับ!*`;
      await sendLineCustomerMessage(repair.customer_id, customerMsg);
    }
  } catch (err) {
    console.error('[NotificationService Exception]', err);
  }
};

// Send alert to admin when stock is low ("แจ้งเตือนแอดมินเมื่อสต็อกอะไหล่ต่ำกว่าเกณฑ์")
const sendLowStockNotification = async (partName, currentStock, minQty) => {
  const msg = `\n⚠️ [แจ้งเตือน: อะไหล่ขาดสต็อก]\n• รายการ: ${partName}\n• จำนวนคงเหลือ: ${currentStock} ชิ้น\n• เกณฑ์เตือนขั้นต่ำ: ${minQty} ชิ้น\n\n*กรุณาสั่งซื้ออะไหล่เติมสต็อกเข้าระบบด่วนเพื่อป้องกันงานสะดุด*`;
  await sendLineNotify(msg);
};

module.exports = {
  sendCarReceivedNotification,
  sendQuoteReadyNotification,
  sendRepairCompletedNotification,
  sendLowStockNotification,
  sendLineCustomerMessage
};
