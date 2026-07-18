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
  const { line_notify_token, line_channel_token, line_channel_secret } = req.body;
  
  try {
    await db.query("UPDATE settings SET value = ? WHERE `key` = 'line_notify_token'", [line_notify_token || '']);
    await db.query("UPDATE settings SET value = ? WHERE `key` = 'line_channel_token'", [line_channel_token || '']);
    await db.query("UPDATE settings SET value = ? WHERE `key` = 'line_channel_secret'", [line_channel_secret || '']);
    
    await logAuditAction(req.session.user.id, 'update_line_settings', 'อัปเดตการตั้งค่าเชื่อมต่อระบบ LINE Notify และ LINE OA');
    
    res.json({ success: true, message: 'บันทึกการตั้งค่าระบบ LINE เรียบร้อยแล้ว!' });
  } catch (err) {
    console.error('Update LINE Settings Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่า LINE' });
  }
};

// LINE Reply Message Helper
const replyLineMessage = async (replyToken, messageText) => {
  try {
    const [[tokenSetting]] = await db.query("SELECT value FROM settings WHERE `key` = 'line_channel_token'");
    const channelToken = tokenSetting ? tokenSetting.value : null;

    if (!channelToken || channelToken.trim() === '') return;

    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: messageText }]
      })
    });
  } catch (err) {
    console.error('[LINE Webhook Reply Error]', err.message);
  }
};

// Public LINE OA Webhook Endpoint
const lineWebhook = async (req, res) => {
  res.sendStatus(200);

  const events = req.body.events;
  if (!events || !Array.isArray(events)) return;

  for (const event of events) {
    const replyToken = event.replyToken;
    const userId = event.source ? event.source.userId : null;

    if (!replyToken || !userId) continue;

    // 1. Follow Event (User adds LINE OA as friend)
    if (event.type === 'follow') {
      const welcomeMsg = `ยินดีต้อนรับสู่อู่ BT Auto ครับ! 🎉\n\nกรุณาพิมพ์ "เบอร์โทรศัพท์" ของท่าน (เช่น 0812345678) เพื่อทำการเชื่อมต่อแชทนี้เข้ากับประวัติใบสั่งซ่อมเพื่อรับการแจ้งเตือนสถานะอัตโนมัติครับ 😊`;
      await replyLineMessage(replyToken, welcomeMsg);
    }

    // 2. Text Message Event
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      const text = event.message.text.trim();
      const cleanPhone = text.replace(/[-\s]/g, '');

      // Check if input format matches phone number
      if (/^0\d{8,9}$/.test(cleanPhone)) {
        try {
          const [[customer]] = await db.query('SELECT * FROM customers WHERE REPLACE(REPLACE(phone, "-", ""), " ", "") = ?', [cleanPhone]);
          
          if (customer) {
            await db.query('UPDATE customers SET line_id = ? WHERE id = ?', [userId, customer.id]);
            const successMsg = `สวัสดีครับคุณ ${customer.fullname}!\n\nระบบได้ทำการเชื่อมต่อบัญชี LINE ของท่านกับอู่ BT Auto สำเร็จแล้วครับ 🎉\n\nท่านจะได้รับข้อความแจ้งเตือนสถานะงานซ่อมบำรุงผ่านห้องแชทนี้โดยตรงครับ ขอบพระคุณครับ 😊`;
            await replyLineMessage(replyToken, successMsg);
          } else {
            const notFoundMsg = `ขออภัยครับ ไม่พบเบอร์โทรศัพท์ "${text}" ในระบบประวัติลูกค้าอู่\n\nกรุณากรอกเบอร์โทรศัพท์ที่ลงทะเบียนไว้กับทางอู่ หรือติดต่อเจ้าหน้าที่อู่เพื่อตรวจสอบประวัติครับ`;
            await replyLineMessage(replyToken, notFoundMsg);
          }
        } catch (err) {
          console.error('[LINE Webhook DB Error]', err);
        }
      } else {
        const fallbackMsg = `ขออภัยครับ ระบบอัตโนมัติของร้านรองรับการพิมพ์ส่ง "เบอร์โทรศัพท์" (เช่น 0812345678) เพื่อเชื่อมโยงบัญชีเท่านั้นครับ\n\nหากท่านมีคำถามเพิ่มเติม โปรดระบุหัวข้อหรือรอเจ้าหน้าที่มาตอบกลับครับ`;
        await replyLineMessage(replyToken, fallbackMsg);
      }
    }
  }
};

module.exports = {
  getSettings,
  updatePassword,
  updateLineSettings,
  lineWebhook,
  backupDatabase,
  restoreDatabase,
  logAuditAction
};
