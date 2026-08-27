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

// Core helper: Send LINE Push Message via LINE Messaging API
const sendLinePush = async (toUserIdOrGroupId, messages) => {
  if (!toUserIdOrGroupId || toUserIdOrGroupId.trim() === '') {
    return { success: false, message: 'Target ID is empty' };
  }

  const channelToken = await getSetting('line_channel_token');
  if (!channelToken || channelToken.trim() === '') {
    console.log('[LINE OA API] Channel Access Token not configured. Skipping notification.');
    return { success: false, message: 'Channel Access Token is not set' };
  }

  // Format array if single message passed
  const msgPayload = Array.isArray(messages) ? messages : [messages];

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`
      },
      body: JSON.stringify({
        to: toUserIdOrGroupId.trim(),
        messages: msgPayload
      })
    });

    const parsed = await response.json().catch(() => ({}));
    if (response.ok) {
      console.log(`[LINE OA Push Success] Sent to ${toUserIdOrGroupId}`);
      return { success: true, response: parsed };
    } else {
      console.error(`[LINE OA Push Failed] Status ${response.status}:`, parsed);
      return { success: false, error: parsed.message || 'Push failed', details: parsed };
    }
  } catch (err) {
    console.error('[LINE OA Network Error]:', err.message);
    return { success: false, error: err.message };
  }
};

// Helper to send to Admin/Mechanic Group
const sendToAdmin = async (messages) => {
  const adminId = await getSetting('line_admin_id');
  if (adminId && adminId.trim() !== '') {
    return await sendLinePush(adminId, messages);
  }
  return { success: false, message: 'No admin/group ID configured' };
};

// ==========================================
// 1. FLEX MESSAGE TEMPLATES
// ==========================================

// Flex: รับรถเข้าซ่อมสำเร็จ (Job Created)
const createCarReceivedFlex = (repairId, customerName, plate, description) => {
  return {
    type: 'flex',
    altText: `🚗 [อู่ BT Auto] รับรถเข้าซ่อมสำเร็จ - ใบสั่งซ่อม #${repairId} (ทะเบียน ${plate})`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0d6efd',
        paddingAll: '15px',
        contents: [
          {
            type: 'text',
            text: 'BT AUTO GARAGE',
            weight: 'bold',
            color: '#ffffff',
            size: 'xs'
          },
          {
            type: 'text',
            text: '🚗 ลงทะเบียนรับรถเข้าซ่อม',
            weight: 'bold',
            color: '#ffffff',
            size: 'lg',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'เลขที่ใบซ่อม:', size: 'sm', color: '#888888', flex: 3 },
              { type: 'text', text: `#${repairId}`, size: 'sm', color: '#111111', weight: 'bold', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ทะเบียนรถ:', size: 'sm', color: '#888888', flex: 3 },
              { type: 'text', text: `${plate}`, size: 'sm', color: '#0d6efd', weight: 'bold', flex: 5 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ลูกค้า:', size: 'sm', color: '#888888', flex: 3 },
              { type: 'text', text: `คุณ ${customerName}`, size: 'sm', color: '#111111', flex: 5 }
            ]
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              { type: 'text', text: 'อาการแจ้งซ่อม:', size: 'xs', color: '#888888' },
              { type: 'text', text: `${description}`, size: 'sm', color: '#333333', wrap: true, margin: 'xs' }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#f8f9fa',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: 'สถานะ: ⏳ รอการตรวจสภาพอย่างละเอียด',
                size: 'xs',
                color: '#666666',
                align: 'center'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          {
            type: 'text',
            text: 'ขอบพระคุณที่ไว้วางใจใช้บริการ BT Auto Garage ครับ',
            size: 'xxs',
            color: '#aaaaaa',
            align: 'center'
          }
        ]
      }
    }
  };
};

