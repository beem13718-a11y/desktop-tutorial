const db = require('../config/db');

// Get all vehicles with search, pagination and customers list for select dropdown
const getAllVehicles = async (req, res) => {
  const search = req.query.search || '';
  const brand = req.query.brand || '';
  const model = req.query.model || '';
  const year = req.query.year || '';
  const color = req.query.color || '';
  const customerId = req.query.customer_id || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    // 1. Get all customers to fill in the select dropdown and filter
    const [customers] = await db.query('SELECT id, fullname, phone FROM customers ORDER BY fullname ASC');

    // 2. Get unique filter options from vehicles table (Cascading Filters)
    const [brands] = await db.query('SELECT DISTINCT brand FROM vehicles WHERE brand IS NOT NULL AND brand != "" ORDER BY brand ASC');

    let modelsSql = 'SELECT DISTINCT model FROM vehicles WHERE model IS NOT NULL AND model != ""';
    const modelsParams = [];
    if (brand) {
      modelsSql += ' AND brand = ?';
      modelsParams.push(brand);
    }
    modelsSql += ' ORDER BY model ASC';
    const [models] = await db.query(modelsSql, modelsParams);

    let yearsSql = 'SELECT DISTINCT year FROM vehicles WHERE year IS NOT NULL';
    const yearsParams = [];
    if (brand) {
      yearsSql += ' AND brand = ?';
      yearsParams.push(brand);
    }
    if (model) {
      yearsSql += ' AND model = ?';
      yearsParams.push(model);
    }
    yearsSql += ' ORDER BY year DESC';
    const [years] = await db.query(yearsSql, yearsParams);

    // 3. Count total records for pagination
    let countSql = `
      SELECT COUNT(*) AS count 
      FROM vehicles v
      JOIN customers c ON v.customer_id = c.id
      WHERE (v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR c.fullname LIKE ?)
    `;
    const searchParam = `%${search}%`;
    const paramsCount = [searchParam, searchParam, searchParam, searchParam];

    if (brand) {
      countSql += ' AND v.brand = ?';
      paramsCount.push(brand);
    }
    if (model) {
      countSql += ' AND v.model = ?';
      paramsCount.push(model);
    }
    if (year) {
      countSql += ' AND v.year = ?';
      paramsCount.push(parseInt(year));
    }
    if (color) {
      countSql += ' AND v.color = ?';
      paramsCount.push(color);
    }
    if (customerId) {
      countSql += ' AND v.customer_id = ?';
      paramsCount.push(parseInt(customerId));
    }

    const [[{ count }]] = await db.query(countSql, paramsCount);
    const totalPages = Math.ceil(count / limit);

    // 4. Select vehicles joining customer information
    let sql = `
      SELECT v.*, c.fullname AS customer_name, c.phone AS customer_phone 
      FROM vehicles v
      JOIN customers c ON v.customer_id = c.id
      WHERE (v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR c.fullname LIKE ?)
    `;
    const paramsSelect = [searchParam, searchParam, searchParam, searchParam];

    if (brand) {
      sql += ' AND v.brand = ?';
      paramsSelect.push(brand);
    }
    if (model) {
      sql += ' AND v.model = ?';
      paramsSelect.push(model);
    }
    if (year) {
      sql += ' AND v.year = ?';
      paramsSelect.push(parseInt(year));
    }
    if (color) {
      sql += ' AND v.color = ?';
      paramsSelect.push(color);
    }
    if (customerId) {
      sql += ' AND v.customer_id = ?';
      paramsSelect.push(parseInt(customerId));
    }

    sql += ' ORDER BY v.id DESC LIMIT ? OFFSET ?';
    paramsSelect.push(limit, offset);

    const [rows] = await db.query(sql, paramsSelect);

    res.render('vehicles/index', {
      title: 'ข้อมูลรถยนต์',
      activePage: 'vehicles',
      vehicles: rows,
      customers: customers,
      brands: brands,
      models: models,
      years: years,
      colors: [],
      search: search,
      selectedBrand: brand,
      selectedModel: model,
      selectedYear: year,
      selectedColor: color,
      selectedCustomerId: customerId,
      currentPage: page,
      totalPages: totalPages,
      totalCount: count
    });
  } catch (err) {
    console.error('Get Vehicles Error:', err);
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ไม่สามารถดึงข้อมูลทะเบียนรถยนต์ได้'
    });
  }
};

