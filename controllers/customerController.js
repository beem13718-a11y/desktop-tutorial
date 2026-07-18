const db = require('../config/db');

// Get all customers with search and pagination
const getAllCustomers = async (req, res) => {
  const search = req.query.search || '';
  const period = req.query.period || '';
  const date_from = req.query.date_from || '';
  const date_to = req.query.date_to || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  // Resolve period dates
  let dateFrom = '';
  let dateTo = '';
  const todayStr = new Date().toISOString().slice(0, 10);

  if (period === 'today') {
    dateFrom = todayStr;
    dateTo = todayStr;
  } else if (period === 'this_week') {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    dateFrom = new Date(d.setDate(diff)).toISOString().slice(0, 10);
    dateTo = todayStr;
  } else if (period === 'this_month') {
    const d = new Date();
    dateFrom = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    dateTo = todayStr;
  } else if (period === 'last_month') {
    const d = new Date();
    const prevMonthFirst = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const prevMonthLast = new Date(d.getFullYear(), d.getMonth(), 0);
    dateFrom = prevMonthFirst.toISOString().slice(0, 10);
    dateTo = prevMonthLast.toISOString().slice(0, 10);
  } else if (period === 'this_year') {
    const d = new Date();
    dateFrom = new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
    dateTo = todayStr;
  } else if (period === 'custom') {
    dateFrom = date_from;
    dateTo = date_to;
  }

  try {
    // 1. Get total records count for pagination
    let countSql = `
      SELECT COUNT(*) AS count FROM customers 
      WHERE (fullname LIKE ? OR phone LIKE ? OR email LIKE ?)
    `;
    const searchParam = `%${search}%`;
    const paramsCount = [searchParam, searchParam, searchParam];

    if (dateFrom && dateTo) {
      countSql += ' AND created_at >= ? AND created_at <= ?';
      paramsCount.push(dateFrom + ' 00:00:00', dateTo + ' 23:59:59');
    } else if (dateFrom) {
      countSql += ' AND created_at >= ?';
      paramsCount.push(dateFrom + ' 00:00:00');
    } else if (dateTo) {
      countSql += ' AND created_at <= ?';
      paramsCount.push(dateTo + ' 23:59:59');
    }

    const [[{ count }]] = await db.query(countSql, paramsCount);
    const totalPages = Math.ceil(count / limit);

    // 2. Get customer rows
    let sql = `
      SELECT * FROM customers 
      WHERE (fullname LIKE ? OR phone LIKE ? OR email LIKE ?)
    `;
    const paramsSelect = [searchParam, searchParam, searchParam];

    if (dateFrom && dateTo) {
      sql += ' AND created_at >= ? AND created_at <= ?';
      paramsSelect.push(dateFrom + ' 00:00:00', dateTo + ' 23:59:59');
    } else if (dateFrom) {
      sql += ' AND created_at >= ?';
      paramsSelect.push(dateFrom + ' 00:00:00');
    } else if (dateTo) {
      sql += ' AND created_at <= ?';
      paramsSelect.push(dateTo + ' 23:59:59');
    }

    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    paramsSelect.push(limit, offset);

    const [rows] = await db.query(sql, paramsSelect);

    res.render('customers/index', {
      title: 'ข้อมูลลูกค้า',
      activePage: 'customers',
      customers: rows,
      search: search,
      selectedPeriod: period,
      dateFrom: date_from,
      dateTo: date_to,
      currentPage: page,
      totalPages: totalPages,
      totalCount: count
    });
  } catch (err) {
    console.error('Get Customers Error:', err);
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ไม่สามารถดึงข้อมูลรายชื่อลูกค้าได้'
    });
  }
};

// Add new customer
const addCustomer = async (req, res) => {
  const { fullname, phone, email, address, line_id } = req.body;

  if (!fullname || !phone) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและเบอร์โทรศัพท์' });
  }

  try {
    const sql = 'INSERT INTO customers (fullname, phone, email, address, line_id) VALUES (?, ?, ?, ?, ?)';
    await db.query(sql, [fullname, phone, email || null, address || null, line_id || null]);
    res.json({ success: true, message: 'เพิ่มข้อมูลลูกค้าเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Add Customer Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบในการเพิ่มข้อมูล' });
  }
};

// Update customer details
const editCustomer = async (req, res) => {
  const { id } = req.params;
  const { fullname, phone, email, address, line_id } = req.body;

  if (!fullname || !phone) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและเบอร์โทรศัพท์' });
  }

  try {
    const sql = 'UPDATE customers SET fullname = ?, phone = ?, email = ?, address = ?, line_id = ? WHERE id = ?';
    const [result] = await db.query(sql, [fullname, phone, email || null, address || null, line_id || null, id]);
    
    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบข้อมูลลูกค้าที่ต้องการแก้ไข' });
    }
    
    res.json({ success: true, message: 'แก้ไขข้อมูลลูกค้าเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Edit Customer Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลลูกค้า' });
  }
};

// Delete customer
const deleteCustomer = async (req, res) => {
  const { id } = req.params;

  try {
    const sql = 'DELETE FROM customers WHERE id = ?';
    const [result] = await db.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบข้อมูลลูกค้าที่ต้องการลบ' });
    }

    res.json({ success: true, message: 'ลบข้อมูลลูกค้าเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Delete Customer Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถลบข้อมูลลูกค้าได้ เนื่องจากมีข้อมูลรถยนต์ผูกมัดอยู่' });
  }
};

module.exports = {
  getAllCustomers,
  addCustomer,
  editCustomer,
  deleteCustomer
};