// Flex: ใบเสนอราคาพร้อมอนุมัติ (Quotation Ready)
const createQuoteReadyFlex = (repairId, customerName, cost) => {
  return {
    type: 'flex',
    altText: `💰 [อู่ BT Auto] ใบเสนอราคาประเมิน #${repairId} ยอดรวม ${parseFloat(cost).toLocaleString()} บาท`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#ffc107',
        paddingAll: '15px',
        contents: [
          { type: 'text', text: 'BT AUTO GARAGE', weight: 'bold', color: '#212529', size: 'xs' },
          { type: 'text', text: '💰 ใบเสนอราคาประเมินเบื้องต้น', weight: 'bold', color: '#212529', size: 'lg', margin: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: `เรียนคุณ ${customerName}`,
            size: 'sm',
            color: '#111111',
            weight: 'bold'
          },
          {
            type: 'text',
            text: `ทางอู่ได้ทำการตรวจเช็คสภาพรถยนต์สำหรับใบซ่อม #${repairId} เรียบร้อยแล้ว ยอดค่าใช้จ่ายประเมินเบื้องต้นคือ:`,
            size: 'sm',
            color: '#555555',
            wrap: true
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#fff3cd',
            cornerRadius: '8px',
            paddingAll: '15px',
            margin: 'md',
            contents: [
              { type: 'text', text: 'ยอดรวมประเมิน', size: 'xs', color: '#856404', align: 'center' },
              { type: 'text', text: `${parseFloat(cost).toLocaleString()} บาท`, size: 'xxl', color: '#856404', weight: 'bold', align: 'center', margin: 'xs' }
            ]
          },
          {
            type: 'text',
            text: '* กรุณาติดต่อทางอู่หรือตอบกลับข้อความนี้เพื่อยืนยันการเริ่มงานซ่อมบำรุงครับ',
            size: 'xs',
            color: '#888888',
            wrap: true
          }
        ]
      }
    }
  };
};

// Flex: งานซ่อมเสร็จสิ้น พร้อมรับรถ (Repair Completed)
const createRepairCompletedFlex = (repairId, customerName, cost) => {
  return {
    type: 'flex',
    altText: `✅ [อู่ BT Auto] ซ่อมเสร็จเรียบร้อย! ใบซ่อม #${repairId} พร้อมรับมอบรถคืน`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#198754',
        paddingAll: '15px',
        contents: [
          { type: 'text', text: 'BT AUTO GARAGE', weight: 'bold', color: '#ffffff', size: 'xs' },
          { type: 'text', text: '✅ งานซ่อมเสร็จสมบูรณ์ - พร้อมส่งมอบ', weight: 'bold', color: '#ffffff', size: 'md', margin: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: `เรียนคุณ ${customerName}`,
            size: 'sm',
            color: '#111111',
            weight: 'bold'
          },
          {
            type: 'text',
            text: `รถยนต์ของท่าน (ใบซ่อม #${repairId}) ผ่านการซ่อมบำรุงและตรวจสอบคุณภาพเรียบร้อย พร้อมสำหรับการส่งมอบรถคืนแล้วครับ`,
            size: 'sm',
            color: '#555555',
            wrap: true
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#d1e7dd',
            cornerRadius: '8px',
            paddingAll: '15px',
            margin: 'md',
            contents: [
              { type: 'text', text: 'ยอดค่าบริการจริงที่ต้องชำระ', size: 'xs', color: '#0f5132', align: 'center' },
              { type: 'text', text: `${parseFloat(cost).toLocaleString()} บาท`, size: 'xxl', color: '#0f5132', weight: 'bold', align: 'center', margin: 'xs' }
            ]
          },
          {
            type: 'text',
            text: '📍 สามารถเข้ามาตรวจรับรถและชำระเงินได้ที่อู่ BT Auto ได้ในเวลาทำการ ขอบพระคุณครับ!',
            size: 'xs',
            color: '#555555',
            wrap: true
          }
        ]
      }
    }
  };
};

// ==========================================
// 2. MAIN NOTIFICATION DISPATCHERS
// ==========================================

