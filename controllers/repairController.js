const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const notificationService = require('../services/notificationService');

// Fetch all repairs with filtering, searching, and pagination
const getAllRepairs = async (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  // Parse multiple selected statuses
  let selectedStatuses = [];
  if (req.query.status) {
    if (Array.isArray(req.query.status)) {
      selectedStatuses = req.query.status;
    } else if (typeof req.query.status === 'string') {
      selectedStatuses = req.query.status.split(',').filter(Boolean);
    }
  }

  try {
    let countSql = `
      SELECT COUNT(*) AS count 
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      JOIN vehicles v ON r.vehicle_id = v.id
      WHERE (v.license_plate LIKE ? OR c.fullname LIKE ? OR r.description LIKE ?)
    `;
    const paramsCount = [`%${search}%`, `%${search}%`, `%${search}%`];

    if (selectedStatuses.length > 0) {
      countSql += ` AND r.status IN (${selectedStatuses.map(() => '?').join(',')})`;
      paramsCount.push(...selectedStatuses);
    }

    const [[{ count }]] = await db.query(countSql, paramsCount);
    const totalPages = Math.ceil(count / limit);

    let sql = `
      SELECT r.*, c.fullname AS customer_name, c.phone AS customer_phone, 
             v.license_plate, v.brand, v.model, u.fullname AS mechanic_name
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN users u ON r.mechanic_id = u.id
      WHERE (v.license_plate LIKE ? OR c.fullname LIKE ? OR r.description LIKE ?)
    `;
    const paramsSelect = [`%${search}%`, `%${search}%`, `%${search}%`];

    if (selectedStatuses.length > 0) {
      sql += ` AND r.status IN (${selectedStatuses.map(() => '?').join(',')})`;
      paramsSelect.push(...selectedStatuses);
    }

    sql += ' ORDER BY r.id DESC LIMIT ? OFFSET ?';
    paramsSelect.push(limit, offset);

    const [rows] = await db.query(sql, paramsSelect);

    // Get all vehicles and customers for the "Receive car" form dropdowns
    const [vehicles] = await db.query(`
      SELECT v.id, v.license_plate, v.brand, v.model, c.fullname AS owner_name 
      FROM vehicles v
      JOIN customers c ON v.customer_id = c.id
      ORDER BY v.license_plate ASC
    `);

    res.render('repairs/index', {
      title: 'รายการซ่อม',
      activePage: 'repairs',
      repairs: rows,
      vehicles: vehicles,
      search: search,
      selectedStatuses: selectedStatuses,
      currentPage: page,
      totalPages: totalPages,
      totalCount: count
    });
  } catch (err) {
    console.error('Get Repairs Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลรายการซ่อมได้' });
  }
};

// Fetch specific repair details
const getRepairDetail = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Get repair main info
    const [repairRows] = await db.query(`
      SELECT r.*, c.fullname AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.email AS customer_email,
             v.license_plate, v.brand, v.model, v.year, v.color, v.vin, u.fullname AS mechanic_name
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN users u ON r.mechanic_id = u.id
      WHERE r.id = ?
    `, [id]);

    if (repairRows.length === 0) {
      return res.status(404).render('error', { title: 'ไม่พบใบสั่งซ่อม', message: 'ไม่พบข้อมูลใบสั่งซ่อมที่ระบุ' });
    }

    const repair = repairRows[0];

    // 2. Get status logs
    const [logs] = await db.query(`
      SELECT rl.*, u.fullname AS updated_by_name 
      FROM repair_logs rl
      JOIN users u ON rl.updated_by = u.id
      WHERE rl.repair_id = ?
      ORDER BY rl.created_at DESC
    `, [id]);

    // 3. Get parts used for this repair
    const [partsUsed] = await db.query(`
      SELECT rp.*, i.part_name, i.part_number 
      FROM repair_parts rp
      JOIN inventory i ON rp.part_id = i.id
      WHERE rp.repair_id = ?
    `, [id]);

    // 4. Get active mechanics list
    const [mechanics] = await db.query("SELECT id, fullname FROM users WHERE role = 'mechanic' AND status = 'active'");

    // 5. Get available spare parts in inventory
    const [inventoryParts] = await db.query("SELECT id, part_name, part_number, sell_price, stock_qty FROM inventory WHERE stock_qty > 0 ORDER BY part_name ASC");

    res.render('repairs/detail', {
      title: `รายละเอียดใบสั่งซ่อม #${repair.id}`,
      activePage: 'repairs',
      repair: repair,
      logs: logs,
      partsUsed: partsUsed,
      mechanics: mechanics,
      inventoryParts: inventoryParts
    });
  } catch (err) {
    console.error('Get Repair Detail Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลรายละเอียดงานซ่อมได้' });
  }
};

