const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Helper to log audit actions in system
const logAuditAction = async (userId, action, details) => {
  try {
    const sql = 'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)';
    await db.query(sql, [userId, action, details]);
  } catch (err) {
    console.error('Audit Log Insertion Failed:', err);
  }
};

// Render Settings & System Management screen
const getSettings = async (req, res) => {
  try {
    // 1. Fetch staff users (excluding password)
    const [staff] = await db.query('SELECT id, username, fullname, role, phone, status, created_at FROM users ORDER BY role ASC, fullname ASC');

    // 2. Fetch recent 20 audit logs
    const [logs] = await db.query(`
      SELECT al.*, u.fullname AS user_fullname 
      FROM audit_logs al
      JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC LIMIT 20
    `);

    // 3. Fetch system settings
    const [settingsRows] = await db.query('SELECT * FROM settings');
    const settingsMap = {};
    settingsRows.forEach(s => settingsMap[s.key] = s.value);

    res.render('settings', {
      title: 'จัดการระบบ',
      activePage: 'settings',
      staffList: staff,
      auditLogs: logs,
      lineSettings: settingsMap
    });
  } catch (err) {
    console.error('Get Settings Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลระบบงานควบคุมได้' });
  }
};

// Update user password (Admin/Owner action)
const updatePassword = async (req, res) => {
  const { staff_id, new_password } = req.body;

  if (!staff_id || !new_password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสผ่านใหม่และเลือกผู้ใช้' });
  }

  try {
    const hashedPassword = await bcrypt.hash(new_password, 10);
    const sql = 'UPDATE users SET password = ? WHERE id = ?';
    await db.query(sql, [hashedPassword, staff_id]);

    const [[user]] = await db.query('SELECT fullname FROM users WHERE id = ?', [staff_id]);
    await logAuditAction(req.session.user.id, 'change_password', `เปลี่ยนรหัสผ่านสำหรับผู้ใช้งาน: ${user.fullname}`);

    res.json({ success: true, message: `เปลี่ยนรหัสผ่านสำเร็จ สำหรับคุณ ${user.fullname}` });
  } catch (err) {
    console.error('Update Password Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน' });
  }
};

// Backup MySQL database to an SQL dump file download
const backupDatabase = async (req, res) => {
  try {
    let sqlDump = `-- BT Auto GarageFlow Database Backup\n`;
    sqlDump += `-- Date: ${new Date().toLocaleString('th-TH')}\n`;
    sqlDump += `\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

    const tables = ['users', 'customers', 'vehicles', 'repairs', 'inventory', 'finances', 'repair_logs', 'repair_parts', 'audit_logs'];

    for (const table of tables) {
      sqlDump += `-- --------------------------------------------------------\n`;
      sqlDump += `-- Table structure for table \`${table}\`\n`;
      sqlDump += `-- --------------------------------------------------------\n`;
      
      // Get Create Table DDL
      const [[createTableResult]] = await db.query(`SHOW CREATE TABLE \`${table}\``);
      const createDDL = createTableResult['Create Table'];
      sqlDump += `DROP TABLE IF EXISTS \`${table}\`;\n`;
      sqlDump += `${createDDL};\n\n`;

      // Get Table Rows Data
      const [rows] = await db.query(`SELECT * FROM \`${table}\``);
      if (rows.length > 0) {
        sqlDump += `-- Dumping data for table \`${table}\`\n`;
        for (const row of rows) {
          const keys = Object.keys(row).map(k => `\`${k}\``).join(', ');
          const values = Object.values(row).map(val => {
            if (val === null) return 'NULL';
            if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            return val;
          }).join(', ');
          
          sqlDump += `INSERT INTO \`${table}\` (${keys}) VALUES (${values});\n`;
        }
        sqlDump += `\n`;
      }
    }

    sqlDump += `SET FOREIGN_KEY_CHECKS=1;\n`;

    // Trigger download
    const filename = `backup-garageflow-${new Date().toISOString().split('T')[0]}.sql`;
    res.setHeader('Content-disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-type', 'text/plain');
    res.charset = 'UTF-8';
    res.write(sqlDump);
    res.end();

    await logAuditAction(req.session.user.id, 'backup_db', 'สำรองข้อมูลฐานข้อมูลสำเร็จ');
  } catch (err) {
    console.error('Backup Error:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการสำรองข้อมูลฐานข้อมูล: ' + err.message);
  }
};