// ส่งแจ้งเตือนเมื่อรับรถเข้าซ่อม ("รับรถเข้าระบบสำเร็จ")
const sendCarReceivedNotification = async (repairId, customerName, plate, description) => {
  const flexMsg = createCarReceivedFlex(repairId, customerName, plate, description);
  const textMsg = {
    type: 'text',
    text: `🚗 [BT Auto - รับรถเข้าซ่อม]\n• ใบซ่อม: #${repairId}\n• ทะเบียน: ${plate}\n• ลูกค้า: คุณ ${customerName}\n• อาการ: ${description}\n\n*ช่างกำลังดำเนินการตรวจสภาพตัวรถครับ*`
  };

  // 1. Send to Admin/Staff Group
  await sendToAdmin([flexMsg]).catch(() => sendToAdmin([textMsg]));

  // 2. Send to Customer LINE (if customer has line_id)
  try {
    const [[repair]] = await db.query('SELECT customer_id FROM repairs WHERE id = ?', [repairId]);
    if (repair && repair.customer_id) {
      const [[customer]] = await db.query('SELECT line_id FROM customers WHERE id = ?', [repair.customer_id]);
      if (customer && customer.line_id && customer.line_id.trim() !== '') {
        await sendLinePush(customer.line_id, [flexMsg]).catch(() => sendLinePush(customer.line_id, [textMsg]));
      }
    }
  } catch (err) {
    console.error('[sendCarReceivedNotification Error]', err);
  }
};

// ส่งแจ้งเตือนเมื่อตั้งราคาประเมิน ("ใบเสนอราคาพร้อมอนุมัติ")
const sendQuoteReadyNotification = async (repairId, customerName, cost) => {
  const flexMsg = createQuoteReadyFlex(repairId, customerName, cost);
  const textMsg = {
    type: 'text',
    text: `💰 [BT Auto - ใบเสนอราคาพร้อมอนุมัติ]\n• ใบซ่อม: #${repairId}\n• ลูกค้า: คุณ ${customerName}\n• ยอดประเมิน: ${parseFloat(cost).toLocaleString()} บาท\n\n*โปรดติดต่ออู่เพื่อยืนยันการเริ่มงานซ่อมครับ*`
  };

  // 1. Send to Admin Group
  await sendToAdmin([flexMsg]).catch(() => sendToAdmin([textMsg]));

  // 2. Send to Customer LINE
  try {
    const [[repair]] = await db.query('SELECT customer_id FROM repairs WHERE id = ?', [repairId]);
    if (repair && repair.customer_id) {
      const [[customer]] = await db.query('SELECT line_id FROM customers WHERE id = ?', [repair.customer_id]);
      if (customer && customer.line_id && customer.line_id.trim() !== '') {
        await sendLinePush(customer.line_id, [flexMsg]).catch(() => sendLinePush(customer.line_id, [textMsg]));
      }
    }
  } catch (err) {
    console.error('[sendQuoteReadyNotification Error]', err);
  }
};

// ส่งแจ้งเตือนเมื่องานซ่อมเสร็จสิ้น ("ซ่อมเสร็จ พร้อมส่งมอบ")
const sendRepairCompletedNotification = async (repairId, customerName, cost) => {
  const flexMsg = createRepairCompletedFlex(repairId, customerName, cost);
  const textMsg = {
    type: 'text',
    text: `✅ [BT Auto - ซ่อมเสร็จเรียบร้อย พร้อมรับรถ]\n• ใบซ่อม: #${repairId}\n• ลูกค้า: คุณ ${customerName}\n• ยอดค่าใช้จ่ายจริง: ${parseFloat(cost).toLocaleString()} บาท\n\n*สามารถติดต่อรับมอบรถคืนได้ที่อู่ BT Auto ขอบพระคุณครับ!*`
  };

  // 1. Send to Admin Group
  await sendToAdmin([flexMsg]).catch(() => sendToAdmin([textMsg]));

  // 2. Send to Customer LINE
  try {
    const [[repair]] = await db.query('SELECT customer_id FROM repairs WHERE id = ?', [repairId]);
    if (repair && repair.customer_id) {
      const [[customer]] = await db.query('SELECT line_id FROM customers WHERE id = ?', [repair.customer_id]);
      if (customer && customer.line_id && customer.line_id.trim() !== '') {
        await sendLinePush(customer.line_id, [flexMsg]).catch(() => sendLinePush(customer.line_id, [textMsg]));
      }
    }
  } catch (err) {
    console.error('[sendRepairCompletedNotification Error]', err);
  }
};