// Create a new repair job ("รับรถเข้าซ่อม")
const addRepair = async (req, res) => {
  const { vehicle_id, description } = req.body;
  const car_photo_before = req.file ? '/uploads/' + req.file.filename : null;

  if (!vehicle_id || !description) {
    return res.status(400).json({ success: false, message: 'กรุณาเลือกรถยนต์และบันทึกรายละเอียดอาการแจ้งซ่อม' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Fetch customer_id from vehicle
    const [[vehicle]] = await conn.query(`
      SELECT v.customer_id, c.fullname AS owner_name, v.license_plate 
      FROM vehicles v
      JOIN customers c ON v.customer_id = c.id
      WHERE v.id = ?
    `, [vehicle_id]);
    
    if (!vehicle) {
      throw new Error('ไม่พบข้อมูลรถยนต์ที่ระบุ');
    }

    // 2. Insert into repairs table
    const insertSql = `
      INSERT INTO repairs (vehicle_id, customer_id, description, status, car_photo_before) 
      VALUES (?, ?, ?, 'pending', ?)
    `;
    const [result] = await conn.query(insertSql, [vehicle_id, vehicle.customer_id, description, car_photo_before]);
    const repairId = result.insertId;

    // 3. Write initial log
    await conn.query(`
      INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
      VALUES (?, 'pending', 'ลงทะเบียนรับรถเข้าระบบ พร้อมถ่ายรูปสภาพรถยนต์', ?)
    `, [repairId, req.session.user.id]);

    await conn.commit();

    // Send LINE notify alert asynchronously
    notificationService.sendCarReceivedNotification(repairId, vehicle.owner_name, vehicle.license_plate, description)
      .catch(err => console.error('LINE Notify Error:', err));

    res.json({ success: true, message: 'สร้างใบสั่งซ่อมและรับรถเข้าระบบสำเร็จ', repairId: repairId });
  } catch (err) {
    await conn.rollback();
    console.error('Add Repair Error:', err);
    res.status(500).json({ success: false, message: err.message || 'เกิดข้อผิดพลาดในการบันทึกใบซ่อม' });
  } finally {
    conn.release();
  }
};

// Update estimated cost ("สร้างใบเสนอราคา / อนุมัติใบเสนอราคา")
const updateEstimate = async (req, res) => {
  const { id } = req.params;
  const { estimated_cost } = req.body;

  if (estimated_cost === undefined || isNaN(estimated_cost)) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกราคาประเมินให้ถูกต้อง' });
  }

  try {
    await db.query('UPDATE repairs SET estimated_cost = ? WHERE id = ?', [estimated_cost, id]);
    
    // Add log
    await db.query(`
      INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
      VALUES (?, 'inspecting', ?, ?)
    `, [id, `บันทึกราคาประเมินค่าซ่อมเบื้องต้น: ${parseFloat(estimated_cost).toLocaleString()} บาท`, req.session.user.id]);

    // Fetch customer details to send LINE Notify
    const [[repair]] = await db.query(`
      SELECT r.id, c.fullname 
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      WHERE r.id = ?
    `, [id]);

    notificationService.sendQuoteReadyNotification(id, repair.fullname, estimated_cost)
      .catch(err => console.error('LINE Notify Error:', err));

    res.json({ success: true, message: 'บันทึกราคาประเมินและอัปเดตใบเสนอราคาสำเร็จ' });
  } catch (err) {
    console.error('Update Estimate Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกราคาประเมิน' });
  }
};

