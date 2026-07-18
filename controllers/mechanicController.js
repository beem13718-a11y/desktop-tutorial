const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Get all mechanics
const getAllMechanics = async (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';

  try {
    let sql = "SELECT * FROM users WHERE role = 'mechanic'";
    const params = [];

    if (search) {
      sql += ' AND (fullname LIKE ? OR phone LIKE ? OR username LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY id DESC';

    const [rows] = await db.query(sql, params);

    res.render('mechanics/index', {
      title: 'ข้อมูลช่างซ่อม',
      activePage: 'settings', // Highlight Settings sidebar menu
      mechanics: rows,
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

// Add new mechanic (technician) user
const addMechanic = async (req, res) => {
  const { username, password, fullname, phone, skills } = req.body;

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
      INSERT INTO users (username, password, fullname, role, phone, skills, status) 
      VALUES (?, ?, ?, 'mechanic', ?, ?, 'active')
    `;
    await db.query(sql, [username, hashedPassword, fullname, phone || null, skills || null]);

    res.json({ success: true, message: 'ลงทะเบียนช่างซ่อมใหม่สำเร็จ' });
  } catch (err) {
    console.error('Add Mechanic Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบในการลงทะเบียนช่าง' });
  }
};

// Edit mechanic info
const editMechanic = async (req, res) => {
  const { id } = req.params;
  const { fullname, phone, skills, status } = req.body;

  if (!fullname || !status) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและเลือกสถานะช่างซ่อม' });
  }

  try {
    const sql = `
      UPDATE users 
      SET fullname = ?, phone = ?, skills = ?, status = ? 
      WHERE id = ? AND role = 'mechanic'
    `;
    const [result] = await db.query(sql, [fullname, phone || null, skills || null, status, id]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบข้อมูลช่างซ่อมที่ต้องการแก้ไข' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลช่างซ่อมสำเร็จ' });
  } catch (err) {
    console.error('Edit Mechanic Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูลช่างซ่อม' });
  }
};

// Delete mechanic
const deleteMechanic = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if mechanic is assigned to any pending/active repair
    const [activeJobs] = await db.query(`
      SELECT id FROM repairs 
      WHERE mechanic_id = ? AND status IN ('pending', 'inspecting', 'repairing')
    `, [id]);

    if (activeJobs.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'ไม่สามารถลบช่างซ่อมได้ เนื่องจากช่างกำลังปฏิบัติหน้าที่ในใบสั่งซ่อมที่ยังไม่เสร็จสิ้น' 
      });
    }

    const sql = "DELETE FROM users WHERE id = ? AND role = 'mechanic'";
    const [result] = await db.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบข้อมูลช่างซ่อม' });
    }

    res.json({ success: true, message: 'ลบข้อมูลช่างซ่อมสำเร็จ' });
  } catch (err) {
    console.error('Delete Mechanic Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลบข้อมูลช่างซ่อม' });
  }
};

module.exports = {
  getAllMechanics,
  addMechanic,
  editMechanic,
  deleteMechanic
};