// Add new vehicle
const addVehicle = async (req, res) => {
  const { customer_id, license_plate, brand, model, year, color, vin } = req.body;

  if (!customer_id || !license_plate || !brand || !model) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลรถยนต์และเลือกเจ้าของรถยนต์' });
  }

  try {
    // Check if plate already exists
    const [existing] = await db.query('SELECT id FROM vehicles WHERE license_plate = ?', [license_plate]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'เลขทะเบียนรถยนต์นี้ถูกลงทะเบียนไว้ในระบบแล้ว' });
    }

    const sql = `
      INSERT INTO vehicles (customer_id, license_plate, brand, model, year, color, vin) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await db.query(sql, [
      customer_id, 
      license_plate, 
      brand, 
      model, 
      year || null, 
      color || null, 
      vin || null
    ]);

    res.json({ success: true, message: 'ลงทะเบียนรถยนต์เรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Add Vehicle Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบในการบันทึกข้อมูลรถยนต์' });
  }
};

// Update vehicle details
const editVehicle = async (req, res) => {
  const { id } = req.params;
  const { customer_id, license_plate, brand, model, year, color, vin } = req.body;

  if (!customer_id || !license_plate || !brand || !model) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
  }

  try {
    // Check duplicate plate excluding current
    const [existing] = await db.query('SELECT id FROM vehicles WHERE license_plate = ? AND id != ?', [license_plate, id]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'เลขทะเบียนรถยนต์นี้ชนกับรถคันอื่นในระบบ' });
    }

    const sql = `
      UPDATE vehicles 
      SET customer_id = ?, license_plate = ?, brand = ?, model = ?, year = ?, color = ?, vin = ? 
      WHERE id = ?
    `;
    const [result] = await db.query(sql, [
      customer_id, 
      license_plate, 
      brand, 
      model, 
      year || null, 
      color || null, 
      vin || null, 
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบข้อมูลรถยนต์ที่ต้องการแก้ไข' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลรถยนต์เรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Edit Vehicle Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูลรถยนต์' });
  }
};

// Delete vehicle
const deleteVehicle = async (req, res) => {
  const { id } = req.params;

  try {
    const sql = 'DELETE FROM vehicles WHERE id = ?';
    const [result] = await db.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบข้อมูลรถยนต์ที่ต้องการลบ' });
    }

    res.json({ success: true, message: 'ลบข้อมูลรถยนต์เรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Delete Vehicle Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถลบข้อมูลรถยนต์ได้ เนื่องจากมีประวัติงานซ่อมผูกอยู่' });
  }
};

// View vehicle repair history
const getRepairHistory = async (req, res) => {
  const { id } = req.params;

  try {
    const [vehicleRows] = await db.query(`
      SELECT v.*, c.fullname AS customer_name, c.phone AS customer_phone 
      FROM vehicles v
      JOIN customers c ON v.customer_id = c.id
      WHERE v.id = ?
    `, [id]);

    if (vehicleRows.length === 0) {
      return res.status(444).render('error', { title: 'ไม่พบรถยนต์', message: 'ไม่พบประวัติรถยนต์คันนี้ในระบบ' });
    }

    const [repairRows] = await db.query(`
      SELECT r.*, u.fullname AS mechanic_name 
      FROM repairs r
      LEFT JOIN users u ON r.mechanic_id = u.id
      WHERE r.vehicle_id = ?
      ORDER BY r.created_at DESC
    `, [id]);

    res.render('vehicles/history', {
      title: 'ประวัติการซ่อมบำรุง',
      activePage: 'vehicles',
      vehicle: vehicleRows[0],
      repairs: repairRows
    });
  } catch (err) {
    console.error('Get Vehicle History Error:', err);
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ไม่สามารถดึงข้อมูลประวัติการซ่อมบำรุงได้'
    });
  }
};

module.exports = {
  getAllVehicles,
  addVehicle,
  editVehicle,
  deleteVehicle,
  getRepairHistory
};
