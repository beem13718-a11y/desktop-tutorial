const bcrypt = require('bcryptjs');
const db = require('../config/db');
const notificationService = require('../services/notificationService');

// Format date to YYYY-MM-DD
const formatDate = (d) => {
  const date = d ? new Date(d) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Render Attendance Dashboard (ลูกจ้าง/ช่างเท่านั้น)
const getAttendancePage = async (req, res) => {
  const selectedDate = req.query.date ? req.query.date : formatDate();
  const isOwner = req.session.user.role === 'owner';

  try {
    // 1. Fetch only employees/mechanics (ไม่รวมเจ้าของร้าน)
    const [staffList] = await db.query(`
      SELECT id, username, fullname, role, phone, skills, status 
      FROM users 
      WHERE role != 'owner' AND status = 'active'
      ORDER BY fullname ASC
    `);

    // 2. Fetch attendance records for the selected date
    const [attendanceRows] = await db.query(`
      SELECT a.*, u.fullname, u.username, u.role, u.phone
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE a.work_date = ? AND u.role != 'owner'
    `, [selectedDate]);

    // Map attendance by user_id
    const attendanceMap = {};
    attendanceRows.forEach(a => {
      attendanceMap[a.user_id] = a;
    });

    // 3. Combine staff list with their attendance status for today
    const fullStaffStatus = staffList.map(s => {
      const att = attendanceMap[s.id] || null;
      let status = 'not_clocked_in';
      if (att) {
        status = att.status;
      }
      return {
        ...s,
        attendance: att,
        currentStatus: status
      };
    });

    // 4. Calculate summary metrics (นับเฉพาะลูกจ้าง)
    const presentCount = attendanceRows.filter(a => a.status === 'present').length;
    const lateCount = attendanceRows.filter(a => a.status === 'late').length;
    const leaveCount = attendanceRows.filter(a => a.status.startsWith('leave')).length;
    const absentCount = attendanceRows.filter(a => a.status === 'absent').length;
    const notClockedInCount = staffList.length - attendanceRows.length;

    const summary = {
      totalStaff: staffList.length,
      presentCount: presentCount,
      lateCount: lateCount,
      leaveCount: leaveCount,
      absentCount: absentCount,
      notClockedInCount: notClockedInCount
    };

    // 5. Recent Logs
    const [recentLogs] = await db.query(`
      SELECT a.*, u.fullname, u.role 
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE u.role != 'owner'
      ORDER BY a.work_date DESC, a.created_at DESC
      LIMIT 15
    `);

    const todayStr = formatDate();
    const isPastDate = selectedDate < todayStr;

    res.render('attendance/index', {
      title: 'เช็คชื่อเข้างานลูกจ้าง & บันทึกเวลาทำงาน',
      activePage: 'attendance',
      selectedDate: selectedDate,
      todayStr: todayStr,
      isPastDate: isPastDate,
      staffStatusList: fullStaffStatus,
      staffList: staffList,
      summary: summary,
      recentLogs: recentLogs,
      isOwner: isOwner
    });
  } catch (err) {
    console.error('Get Attendance Page Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลระบบเช็คชื่อได้' });
  }
};

