const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Get all mechanics + Attendance & Payroll Summary
const getAllMechanics = async (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  const selectedMonth = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM

  try {
    let sql = `
      SELECT u.*,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_days,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) AS late_days,
        COUNT(CASE WHEN a.status LIKE 'leave%' THEN 1 END) AS leave_days,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_days,
        COUNT(CASE WHEN a.status IN ('present', 'late') THEN 1 END) AS work_days
      FROM users u
      LEFT JOIN attendances a ON u.id = a.user_id AND DATE_FORMAT(a.work_date, '%Y-%m') = ?
      WHERE u.role = 'mechanic'
    `;
    const params = [selectedMonth];

    if (search) {
      sql += ' AND (u.fullname LIKE ? OR u.phone LIKE ? OR u.username LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    if (status) {
      sql += ' AND u.status = ?';
      params.push(status);
    }

    sql += ' GROUP BY u.id ORDER BY u.id DESC';

    const [rows] = await db.query(sql, params);

    // Calculate wages for each mechanic
    const mechanicsWithWages = rows.map(m => {
      let estimatedWage = 0;
      const rate = parseFloat(m.salary_rate || 0);
      const workedDays = parseInt(m.work_days || 0);
      const absentDays = parseInt(m.absent_days || 0);

      if (m.salary_type === 'daily') {
        estimatedWage = workedDays * rate;
      } else {
        // Monthly: Rate minus absent deductions
        const dailyDeduct = rate / 30;
        estimatedWage = Math.max(0, rate - (absentDays * dailyDeduct));
      }

      return {
        ...m,
        estimatedWage: Math.round(estimatedWage)
      };
    });

    res.render('mechanics/index', {
      title: 'ข้อมูลช่างซ่อม & สรุปวันทำงานและค่าจ้าง',
      activePage: 'mechanics',
      mechanics: mechanicsWithWages,
      selectedMonth: selectedMonth,
      search: search,
      status: status
    });
  } catch (err) {
    console.error('Get Mechanics Error:', err);
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ไม่สามารถดึงข้อมูลช่างซ่อมได้'
    });
  }
};

// Add new mechanic (technician) user with Salary Config
const addMechanic = async (req, res) => {
  const { username, password, fullname, phone, skills, salary_type, salary_rate, overtime_rate } = req.body;

  if (!username || !password || !fullname) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
  }

  try {
    // Check duplication
    const [existing] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งาน (Username) นี้มีในระบบแล้ว' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `
      INSERT INTO users (username, password, fullname, role, phone, skills, status, salary_type, salary_rate, overtime_rate) 
      VALUES (?, ?, ?, 'mechanic', ?, ?, 'active', ?, ?, ?)
    `;
    await db.query(sql, [
      username, 
      hashedPassword, 
      fullname, 
      phone || null, 
      skills || null, 
      salary_type || 'daily', 
      parseFloat(salary_rate || (salary_type === 'monthly' ? 15000 : 500)),
      parseFloat(overtime_rate || 60)
    ]);

    res.json({ success: true, message: 'ลงทะเบียนช่างซ่อมใหม่พร้อมตั้งค่าอัตราค่าจ้างสำเร็จ' });
  } catch (err) {
    console.error('Add Mechanic Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงทะเบียนช่าง' });
  }
};

// Edit mechanic info + Salary Config
const editMechanic = async (req, res) => {
  const { id } = req.params;
  const { fullname, phone, skills, status, salary_type, salary_rate, overtime_rate } = req.body;

  if (!fullname || !status) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและเลือกสถานะช่างซ่อม' });
  }

  try {
    const sql = `
      UPDATE users 
      SET fullname = ?, phone = ?, skills = ?, status = ?, salary_type = ?, salary_rate = ?, overtime_rate = ? 
      WHERE id = ? AND role = 'mechanic'
    `;
    const [result] = await db.query(sql, [
      fullname, 
      phone || null, 
      skills || null, 
      status, 
      salary_type || 'daily',
      parseFloat(salary_rate || 500),
      parseFloat(overtime_rate || 60),
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลช่างซ่อมที่ต้องการแก้ไข' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลและอัตราค่าจ้างช่างซ่อมสำเร็จ' });
  } catch (err) {
    console.error('Edit Mechanic Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูลช่างซ่อม' });
  }
};

// Pay Salary / Record to Finances
const paySalary = async (req, res) => {
  const { mechanic_id, month, amount, note } = req.body;
  const currentUserId = req.session.user.id;

  if (!mechanic_id || !amount) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุข้อมูลการจ่ายเงินให้ครบถ้วน' });
  }

  try {
    const [[mechanic]] = await db.query('SELECT fullname FROM users WHERE id = ?', [mechanic_id]);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลช่างซ่อม' });
    }

    const payMonth = month || new Date().toISOString().slice(0, 7);
    const title = `จ่ายค่าจ้าง/เงินเดือน: คุณ ${mechanic.fullname} (งวด ${payMonth})`;

    // Insert expense record into finances table
    const sql = `
      INSERT INTO finances (type, amount, payment_method, status, description, transaction_date)
      VALUES ('expense', ?, 'transfer', 'paid', ?, CURRENT_DATE())
    `;
    await db.query(sql, [parseFloat(amount), note || title]);

    res.json({ 
      success: true, 
      message: `บันทึกการจ่ายเงินค่าจ้างจำนวน ${(parseFloat(amount)).toLocaleString()} บาท ลงในระบบบัญชีค่าใช้จ่ายสำเร็จ!` 
    });
  } catch (err) {
    console.error('Pay Salary Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกการจ่ายเงิน: ' + err.message });
  }
};

// Delete or de-activate mechanic
const deleteMechanic = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query("UPDATE users SET status = 'inactive' WHERE id = ? AND role = 'mechanic'", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลช่างซ่อม' });
    }
    res.json({ success: true, message: 'ระงับสถานะช่างซ่อมสำเร็จ' });
  } catch (err) {
    console.error('Delete Mechanic Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการระงับสถานะช่างซ่อม' });
  }
};

module.exports = {
  getAllMechanics,
  addMechanic,
  editMechanic,
  deleteMechanic,
  paySalary
};