// Restore MySQL database from uploaded SQL file contents
const restoreDatabase = async (req, res) => {
  const { sql_content } = req.body;

  if (!sql_content) {
    return res.status(400).json({ success: false, message: 'ไม่พบเนื้อหาไฟล์ SQL สำหรับกู้คืน' });
  }

  // Splitting statements. Let's make sure it handles multiline correctly.
  const statements = sql_content
    .split(/;(?=(?:[^']*'[^']*')*[^']*$)/g) // split by semicolon outside quotes
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const statement of statements) {
      // Remove comments
      const cleaned = statement
        .split('\n')
        .filter(line => !line.trim().startsWith('--') && !line.trim().startsWith('#'))
        .join('\n')
        .trim();

      if (cleaned) {
        await conn.query(cleaned);
      }
    }

    await conn.commit();
    
    // Log the restore action
    await logAuditAction(req.session.user.id, 'restore_db', 'กู้คืนฐานข้อมูลจากไฟล์สำรองสำเร็จ');

    res.json({ success: true, message: 'กู้คืนฐานข้อมูล (Restore Database) สำเร็จเรียบร้อยแล้ว!' });
  } catch (err) {
    await conn.rollback();
    console.error('Restore Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการรันไฟล์กู้คืนข้อมูล: ' + err.message });
  } finally {
    conn.release();
  }
};

// Update LINE configurations in settings table
const updateLineSettings = async (req, res) => {
  const { line_channel_token, line_channel_secret, line_admin_id, line_notify_token } = req.body;
  
  try {
    await db.query("INSERT INTO settings (`key`, value) VALUES ('line_channel_token', ?) ON DUPLICATE KEY UPDATE value = ?", [line_channel_token || '', line_channel_token || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('line_channel_secret', ?) ON DUPLICATE KEY UPDATE value = ?", [line_channel_secret || '', line_channel_secret || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('line_admin_id', ?) ON DUPLICATE KEY UPDATE value = ?", [line_admin_id || '', line_admin_id || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('line_notify_token', ?) ON DUPLICATE KEY UPDATE value = ?", [line_notify_token || '', line_notify_token || '']);
    
    await logAuditAction(req.session.user.id, 'update_line_settings', 'อัปเดตการตั้งค่าระบบ LINE Official Account Messaging API');
    
    res.json({ success: true, message: 'บันทึกการตั้งค่าระบบ LINE เรียบร้อยแล้ว!' });
  } catch (err) {
    console.error('Update LINE Settings Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่า LINE' });
  }
};

// Update PromptPay and Payment configurations in settings table
const updatePaymentSettings = async (req, res) => {
  const { promptpay_number, promptpay_name, bank_name, bank_account_no, bank_account_name } = req.body;
  
  try {
    await db.query("INSERT INTO settings (`key`, value) VALUES ('promptpay_number', ?) ON DUPLICATE KEY UPDATE value = ?", [promptpay_number || '', promptpay_number || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('promptpay_name', ?) ON DUPLICATE KEY UPDATE value = ?", [promptpay_name || '', promptpay_name || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('bank_name', ?) ON DUPLICATE KEY UPDATE value = ?", [bank_name || '', bank_name || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('bank_account_no', ?) ON DUPLICATE KEY UPDATE value = ?", [bank_account_no || '', bank_account_no || '']);
    await db.query("INSERT INTO settings (`key`, value) VALUES ('bank_account_name', ?) ON DUPLICATE KEY UPDATE value = ?", [bank_account_name || '', bank_account_name || '']);
    
    await logAuditAction(req.session.user.id, 'update_payment_settings', `อัปเดตข้อมูลพร้อมเพย์สำหรับรับเงิน: ${promptpay_number}`);
    
    res.json({ success: true, message: 'บันทึกการตั้งค่าพร้อมเพย์และบัญชีธนาคารเรียบร้อยแล้ว!' });
  } catch (err) {
    console.error('Update Payment Settings Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่าบัญชีรับเงิน' });
  }
};

// Test Sending LINE Notification
const testLineNotification = async (req, res) => {
  const notificationService = require('../services/notificationService');
  const { target_id } = req.body;

  try {
    const [[adminSetting]] = await db.query("SELECT value FROM settings WHERE `key` = 'line_admin_id'");
    const target = target_id || (adminSetting ? adminSetting.value : null);

    if (!target || target.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณากรอก LINE Admin User ID หรือ Group ID เพื่อทดสอบส่งข้อความ' 
      });
    }

    const testFlex = {
      type: 'flex',
      altText: '🔔 [ทดสอบระบบ] การเชื่อมต่อ LINE Messaging API สำเร็จ!',
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#198754',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: 'BT AUTO GARAGE', weight: 'bold', color: '#ffffff', size: 'xs' },
            { type: 'text', text: '🔔 ทดสอบการแจ้งเตือนสำเร็จ!', weight: 'bold', color: '#ffffff', size: 'md', margin: 'xs' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: 'ระบบ LINE Official Account เชื่อมต่อกับระบบอู่สำเร็จ 100%', size: 'sm', color: '#333333', wrap: true },
            { type: 'text', text: `เวลาทดสอบ: ${new Date().toLocaleString('th-TH')}`, size: 'xs', color: '#888888' }
          ]
        }
      }
    };

    const result = await notificationService.sendLinePush(target.trim(), [testFlex]);
    if (result.success) {
      res.json({ success: true, message: 'ส่งข้อความทดสอบเข้า LINE สำเร็จเรียบร้อย!' });
    } else {
      res.status(400).json({ success: false, message: result.error || 'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบ Channel Access Token และ User ID' });
    }
  } catch (err) {
    console.error('Test LINE Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
};

// LINE Reply Message Helper
const replyLineMessage = async (replyToken, messages) => {
  try {
    const [[tokenSetting]] = await db.query("SELECT value FROM settings WHERE `key` = 'line_channel_token'");
    const channelToken = tokenSetting ? tokenSetting.value : null;

    if (!channelToken || channelToken.trim() === '') return;

    const payload = Array.isArray(messages) ? messages : [
      typeof messages === 'string' ? { type: 'text', text: messages } : messages
    ];

    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: payload
      })
    });
  } catch (err) {
    console.error('[LINE Webhook Reply Error]', err.message);
  }
};