// Flex: ใบเสนอราคา / ใบเสร็จรับเงินฉบับเต็ม พร้อมข้อมูล PromptPay
const createFullInvoiceFlex = ({ docType, docNo, repairId, customerName, phone, plate, carModel, desc, items, totalAmount, promptpayNumber, promptpayName, dateStr }) => {
  const isInvoice = docType === 'invoice';
  const headerBg = isInvoice ? '#198754' : '#FF6B00';
  const titleText = isInvoice ? '🧾 ใบเสร็จรับเงิน / ใบแจ้งหนี้' : '📑 ใบเสนอราคา (Quotation)';

  const itemRows = (items || []).slice(0, 6).map(it => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: it.name, size: 'xs', color: '#444444', flex: 7, wrap: true },
      { type: 'text', text: `${parseFloat(it.price).toLocaleString()} ฿`, size: 'xs', color: '#111111', weight: 'bold', align: 'end', flex: 3 }
    ]
  }));

  return {
    type: 'flex',
    altText: `📄 [อู่ BT Auto] ${titleText} #${docNo} - ยอดสุทธิ ${parseFloat(totalAmount).toLocaleString()} บาท`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: '15px',
        contents: [
          { type: 'text', text: 'BT AUTO GARAGE', weight: 'bold', color: '#ffffff', size: 'xs' },
          { type: 'text', text: titleText, weight: 'bold', color: '#ffffff', size: 'md', margin: 'xs' },
          { type: 'text', text: `เลขที่: ${docNo} | วันที่: ${dateStr}`, color: '#ffffff', size: 'xxs', margin: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ลูกค้า:', size: 'xs', color: '#888888', flex: 3 },
              { type: 'text', text: `คุณ ${customerName} (${phone})`, size: 'xs', color: '#111111', weight: 'bold', flex: 7 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ทะเบียนรถ:', size: 'xs', color: '#888888', flex: 3 },
              { type: 'text', text: `${plate} (${carModel})`, size: 'xs', color: '#0d6efd', weight: 'bold', flex: 7 }
            ]
          },
          { type: 'separator', margin: 'sm' },
          { type: 'text', text: 'รายการค่าบริการและอะไหล่:', size: 'xxs', color: '#888888', margin: 'sm' },
          ...itemRows,
          { type: 'separator', margin: 'sm' },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#fff3cd',
            cornerRadius: '8px',
            paddingAll: '12px',
            margin: 'sm',
            contents: [
              { type: 'text', text: 'ยอดรวมสุทธิที่ต้องชำระ', size: 'xs', color: '#856404', align: 'center' },
              { type: 'text', text: `${parseFloat(totalAmount).toLocaleString()} บาท`, size: 'xl', color: '#d9534f', weight: 'bold', align: 'center', margin: 'xs' }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#f1f5f9',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'sm',
            contents: [
              { type: 'text', text: `💳 พร้อมเพย์: ${promptpayNumber || '0812345678'}`, size: 'xs', color: '#002B49', weight: 'bold', align: 'center' },
              { type: 'text', text: `ชื่อบัญชี: ${promptpayName || 'BT Auto Garage'}`, size: 'xxs', color: '#555555', align: 'center', margin: 'xxs' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '10px',
        contents: [
          {
            type: 'text',
            text: '* สามารถบันทึก/สแกนชำระผ่าน Mobile Banking ทุกธนาคาร ขอบพระคุณครับ',
            size: 'xxs',
            color: '#888888',
            align: 'center',
            wrap: true
          }
        ]
      }
    }
  };
};

// ส่งใบเสนอราคา / ใบเสร็จรับเงิน เข้า LINE (ทั้งลูกค้าและแอดมิน)
const sendInvoiceQuotationNotification = async (repairId) => {
  try {
    const [repairs] = await db.query(`
      SELECT r.*, c.fullname AS customer_name, c.phone AS customer_phone, c.line_id,
             v.license_plate, v.brand, v.model
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      JOIN vehicles v ON r.vehicle_id = v.id
      WHERE r.id = ?
    `, [repairId]);

    if (repairs.length === 0) return { success: false, message: 'ไม่พบใบสั่งซ่อม' };
    const r = repairs[0];

    const [parts] = await db.query(`
      SELECT i.part_name, rp.sell_price, rp.quantity
      FROM repair_parts rp
      JOIN inventory i ON rp.part_id = i.id
      WHERE rp.repair_id = ?
    `, [repairId]);

    let partsSum = 0;
    const items = [
      { name: `ค่าแรง & บริการ: ${r.description}`, price: parseFloat(r.estimated_cost || 0) }
    ];
    parts.forEach(p => {
      const pCost = parseFloat(p.sell_price) * p.quantity;
      partsSum += pCost;
      items.push({ name: `${p.part_name} (x${p.quantity})`, price: pCost });
    });

    const isFinished = r.status === 'ready' || r.status === 'completed';
    const totalAmount = parseFloat(r.actual_cost) > 0 ? parseFloat(r.actual_cost) : (parseFloat(r.estimated_cost) + partsSum);
    const docType = isFinished ? 'invoice' : 'quotation';
    const docNo = `${isFinished ? 'INV' : 'QT'}-${r.id.toString().padStart(5, '0')}`;
    const dateStr = new Date().toLocaleDateString('th-TH');

    const ppNumber = await getSetting('promptpay_number');
    const ppName = await getSetting('promptpay_name');

    const flexMsg = createFullInvoiceFlex({
      docType,
      docNo,
      repairId: r.id,
      customerName: r.customer_name,
      phone: r.customer_phone,
      plate: r.license_plate,
      carModel: `${r.brand} ${r.model}`,
      desc: r.description,
      items,
      totalAmount,
      promptpayNumber: ppNumber,
      promptpayName: ppName,
      dateStr
    });

    const textMsg = {
      type: 'text',
      text: `📄 [BT Auto - ${docType === 'invoice' ? 'ใบเสร็จรับเงิน' : 'ใบเสนอราคา'}]\n• เลขที่: #${docNo}\n• ทะเบียน: ${r.license_plate}\n• ลูกค้า: คุณ ${r.customer_name}\n• ยอดสุทธิ: ${totalAmount.toLocaleString()} บาท\n• พร้อมเพย์: ${ppNumber || '0812345678'}\n\n*ขอบพระคุณที่ไว้วางใจใช้บริการครับ*`
    };

    let sentCount = 0;
    // 1. Send to Admin
    const adminRes = await sendToAdmin([flexMsg]).catch(() => sendToAdmin([textMsg]));
    if (adminRes && adminRes.success) sentCount++;

    // 2. Send to Customer LINE (if customer has line_id)
    if (r.line_id && r.line_id.trim() !== '') {
      const custRes = await sendLinePush(r.line_id, [flexMsg]).catch(() => sendLinePush(r.line_id, [textMsg]));
      if (custRes && custRes.success) sentCount++;
    }

    return { 
      success: true, 
      sentToAdmin: !!(adminRes && adminRes.success),
      sentToCustomer: !!(r.line_id && r.line_id.trim() !== ''),
      customerName: r.customer_name
    };
  } catch (err) {
    console.error('[sendInvoiceQuotationNotification Error]', err);
    return { success: false, error: err.message };
  }
};

// ส่งแจ้งเตือนแอดมินเมื่อสต็อกอะไหล่ต่ำกว่าเกณฑ์
const sendLowStockNotification = async (partName, currentStock, minQty) => {
  const textMsg = {
    type: 'text',
    text: `⚠️ [BT Auto - แจ้งเตือนอะไหล่ใกล้หมด]\n• รายการ: ${partName}\n• คงเหลือ: ${currentStock} ชิ้น\n• เกณฑ์ขั้นต่ำ: ${minQty} ชิ้น\n\n*กรุณาสั่งซื้ออะไหล่เพิ่มเติมเข้าระบบครับ*`
  };
  await sendToAdmin([textMsg]);
};

// Direct message to specific customer
const sendLineCustomerMessage = async (customerId, message) => {
  try {
    const [[customer]] = await db.query("SELECT line_id, fullname FROM customers WHERE id = ?", [customerId]);
    if (customer && customer.line_id && customer.line_id.trim() !== '') {
      return await sendLinePush(customer.line_id, { type: 'text', text: message });
    }
    return { success: false, message: 'No customer LINE ID' };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendLinePush,
  sendToAdmin,
  sendCarReceivedNotification,
  sendQuoteReadyNotification,
  sendRepairCompletedNotification,
  sendLowStockNotification,
  sendLineCustomerMessage,
  sendInvoiceQuotationNotification
};