// Quick 1-Click Update from Table (Owner Action)
const quickUpdateStatus = async (req, res) => {
  const { user_id, work_date, status, clock_in_time, clock_out_time, notes } = req.body;
  const targetDate = work_date || formatDate();

  if (!user_id || !status) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุพนักงานและสถานะ' });
  }

  try {
    let clockInVal = null;
    let clockOutVal = null;

    // Set default times based on status if not manually provided
    if (status === 'present') {
      clockInVal = clock_in_time ? `${targetDate} ${clock_in_time}` : `${targetDate} 08:30:00`;
      if (clock_out_time) clockOutVal = `${targetDate} ${clock_out_time}`;
    } else if (status === 'late') {
      clockInVal = clock_in_time ? `${targetDate} ${clock_in_time}` : `${targetDate} 09:00:00`;
      if (clock_out_time) clockOutVal = `${targetDate} ${clock_out_time}`;
    } else if (status.startsWith('leave') || status === 'absent') {
      clockInVal = null;
      clockOutVal = null;
    }

    const sql = `
      INSERT INTO attendances (user_id, work_date, clock_in, clock_out, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        clock_in = VALUES(clock_in),
        clock_out = VALUES(clock_out),
        status = VALUES(status),
        notes = VALUES(notes)
    `;

    await db.query(sql, [user_id, targetDate, clockInVal, clockOutVal, status, notes || null]);

    const [[staff]] = await db.query('SELECT fullname FROM users WHERE id = ?', [user_id]);

    const statusNames = {
      'present': '✅ มาทำงาน (ตรงเวลา)',
      'late': '⚠️ มาสาย',
      'leave_business': '🏖️ ลากิจ',
      'leave_sick': '🏥 ลาป่วย',
      'leave_vacation': '🌴 ลาพักร้อน',
      'absent': '❌ ขาดงาน'
    };

    res.json({ 
      success: true, 
      message: `บันทึกสถานะของ "${staff.fullname}" เป็น ${statusNames[status] || status} สำเร็จ!` 
    });
  } catch (err) {
    console.error('Quick Update Attendance Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
};

// Clock-in Action (สำหรับลูกจ้างกดเอง หรือเจ้าของลงให้)
const clockIn = async (req, res) => {
  const userId = req.body.user_id || req.session.user.id;
  const today = formatDate();
  const selectedTime = req.body.custom_time; // HH:MM or undefined
  const now = new Date();

  let timeStr = selectedTime ? `${selectedTime}:00` : now.toTimeString().split(' ')[0];
  const nowFull = `${today} ${timeStr}`;

  // If time is after 08:30 -> late
  const checkHour = selectedTime ? parseInt(selectedTime.split(':')[0]) : now.getHours();
  const checkMin = selectedTime ? parseInt(selectedTime.split(':')[1]) : now.getMinutes();
  const isLate = (checkHour > 8 || (checkHour === 8 && checkMin > 30));
  const status = req.body.status || (isLate ? 'late' : 'present');

  try {
    const [[existing]] = await db.query('SELECT * FROM attendances WHERE user_id = ? AND work_date = ?', [userId, today]);
    
    if (existing) {
      await db.query(`
        UPDATE attendances 
        SET clock_in = ?, status = ?, notes = ?
        WHERE id = ?
      `, [nowFull, status, req.body.notes || existing.notes, existing.id]);
    } else {
      await db.query(`
        INSERT INTO attendances (user_id, work_date, clock_in, status, notes)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, today, nowFull, status, req.body.notes || null]);
    }

    const [[staff]] = await db.query('SELECT fullname, role FROM users WHERE id = ?', [userId]);

    // Send LINE Notification to Owner
    const lateText = status === 'late' ? '⚠️ (มาสาย)' : '✅ (ตรงเวลา)';
    const lineMsg = {
      type: 'text',
      text: `🕒 [เช็คชื่อเข้างาน - BT Auto]\n• ลูกจ้าง: คุณ ${staff.fullname}\n• เวลาเข้างาน: ${timeStr.slice(0, 5)} น.\n• สถานะ: ${lateText}\n• วันที่: ${today}`
    };
    notificationService.sendToAdmin([lineMsg]).catch(() => {});

    res.json({ 
      success: true, 
      message: `บันทึกเวลาเข้างานของ ${staff.fullname} (${timeStr.slice(0, 5)} น.) สำเร็จ!`,
      clockInTime: nowFull,
      status: status
    });
  } catch (err) {
    console.error('Clock-In Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงเวลาเข้างาน: ' + err.message });
  }
};

// Clock-out Action
const clockOut = async (req, res) => {
  const userId = req.body.user_id || req.session.user.id;
  const today = formatDate();
  const selectedTime = req.body.custom_time;
  const now = new Date();
  const timeStr = selectedTime ? `${selectedTime}:00` : now.toTimeString().split(' ')[0];
  const nowFull = `${today} ${timeStr}`;

  try {
    const [[existing]] = await db.query('SELECT * FROM attendances WHERE user_id = ? AND work_date = ?', [userId, today]);
    if (!existing || !existing.clock_in) {
      return res.status(400).json({ success: false, message: 'ยังไม่พบเวลาเข้างานของวันนี้' });
    }

    await db.query('UPDATE attendances SET clock_out = ? WHERE id = ?', [nowFull, existing.id]);

    const [[staff]] = await db.query('SELECT fullname FROM users WHERE id = ?', [userId]);

    // Send LINE notification to Owner
    const lineMsg = {
      type: 'text',
      text: `🏁 [ลงเวลาออกงาน - BT Auto]\n• ลูกจ้าง: คุณ ${staff.fullname}\n• เวลาออกงาน: ${timeStr.slice(0, 5)} น.\n• วันที่: ${today}`
    };
    notificationService.sendToAdmin([lineMsg]).catch(() => {});

    res.json({ 
      success: true, 
      message: `บันทึกเวลาออกงานของ ${staff.fullname} (${timeStr.slice(0, 5)} น.) สำเร็จ!`
    });
  } catch (err) {
    console.error('Clock-Out Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงเวลาออกงาน: ' + err.message });
  }
};

// Manual Attendance Record / Leave Management (Admin)
const manualAttendanceRecord = async (req, res) => {
  const { user_id, work_date, clock_in_time, clock_out_time, status, notes } = req.body;

  if (!user_id || !work_date || !status) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    let clockInVal = null;
    let clockOutVal = null;

    if (status === 'present' || status === 'late') {
      if (clock_in_time) clockInVal = `${work_date} ${clock_in_time}:00`;
      if (clock_out_time) clockOutVal = `${work_date} ${clock_out_time}:00`;
    }

    const sql = `
      INSERT INTO attendances (user_id, work_date, clock_in, clock_out, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        clock_in = VALUES(clock_in),
        clock_out = VALUES(clock_out),
        status = VALUES(status),
        notes = VALUES(notes)
    `;

    await db.query(sql, [user_id, work_date, clockInVal, clockOutVal, status, notes || null]);

    res.json({ success: true, message: 'บันทึกข้อมูลการเช็คชื่อ/การลาเรียบร้อยแล้ว!' });
  } catch (err) {
    console.error('Manual Attendance Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
};

// Verify Owner Password for unlocking past date edits
const verifyUnlock = async (req, res) => {
  const { password } = req.body;
  const userId = req.session.user.id;

  if (!password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสผ่านเพื่อปลดล็อก' });
  }

  try {
    const [[user]] = await db.query('SELECT password, role FROM users WHERE id = ?', [userId]);
    if (!user || user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'เฉพาะเจ้าของร้านเท่านั้นที่มีสิทธิ์ปลดล็อก' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'รหัสผ่านเจ้าของร้านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
    }

    res.json({ success: true, message: 'ยืนยันรหัสผ่านถูกต้อง ปลดล็อกการแก้ไขย้อนหลังสำเร็จ!' });
  } catch (err) {
    console.error('Verify Unlock Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบรหัสผ่าน' });
  }
};

module.exports = {
  getAttendancePage,
  clockIn,
  clockOut,
  quickUpdateStatus,
  manualAttendanceRecord,
  verifyUnlock
};