// Assign mechanic and add parts to the job ("มอบหมายช่าง และเบิกอะไหล่")
const assignMechanicAndParts = async (req, res) => {
  const { id } = req.params;
  const { mechanic_id, part_id, quantity } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Assign mechanic if provided
    if (mechanic_id) {
      await conn.query('UPDATE repairs SET mechanic_id = ? WHERE id = ?', [mechanic_id, id]);
      const [[mechanic]] = await conn.query('SELECT fullname FROM users WHERE id = ?', [mechanic_id]);
      
      await conn.query(`
        INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
        VALUES (?, 'repairing', ?, ?)
      `, [id, `มอบหมายให้ช่าง: ${mechanic.fullname} เป็นผู้รับผิดชอบงานซ่อม`, req.session.user.id]);
    }

    // 2. Add part & deduct stock if provided
    if (part_id && quantity) {
      const qtyToDeduct = parseInt(quantity);
      if (qtyToDeduct <= 0) throw new Error('จำนวนที่เบิกต้องมากกว่า 0');

      // Check stock availability
      const [[part]] = await conn.query('SELECT part_name, stock_qty, min_qty, sell_price FROM inventory WHERE id = ?', [part_id]);
      if (!part) throw new Error('ไม่พบอะไหล่ชิ้นนี้ในระบบ');
      if (part.stock_qty < qtyToDeduct) {
        throw new Error(`อะไหล่ "${part.part_name}" มีในสต็อกไม่เพียงพอ (เหลืออยู่ ${part.stock_qty} ชิ้น)`);
      }

      // Check if part already exists in this repair
      const [existingPart] = await conn.query('SELECT id, quantity FROM repair_parts WHERE repair_id = ? AND part_id = ?', [id, part_id]);

      if (existingPart.length > 0) {
        // Update quantity in repair_parts
        const newQty = existingPart[0].quantity + qtyToDeduct;
        await conn.query('UPDATE repair_parts SET quantity = ? WHERE id = ?', [newQty, existingPart[0].id]);
      } else {
        // Insert new row
        await conn.query(`
          INSERT INTO repair_parts (repair_id, part_id, quantity, sell_price) 
          VALUES (?, ?, ?, ?)
        `, [id, part_id, qtyToDeduct, part.sell_price]);
      }

      // Deduct inventory stock
      const remainingStock = part.stock_qty - qtyToDeduct;
      await conn.query('UPDATE inventory SET stock_qty = ? WHERE id = ?', [remainingStock, part_id]);

      // Add log
      await conn.query(`
        INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
        VALUES (?, 'waiting_parts', ?, ?)
      `, [id, `เบิกอะไหล่: ${part.part_name} จำนวน ${qtyToDeduct} ชิ้น`, req.session.user.id]);

      // Check for low stock notification
      if (remainingStock <= part.min_qty) {
        notificationService.sendLowStockNotification(part.part_name, remainingStock, part.min_qty)
          .catch(err => console.error('LINE Low Stock Notify Error:', err));
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'บันทึกข้อมูลและอัปเดตสต็อกเรียบร้อยแล้ว' });
  } catch (err) {
    await conn.rollback();
    console.error('Assign Mechanic/Parts Error:', err);
    res.status(500).json({ success: false, message: err.message || 'เกิดข้อผิดพลาดในการมอบหมายช่างหรือเบิกอะไหล่' });
  } finally {
    conn.release();
  }
};