// Public LINE OA Webhook Endpoint (Smart Role-Based 1-on-1 Chatbot)
const lineWebhook = async (req, res) => {
  res.sendStatus(200);

  const events = req.body.events;
  if (!events || !Array.isArray(events)) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    const userId = event.source ? event.source.userId : null;

    if (!replyToken || !userId) continue;

    // 1. Determine User Role (Admin / Owner vs Customer vs Guest)
    let userRole = 'guest';
    let userProfile = null;

    try {
      const [[adminSetting]] = await db.query("SELECT value FROM settings WHERE `key` = 'line_admin_id'");
      const adminId = adminSetting ? adminSetting.value : '';

      if (adminId && adminId.trim() === userId) {
        userRole = 'owner';
      } else {
        // Check if user is registered as customer
        const [[customer]] = await db.query('SELECT * FROM customers WHERE line_id = ?', [userId]);
        if (customer) {
          userRole = 'customer';
          userProfile = customer;
        }
      }
    } catch (err) {
      console.error('[LINE User Identity Check Error]', err);
    }

    // 2. Follow Event (User adds LINE OA)
    if (event.type === 'follow') {
      if (userRole === 'owner') {
        const welcomeOwner = `👑 สวัสดีครับคุณเจ้าของอู่ (ระบบตรวจพบว่าเป็นผู้ดูแลระบบ)!\n\nท่านสามารถสั่งการและดูข้อมูลอู่ได้ทันทีครับ:\n1️⃣ พิมพ์ "สรุป" - ดูภาพรวมงานซ่อมและรายรับ\n2️⃣ พิมพ์ "รถในอู่" - รายชื่อรถที่กำลังซ่อม\n3️⃣ พิมพ์ "อะไหล่" - เช็คสต็อกอะไหล่ใกล้หมด\n4️⃣ พิมพ์ "ทะเบียนรถ" - ดูใบซ่อมเชิงลึก`;
        await replyLineMessage(replyToken, welcomeOwner);
      } else if (userRole === 'customer') {
        const welcomeCust = `🚗 สวัสดีครับคุณ ${userProfile.fullname}!\n\nยินดีต้อนรับกลับสู่อู่ BT Auto ครับ 😊\n• พิมพ์ "สถานะ" - เช็คความคืบหน้างานซ่อม\n• พิมพ์ "ประวัติ" - ดูประวัติการซ่อมทั้งหมด\n• พิมพ์ "ติดต่อ" - ข้อมูลร้านและเบอร์โทร`;
        await replyLineMessage(replyToken, welcomeCust);
      } else {
        const welcomeGuest = `ยินดีต้อนรับสู่อู่ BT Auto Garage ครับ! 🎉\n\n📌 ลูกค้า: พิมพ์ "เบอร์โทรศัพท์" (เช่น 0812345678) เพื่อผูกบัญชีรับแจ้งเตือนอัตโนมัติ\n📌 เช็คสถานะ: พิมพ์ "เลขทะเบียนรถ" (เช่น กก 1234)\n📌 เจ้าของร้าน: นำรหัส User ID นี้ไปบันทึกในหน้าเว็บเพื่อเปิดโหมดแอดมินครับ:\n👉 ${userId}`;
        await replyLineMessage(replyToken, welcomeGuest);
      }
      continue;
    }

    // 3. Text Message Event
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const rawText = event.message.text.trim();
      const lowerText = rawText.toLowerCase();
      const cleanPhone = rawText.replace(/[-\s]/g, '');

      // ==========================================
      // A. OWNER / ADMIN MODE 👑
      // ==========================================
      if (userRole === 'owner') {
        if (lowerText === 'สรุป' || lowerText === 'ยอด' || lowerText === 'dashboard' || lowerText === '1') {
          try {
            const [[pendingCount]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status IN ('pending', 'inspecting')");
            const [[repairingCount]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status IN ('repairing', 'waiting_parts')");
            const [[completedCount]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'completed'");
            const [[incomeMonth]] = await db.query("SELECT SUM(amount) AS total FROM finances WHERE type = 'income' AND status = 'paid' AND MONTH(transaction_date) = MONTH(CURRENT_DATE())");
            const [[lowStock]] = await db.query("SELECT COUNT(*) AS count FROM inventory WHERE stock_qty <= min_qty");

            const summaryMsg = `📊 [สรุปภาพรวมอู่ BT Auto - วันนี้]\n\n• ⏳ รถรอตรวจ/รอราคา: ${pendingCount.count} คัน\n• 🔧 รถกำลังซ่อมบำรุง: ${repairingCount.count} คัน\n• ✅ รถซ่อมเสร็จพร้อมส่ง: ${completedCount.count} คัน\n• 📦 อะไหล่ใกล้หมด: ${lowStock.count} รายการ\n• 💰 รายรับรวมเดือนนี้: ${(parseFloat(incomeMonth.total || 0)).toLocaleString()} บาท\n\n*พิมพ์ "รถในอู่" หรือ "อะไหล่" เพื่อดูรายละเอียด*`;
            await replyLineMessage(replyToken, summaryMsg);
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการดึงข้อมูลสรุป: ' + err.message);
          }
        } 
        else if (lowerText === 'รถในอู่' || lowerText === 'งานซ่อม' || lowerText === '2') {
          try {
            const [activeRepairs] = await db.query(`
              SELECT r.id, r.status, v.license_plate, v.brand, v.model, c.fullname AS customer_name, u.fullname AS mechanic_name
              FROM repairs r
              JOIN vehicles v ON r.vehicle_id = v.id
              JOIN customers c ON r.customer_id = c.id
              LEFT JOIN users u ON r.mechanic_id = u.id
              WHERE r.status NOT IN ('delivered', 'cancelled')
              ORDER BY r.id DESC LIMIT 8
            `);

            if (activeRepairs.length === 0) {
              await replyLineMessage(replyToken, '🚗 ตอนนี้ไม่มีรถค้างซ่อมในอู่ครับ ทุกคันส่งมอบเรียบร้อย!');
            } else {
              let listMsg = `🚗 [รายการรถที่อยู่ในอู่ขณะนี้ (${activeRepairs.length} คัน)]\n`;
              activeRepairs.forEach(r => {
                const statusEmoji = r.status === 'completed' ? '✅' : (r.status === 'repairing' ? '🔧' : '⏳');
                listMsg += `\n${statusEmoji} #${r.id} | ${r.license_plate}\n   ลูกค้า: ${r.customer_name}\n   ช่าง: ${r.mechanic_name || 'ยังไม่ระบุ'}\n`;
              });
              listMsg += `\n*พิมพ์เลขทะเบียนเพื่อดูรายละเอียดใบซ่อมแต่ละคัน*`;
              await replyLineMessage(replyToken, listMsg);
            }
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการดึงรายการรถ: ' + err.message);
          }
        }
        else if (lowerText === 'อะไหล่' || lowerText === 'สต็อก' || lowerText === '3') {
          try {
            const [lowParts] = await db.query("SELECT part_name, stock_qty, min_qty, sell_price FROM inventory WHERE stock_qty <= min_qty LIMIT 10");
            if (lowParts.length === 0) {
              await replyLineMessage(replyToken, '📦 คลังอะไหล่สมบูรณ์ดี! ไม่มีรายการใดที่ต่ำกว่าเกณฑ์ขั้นต่ำครับ');
            } else {
              let partMsg = `⚠️ [แจ้งเตือนสต็อกอะไหล่ใกล้หมด (${lowParts.length} รายการ)]\n`;
              lowParts.forEach(p => {
                partMsg += `\n• ${p.part_name}\n  คงเหลือ: ${p.stock_qty} (เกณฑ์เตือน: ${p.min_qty})\n`;
              });
              partMsg += `\n*กรุณาตรวจสอบและสั่งซื้อผ่านหน้าเว็บ*`;
              await replyLineMessage(replyToken, partMsg);
            }
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการดึงสต็อก: ' + err.message);
          }
        }
        // Check Attendance Command for Owner
        else if (lowerText === 'เช็คชื่อ' || lowerText === 'พนักงาน' || lowerText === 'ลูกจ้าง' || lowerText === '4') {
          try {
            const today = new Date().toISOString().split('T')[0];
            const [staffList] = await db.query("SELECT id, fullname, skills FROM users WHERE role != 'owner' AND status = 'active'");
            const [attRows] = await db.query("SELECT * FROM attendances WHERE work_date = ?", [today]);
            const attMap = {};
            attRows.forEach(a => attMap[a.user_id] = a);

            let attMsg = `📋 [รายงานการเช็คชื่อลูกจ้าง - วันนี้ (${today})]\n`;
            staffList.forEach(s => {
              const a = attMap[s.id];
              if (!a) {
                attMsg += `\n❌ ${s.fullname}: ยังไม่เช็คชื่อ`;
              } else if (a.status === 'present') {
                const inTime = a.clock_in ? new Date(a.clock_in).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';
                attMsg += `\n✅ ${s.fullname}: มาตรงเวลา (${inTime} น.)`;
              } else if (a.status === 'late') {
                const inTime = a.clock_in ? new Date(a.clock_in).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';
                attMsg += `\n⚠️ ${s.fullname}: มาสาย (${inTime} น.)`;
              } else if (a.status === 'leave_sick') {
                attMsg += `\n🏥 ${s.fullname}: ลาป่วย (${a.notes || 'มีอาการป่วย'})`;
              } else if (a.status === 'leave_business') {
                attMsg += `\n🏖️ ${s.fullname}: ลากิจ (${a.notes || 'ธุระส่วนตัว'})`;
              } else if (a.status === 'leave_vacation') {
                attMsg += `\n🌴 ${s.fullname}: ลาพักร้อน`;
              } else if (a.status === 'absent') {
                attMsg += `\n❌ ${s.fullname}: ขาดงาน`;
              }
            });

            attMsg += `\n\n💡 *วิธีสั่งเช็คชื่อผ่าน LINE:*\nพิมพ์: เช็คชื่อ [ชื่อช่าง] [มา / สาย / ลาป่วย / ลากิจ] (เช่น: เช็คชื่อ สมศักดิ์ มา)`;
            await replyLineMessage(replyToken, attMsg);
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการดึงข้อมูลเช็คชื่อ: ' + err.message);
          }
        }
        // Wage & Salary Summary Command for Owner
        else if (lowerText === 'ค่าจ้าง' || lowerText === 'เงินเดือน' || lowerText === 'payroll' || lowerText === '5') {
          try {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const sql = `
              SELECT u.*,
                COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_days,
                COUNT(CASE WHEN a.status = 'late' THEN 1 END) AS late_days,
                COUNT(CASE WHEN a.status LIKE 'leave%' THEN 1 END) AS leave_days,
                COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_days,
                COUNT(CASE WHEN a.status IN ('present', 'late') THEN 1 END) AS work_days
              FROM users u
              LEFT JOIN attendances a ON u.id = a.user_id AND DATE_FORMAT(a.work_date, '%Y-%m') = ?
              WHERE u.role = 'mechanic' AND u.status = 'active'
              GROUP BY u.id ORDER BY u.fullname ASC
            `;
            const [mechanics] = await db.query(sql, [currentMonth]);

            if (mechanics.length === 0) {
              await replyLineMessage(replyToken, 'ยังไม่มีข้อมูลช่างซ่อมที่เปิดใช้งานในระบบครับ');
            } else {
              let wageMsg = `💰 [สรุปวันทำงาน & คำนวณค่าจ้างงวด ${currentMonth}]\n`;
              let grandTotal = 0;

              mechanics.forEach(m => {
                const rate = parseFloat(m.salary_rate || 0);
                const workedDays = parseInt(m.work_days || 0);
                const absentDays = parseInt(m.absent_days || 0);
                let wage = 0;

                if (m.salary_type === 'daily') {
                  wage = workedDays * rate;
                } else {
                  const dailyDeduct = rate / 30;
                  wage = Math.max(0, rate - (absentDays * dailyDeduct));
                }
                wage = Math.round(wage);
                grandTotal += wage;

                const typeText = m.salary_type === 'daily' ? `รายวัน (฿${rate.toLocaleString()}/วัน)` : `รายเดือน (฿${rate.toLocaleString()}/ด.)`;
                wageMsg += `\n👤 คุณ ${m.fullname}\n• ประเภท: ${typeText}\n• มาทำงานจริง: ${workedDays} วัน (สาย ${m.late_days}, ลา ${m.leave_days}, ขาด ${absentDays})\n• 💵 ยอดค่าจ้างสะสม: ฿${wage.toLocaleString()} บาท\n`;
              });

              wageMsg += `\n📊 *ยอดรวมค่าจ้างช่างทั้งหมดงวดนี้: ฿${grandTotal.toLocaleString()} บาท*`;
              await replyLineMessage(replyToken, wageMsg);
            }
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการคำนวณค่าจ้าง: ' + err.message);
          }
        }
        // Direct Action: เช็คชื่อ [ชื่อช่าง] [สถานะ/เวลา]
        else if (rawText.startsWith('เช็คชื่อ ') || rawText.startsWith('เช็ค ')) {
          try {
            const parts = rawText.split(/\s+/);
            const targetName = parts[1];
            const actionStatus = parts[2] ? parts[2].toLowerCase() : 'มา';
            const extraNote = parts.slice(3).join(' ');

            const [foundStaff] = await db.query("SELECT id, fullname FROM users WHERE role != 'owner' AND fullname LIKE ?", [`%${targetName}%`]);
            if (foundStaff.length === 0) {
              await replyLineMessage(replyToken, `ขออภัยครับ ไม่พบรายชื่อลูกจ้างหรือช่างที่ชื่อ "${targetName}"`);
            } else {
              const staff = foundStaff[0];
              const today = new Date().toISOString().split('T')[0];
              const now = new Date();
              let finalStatus = 'present';
              let clockInTime = `${today} 08:30:00`;

              if (actionStatus === 'สาย' || actionStatus === 'late') {
                finalStatus = 'late';
                clockInTime = `${today} 09:00:00`;
              } else if (actionStatus === 'ลาป่วย' || actionStatus === 'ป่วย') {
                finalStatus = 'leave_sick';
                clockInTime = null;
              } else if (actionStatus === 'ลากิจ' || actionStatus === 'ลา') {
                finalStatus = 'leave_business';
                clockInTime = null;
              } else if (actionStatus === 'พักร้อน') {
                finalStatus = 'leave_vacation';
                clockInTime = null;
              } else if (actionStatus === 'ขาด' || actionStatus === 'ขาดงาน') {
                finalStatus = 'absent';
                clockInTime = null;
              }

              const sql = `
                INSERT INTO attendances (user_id, work_date, clock_in, status, notes)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE clock_in = VALUES(clock_in), status = VALUES(status), notes = VALUES(notes)
              `;
              await db.query(sql, [staff.id, today, clockInTime, finalStatus, extraNote || null]);

              const statusLabels = {
                'present': '✅ มาทำงาน (ตรงเวลา)',
                'late': '⚠️ มาสาย',
                'leave_sick': '🏥 ลาป่วย',
                'leave_business': '🏖️ ลากิจ',
                'leave_vacation': '🌴 ลาพักร้อน',
                'absent': '❌ ขาดงาน'
              };

              await replyLineMessage(replyToken, `👌 บันทึกการเช็คชื่อของ "${staff.fullname}"\n• สถานะ: ${statusLabels[finalStatus]}\n• วันที่: ${today}\n• หมายเหตุ: ${extraNote || '-'}`);
            }
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
          }
        }
        else {
          try {
            const [repairs] = await db.query(`
              SELECT r.*, v.license_plate, v.brand, v.model, v.color, c.fullname AS customer_name, c.phone AS customer_phone, u.fullname AS mechanic_name
              FROM repairs r
              JOIN vehicles v ON r.vehicle_id = v.id
              JOIN customers c ON r.customer_id = c.id
              LEFT JOIN users u ON r.mechanic_id = u.id
              WHERE v.license_plate LIKE ? OR r.id = ?
              ORDER BY r.id DESC LIMIT 1
            `, [`%${rawText}%`, parseInt(rawText) || 0]);

            if (repairs.length > 0) {
              const r = repairs[0];
              const detailMsg = `📋 [ข้อมูลใบสั่งซ่อม #${r.id} (โหมดเจ้าของร้าน)]\n\n• ทะเบียน: ${r.license_plate} (${r.brand} ${r.model})\n• ลูกค้า: คุณ ${r.customer_name} (📞 ${r.customer_phone})\n• ช่างผู้ดูแล: ${r.mechanic_name || 'ยังไม่ได้มอบหมาย'}\n• สถานะ: ${r.status}\n• อาการ: ${r.description}\n• ราคาประเมิน: ${parseFloat(r.estimated_cost || 0).toLocaleString()} บาท\n• ค่าบริการจริง: ${parseFloat(r.actual_cost || 0).toLocaleString()} บาท`;
              await replyLineMessage(replyToken, detailMsg);
            } else {
              const adminHelp = `👑 [เมนูคำสั่งสำหรับเจ้าของร้าน]\n\n1️⃣ พิมพ์ "สรุป" - ภาพรวมอู่และรายรับ\n2️⃣ พิมพ์ "รถในอู่" - รถที่กำลังซ่อมบำรุง\n3️⃣ พิมพ์ "อะไหล่" - เช็คของใกล้หมดสต็อก\n4️⃣ พิมพ์ "ทะเบียนรถ" (เช่น กก 1234) - ดูใบซ่อมเชิงลึก`;
              await replyLineMessage(replyToken, adminHelp);
            }
          } catch (err) {
            console.error(err);
          }
        }
      }

      // ==========================================
      // B. REGISTERED CUSTOMER MODE 🚗
      // ==========================================
      else if (userRole === 'customer') {
        if (lowerText === 'สถานะ' || lowerText === 'รถของฉัน' || lowerText === '1') {
          try {
            const [myRepairs] = await db.query(`
              SELECT r.*, v.license_plate, v.brand, v.model
              FROM repairs r
              JOIN vehicles v ON r.vehicle_id = v.id
              WHERE r.customer_id = ?
              ORDER BY r.id DESC LIMIT 1
            `, [userProfile.id]);

            if (myRepairs.length > 0) {
              const r = myRepairs[0];
              const statusMap = {
                'pending': '⏳ รับรถเข้าระบบแล้ว (รอตรวจเช็คสภาพ)',
                'inspecting': '🔍 กำลังตรวจเช็คและจัดทำใบเสนอราคา',
                'repairing': '🔧 กำลังอยู่ระหว่างการซ่อมบำรุง',
                'waiting_parts': '📦 รอชิ้นส่วนอะไหล่จากผู้ผลิต',
                'completed': '✅ ซ่อมเสร็จสมบูรณ์ พร้อมรับมอบรถคืน',
                'delivered': '🚗 ส่งมอบรถคืนเรียบร้อยแล้ว',
                'cancelled': '❌ ยกเลิกงานซ่อม'
              };
              const statusText = statusMap[r.status] || r.status;
              const msg = `🚗 ข้อมูลสถานะรถของคุณ ${userProfile.fullname}\n\n• ทะเบียน: ${r.license_plate} (${r.brand} ${r.model})\n• เลขที่ใบซ่อม: #${r.id}\n• สถานะปัจจุบัน: ${statusText}\n• อาการแจ้งซ่อม: ${r.description}\n• ยอดประเมิน: ${parseFloat(r.estimated_cost || 0).toLocaleString()} บาท\n\n*หากมีข้อสงสัย สามารถพิมพ์ติดต่อเจ้าหน้าที่ได้เลยครับ*`;
              await replyLineMessage(replyToken, msg);
            } else {
              await replyLineMessage(replyToken, `คุณ ${userProfile.fullname} ยังไม่มีรายการซ่อมรถที่กำลังดำเนินอยู่ในขณะนี้ครับ 😊`);
            }
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาด: ' + err.message);
          }
        }
        else if (lowerText === 'ประวัติ' || lowerText === '2') {
          try {
            const [history] = await db.query(`
              SELECT r.id, r.status, r.created_at, r.actual_cost, v.license_plate
              FROM repairs r
              JOIN vehicles v ON r.vehicle_id = v.id
              WHERE r.customer_id = ?
              ORDER BY r.id DESC LIMIT 5
            `, [userProfile.id]);

            if (history.length === 0) {
              await replyLineMessage(replyToken, 'ยังไม่พบประวัติการซ่อมในระบบครับ');
            } else {
              let histMsg = `📄 [ประวัติการรับบริการของคุณ ${userProfile.fullname}]\n`;
              history.forEach(h => {
                histMsg += `\n• #${h.id} (${h.license_plate}) - ${h.status}\n  ยอดชำระ: ${parseFloat(h.actual_cost || 0).toLocaleString()} บาท\n`;
              });
              await replyLineMessage(replyToken, histMsg);
            }
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาด: ' + err.message);
          }
        }
        else if (lowerText.includes('พร้อมเพย์') || lowerText.includes('โอนเงิน') || lowerText.includes('บัญชี') || lowerText.includes('จ่าย') || lowerText.includes('qr')) {
          try {
            const ppNumber = await getSetting('promptpay_number') || '0812345678';
            const ppName = await getSetting('promptpay_name') || 'BT Auto Garage';
            const bankName = await getSetting('bank_name') || 'ธนาคารกสิกรไทย';
            const bankAcc = await getSetting('bank_account_no') || '-';

            const [myRepairs] = await db.query(`
              SELECT r.id, r.estimated_cost, r.actual_cost, r.status, v.license_plate
              FROM repairs r
              JOIN vehicles v ON r.vehicle_id = v.id
              WHERE r.customer_id = ?
              ORDER BY r.id DESC LIMIT 1
            `, [userProfile.id]);

            let payAmountText = '';
            if (myRepairs.length > 0) {
              const r = myRepairs[0];
              const due = parseFloat(r.actual_cost) > 0 ? parseFloat(r.actual_cost) : parseFloat(r.estimated_cost || 0);
              payAmountText = `\n🚗 ยอดค่าบริการรถทะเบียน ${r.license_plate} (#${r.id}):\n👉 *฿${due.toLocaleString()} บาท*\n`;
            }

            const payMsg = `💳 [ช่องทางการชำระเงิน & โอนมัดจำ]\n${payAmountText}\n• พร้อมเพย์ (PromptPay): ${ppNumber}\n• ชื่อบัญชี: ${ppName}\n• บัญชีธนาคาร: ${bankName} (${bankAcc})\n\n*เมื่อโอนเงินเรียบร้อยแล้ว สามารถส่งรูปสลิปหลักฐานทางแชทนี้ได้เลยครับ ขอบพระคุณครับ 🙏*`;
            await replyLineMessage(replyToken, payMsg);
          } catch (err) {
            await replyLineMessage(replyToken, 'เกิดข้อผิดพลาดในการดึงข้อมูลบัญชี: ' + err.message);
          }
        }
        else if (lowerText === 'ติดต่อ' || lowerText === '3' || lowerText.includes('แผนที่') || lowerText.includes('เวลาทำการ') || lowerText.includes('เบอร์')) {
          const contactMsg = `📍 [ข้อมูลการติดต่ออู่ BT Auto Garage]\n\n• เวลาทำการ: จันทร์ - เสาร์ (08:30 - 17:30 น.)\n• เบอร์โทรศัพท์: 081-234-5678\n• ที่อยู่: อู่ซ่อมรถยนต์ BT Auto ถ.พัฒนาการ กทม.\n\nยินดีให้บริการเสมอครับ 😊`;
          await replyLineMessage(replyToken, contactMsg);
        }
        else if (lowerText.includes('ประเมินราคา') || lowerText.includes('ตีราคา') || lowerText.includes('ค่าซ่อม')) {
          const quoteMsg = `💰 [บริการประเมินราคาซ่อมเบื้องต้นฟรี!]\n\nลูกค้าสามารถส่งข้อมูลมาทางแชทนี้ได้เลยครับ:\n1. 📸 รูปถ่ายจุดที่เสียหาย/ชำรุด (มุมใกล้และมุมกว้าง)\n2. 🚗 ยี่ห้อ รุ่น ปี และอาการเบื้องต้น\n\nทีมช่างจะรีบประเมินค่าแรงและอะไหล่ส่งกลับให้โดยเร็วครับ หรือนำรถเข้ามาเช็คที่อู่ได้ฟรี ไม่มีค่าใช้จ่ายครับ 😊`;
          await replyLineMessage(replyToken, quoteMsg);
        }
        else if (lowerText.includes('บริการ') || lowerText.includes('ซ่อมอะไร')) {
          const serviceMsg = `🛠️ [บริการมาตรฐานครบวงจร BT Auto Garage]\n\n1. 🔍 ตรวจเช็คเครื่องยนต์ ระบบไฟฟ้า และแอร์\n2. 🎨 เคาะ พ่นสีตัวถัง ซ่อมรอยชน ลบรอยขีดข่วน\n3. ⚙️ ซ่อมช่วงล่าง เบรก คลัตช์ โช้คอัพ\n4. 🛢️ เปลี่ยนถ่ายน้ำมันเครื่อง ไส้กรอง และของเหลวทั้งระบบ\n\nยินดีให้บริการเสมอครับ 😊`;
          await replyLineMessage(replyToken, serviceMsg);
        }
        else if (lowerText.includes('เจ้าของร้าน') || lowerText.includes('แอดมิน') || lowerText.includes('admin')) {
          const adminNotice = `🔒 [โหมดเจ้าของร้าน & แอดมิน]\n\nขออภัยครับ ฟังก์ชันนี้สงวนสิทธิ์สำหรับเจ้าของร้านและผู้ดูแลระบบเท่านั้นครับ\n\nหากท่านต้องการความช่วยเหลือทั่วไป สามารถกดปุ่มอื่นๆ บนเมนูด้านล่างได้เลยครับ 😊`;
          await replyLineMessage(replyToken, adminNotice);
        }
        else {
          const custHelp = `สวัสดีครับคุณ ${userProfile.fullname} 😊\n\nคำสั่งที่บอทสามารถตอบกลับได้ทันที:\n1️⃣ พิมพ์ "สถานะ" - เช็คความคืบหน้ารถปัจจุบัน\n2️⃣ พิมพ์ "ประวัติ" - ดูประวัติการซ่อมทั้งหมด\n3️⃣ พิมพ์ "พร้อมเพย์" / "โอนเงิน" - ขอเลขบัญชีรับเงิน\n4️⃣ พิมพ์ "ติดต่อ" - แผนที่และเบอร์โทรอู่`;
          await replyLineMessage(replyToken, custHelp);
        }
      }

      // ==========================================
      // C. GUEST / UNLINKED USER MODE 📱
      // ==========================================
      else {
        // Match phone number to link customer
        if (/^0\d{8,9}$/.test(cleanPhone)) {
          try {
            const [[customer]] = await db.query('SELECT * FROM customers WHERE REPLACE(REPLACE(phone, "-", ""), " ", "") = ?', [cleanPhone]);
            if (customer) {
              await db.query('UPDATE customers SET line_id = ? WHERE id = ?', [userId, customer.id]);
              const successMsg = `สวัสดีครับคุณ ${customer.fullname}! ✨\n\nระบบได้เชื่อมต่อบัญชี LINE ของท่านเข้ากับอู่ BT Auto เรียบร้อยแล้ว 🎉\n\nหลังจากนี้ท่านสามารถพิมพ์ "สถานะ" เพื่อเช็คความคืบหน้ารถ และจะได้รับแจ้งเตือนอัตโนมัติเมื่อรถซ่อมเสร็จครับ 😊`;
              await replyLineMessage(replyToken, successMsg);
            } else {
              const notFoundMsg = `ขออภัยครับ ไม่พบเบอร์โทรศัพท์ "${rawText}" ในฐานข้อมูลลูกค้าอู่\n\nกรุณาแจ้งเบอร์โทรศัพท์ที่ลงทะเบียนไว้กับอู่ หรือติดต่อเจ้าหน้าที่ครับ`;
              await replyLineMessage(replyToken, notFoundMsg);
            }
          } catch (err) {
            console.error('[LINE Webhook DB Error]', err);
          }
        }
        // General query (Contact / Hours / Location)
        else if (lowerText.includes('ติดต่อ') || lowerText.includes('แผนที่') || lowerText.includes('เวลา') || lowerText.includes('เบอร์')) {
          const contactMsg = `📍 [ข้อมูลการติดต่ออู่ BT Auto Garage]\n\n• เวลาทำการ: จันทร์ - เสาร์ (08:30 - 17:30 น.)\n• เบอร์โทรศัพท์: 081-234-5678\n• ที่อยู่: อู่ซ่อมรถยนต์ BT Auto ถ.พัฒนาการ กทม.\n\nยินดีให้บริการเสมอครับ 😊`;
          await replyLineMessage(replyToken, contactMsg);
        }
        else if (lowerText.includes('พร้อมเพย์') || lowerText.includes('โอนเงิน') || lowerText.includes('บัญชี') || lowerText.includes('จ่าย') || lowerText.includes('qr')) {
          const ppNumber = await getSetting('promptpay_number') || '0812345678';
          const ppName = await getSetting('promptpay_name') || 'BT Auto Garage';
          const bankName = await getSetting('bank_name') || 'ธนาคารกสิกรไทย';
          const bankAcc = await getSetting('bank_account_no') || '-';
          const payMsg = `💳 [ช่องทางการชำระเงิน & โอนมัดจำ]\n\n• พร้อมเพย์ (PromptPay): ${ppNumber}\n• ชื่อบัญชี: ${ppName}\n• บัญชีธนาคาร: ${bankName} (${bankAcc})\n\n*เมื่อโอนเงินเรียบร้อยแล้ว ส่งสลิปแจ้งในแชทนี้ได้เลยครับ ขอบพระคุณครับ 🙏*`;
          await replyLineMessage(replyToken, payMsg);
        }
        else if (lowerText.includes('ประเมินราคา') || lowerText.includes('ตีราคา') || lowerText.includes('ค่าซ่อม')) {
          const quoteMsg = `💰 [บริการประเมินราคาซ่อมเบื้องต้นฟรี!]\n\nลูกค้าสามารถส่งข้อมูลมาทางแชทนี้ได้เลยครับ:\n1. 📸 รูปถ่ายจุดที่เสียหาย/ชำรุด (มุมใกล้และมุมกว้าง)\n2. 🚗 ยี่ห้อ รุ่น ปี และอาการเบื้องต้น\n\nทีมช่างจะรีบประเมินค่าแรงและอะไหล่ส่งกลับให้โดยเร็วครับ หรือนำรถเข้ามาเช็คที่อู่ได้ฟรี ไม่มีค่าใช้จ่ายครับ 😊`;
          await replyLineMessage(replyToken, quoteMsg);
        }
        else if (lowerText.includes('บริการ') || lowerText.includes('ซ่อมอะไร')) {
          const serviceMsg = `🛠️ [บริการมาตรฐานครบวงจร BT Auto Garage]\n\n1. 🔍 ตรวจเช็คเครื่องยนต์ ระบบไฟฟ้า และแอร์\n2. 🎨 เคาะ พ่นสีตัวถัง ซ่อมรอยชน ลบรอยขีดข่วน\n3. ⚙️ ซ่อมช่วงล่าง เบรก คลัตช์ โช้คอัพ\n4. 🛢️ เปลี่ยนถ่ายน้ำมันเครื่อง ไส้กรอง และของเหลวทั้งระบบ\n\nยินดีให้บริการเสมอครับ 😊`;
          await replyLineMessage(replyToken, serviceMsg);
        }
        else if (lowerText.includes('เจ้าของร้าน') || lowerText.includes('แอดมิน') || lowerText.includes('admin')) {
          const adminNotice = `🔒 [โหมดเจ้าของร้าน & แอดมิน]\n\n• บัญชี LINE User ID ของคุณคือ:\n👉 ${userId}\n\n*(หากคุณคือเจ้าของร้าน นำรหัสนี้ไปบันทึกในหน้า "ตั้งค่าระบบ" บนเว็บ เพื่อเปิดใช้งานโหมดสั่งงานแอดมิน)*`;
          await replyLineMessage(replyToken, adminNotice);
        }
        // Match license plate
        else {
          try {
            const [repairs] = await db.query(`
              SELECT r.*, v.license_plate, v.brand, v.model, c.fullname AS customer_name
              FROM repairs r
              JOIN vehicles v ON r.vehicle_id = v.id
              JOIN customers c ON r.customer_id = c.id
              WHERE v.license_plate LIKE ?
              ORDER BY r.id DESC LIMIT 1
            `, [`%${rawText}%`]);

            if (repairs.length > 0) {
              const r = repairs[0];
              const statusMap = {
                'pending': '⏳ รับรถเข้าระบบแล้ว (รอตรวจเช็คสภาพ)',
                'inspecting': '🔍 กำลังตรวจเช็คและจัดทำใบเสนอราคา',
                'repairing': '🔧 กำลังอยู่ระหว่างการซ่อมบำรุง',
                'waiting_parts': '📦 รอชิ้นส่วนอะไหล่จากผู้ผลิต',
                'completed': '✅ ซ่อมเสร็จสมบูรณ์ พร้อมรับมอบรถคืน',
                'delivered': '🚗 ส่งมอบรถคืนเรียบร้อยแล้ว',
                'cancelled': '❌ ยกเลิกงานซ่อม'
              };
              const statusText = statusMap[r.status] || r.status;
              const msg = `🚗 ข้อมูลสถานะรถทะเบียน "${r.license_plate}" (${r.brand} ${r.model})\n\n• เลขที่ใบซ่อม: #${r.id}\n• สถานะปัจจุบัน: ${statusText}\n• รายการ: ${r.description}\n\n💡 *ต้องการผูกบัญชี LINE เพื่อรับแจ้งเตือนอัตโนมัติ?*\n👉 กรุณาพิมพ์ "เบอร์โทรศัพท์ 10 หลัก" ที่ลงทะเบียนไว้ส่งมาได้เลยครับ`;
              await replyLineMessage(replyToken, msg);
            } else {
              const defaultHelp = `ยินดีต้อนรับสู่อู่ BT Auto ครับ 😊\n\n📌 ลูกค้า: พิมพ์ "เบอร์โทรศัพท์ 10 หลัก" (เช่น 0845678901) เพื่อผูกบัญชีรับแจ้งเตือนอัตโนมัติ\n📌 เช็คสถานะ: พิมพ์ "เลขทะเบียนรถ" (เช่น 9999)\n📌 ขอเลขบัญชี: พิมพ์ "พร้อมเพย์" หรือ "โอนเงิน"\n📌 ติดต่อเรา: พิมพ์ "ติดต่อ" หรือ "แผนที่"`;
              await replyLineMessage(replyToken, defaultHelp);
            }
          } catch (err) {
            console.error('[LINE Webhook Search Error]', err);
          }
        }
      }
    }
  }
};

module.exports = {
  getSettings,
  updatePassword,
  updateLineSettings,
  updatePaymentSettings,
  testLineNotification,
  lineWebhook,
  backupDatabase,
  restoreDatabase,
  logAuditAction
};