// Update repair progress status
const updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const validStatuses = ['pending', 'inspecting', 'waiting_parts', 'repairing', 'checking', 'ready', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'สถานะไม่ถูกต้องตามโครงสร้างระบบ' });
  }

  try {
    await db.query('UPDATE repairs SET status = ? WHERE id = ?', [status, id]);

    // Translate status to Thai for log message
    const statusTextMap = {
      'pending': 'รับรถเข้าระบบ',
      'inspecting': 'กำลังตรวจสภาพ',
      'waiting_parts': 'รออะไหล่สำรอง',
      'repairing': 'กำลังดำเนินการซ่อม',
      'checking': 'รอตรวจสอบงานซ่อม',
      'ready': 'ซ่อมเสร็จสิ้น / พร้อมส่งมอบ',
      'completed': 'ส่งมอบรถคืนลูกค้าแล้ว',
      'cancelled': 'ยกเลิกใบสั่งซ่อม'
    };

    const logNotes = `เปลี่ยนสถานะเป็น: [${statusTextMap[status]}]` + (notes ? ` - บันทึกย่อ: ${notes}` : '');

    await db.query(`
      INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
      VALUES (?, ?, ?, ?)
    `, [id, status, logNotes, req.session.user.id]);

    res.json({ success: true, message: 'อัปเดตสถานะงานซ่อมเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('Update Status Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตสถานะ' });
  }
};

// Close repair job ("บันทึกปิดงาน")
const closeRepair = async (req, res) => {
  const { id } = req.params;
  const { actual_cost, warranty_months } = req.body;
  const car_photo_after = req.file ? '/uploads/' + req.file.filename : null;

  if (actual_cost === undefined || isNaN(actual_cost)) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกค่าซ่อมจริงให้ถูกต้อง' });
  }

  const months = parseInt(warranty_months) || 0;
  let warranty_expire_date = null;
  if (months > 0) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    warranty_expire_date = d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Get current photo if not uploaded
    let photoSql = '';
    const photoParams = [];
    if (car_photo_after) {
      photoSql = ', car_photo_after = ?';
      photoParams.push(car_photo_after);
    }

    // 2. Update repair
    const updateSql = `
      UPDATE repairs 
      SET status = 'ready', actual_cost = ?, warranty_expire_date = ? ${photoSql}
      WHERE id = ?
    `;
    await conn.query(updateSql, [actual_cost, warranty_expire_date, ...photoParams, id]);

    // 3. Add log
    const warrantyText = months > 0 ? `รับประกันงานซ่อมเป็นเวลา ${months} เดือน (ถึงวันที่ ${new Date(warranty_expire_date).toLocaleDateString('th-TH')})` : 'ไม่มีการรับประกันงานซ่อม';
    await conn.query(`
      INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
      VALUES (?, 'ready', ?, ?)
    `, [id, `บันทึกปิดงานซ่อมเสร็จสิ้น: ยอดค่าใช้จ่ายจริง ${parseFloat(actual_cost).toLocaleString()} บาท, ${warrantyText}`, req.session.user.id]);

    await conn.commit();

    // Fetch customer details to send LINE Completed Notify
    const [[repair]] = await db.query(`
      SELECT r.id, c.fullname 
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      WHERE r.id = ?
    `, [id]);

    notificationService.sendRepairCompletedNotification(id, repair.fullname, actual_cost)
      .catch(err => console.error('LINE Notify Completed Error:', err));

    res.json({ success: true, message: 'ปิดงานซ่อมเรียบร้อย รถยนต์พร้อมส่งมอบให้ลูกค้า' });
  } catch (err) {
    await conn.rollback();
    console.error('Close Repair Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกปิดงานซ่อม' });
  } finally {
    conn.release();
  }
};

// Send full Quotation / Invoice Flex message via LINE
const sendLineInvoice = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await notificationService.sendInvoiceQuotationNotification(id);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || result.error });
    }

    let destMsg = 'ส่งเข้า LINE แอดมินเรียบร้อยแล้ว';
    if (result.sentToCustomer) {
      destMsg = `ส่งเข้า LINE คุณ ${result.customerName} และแอดมินเรียบร้อยแล้ว`;
    }

    res.json({ success: true, message: `🎉 ${destMsg}!` });
  } catch (err) {
    console.error('Send Line Invoice Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่ง LINE: ' + err.message });
  }
};

module.exports = {
  getAllRepairs,
  getRepairDetail,
  addRepair,
  updateEstimate,
  assignMechanicAndParts,
  updateStatus,
  closeRepair,
  sendLineInvoice
};
