const db = require('../config/db');

// List inventory spare parts
const getAllInventory = async (req, res) => {
  const search = req.query.search || '';
  const category = req.query.category || '';
  const filterLowStock = req.query.low_stock === 'true';

  try {
    // 1. Get list of unique categories in inventory to populate the dropdown
    const [categories] = await db.query('SELECT DISTINCT category FROM inventory WHERE category IS NOT NULL AND category != "" ORDER BY category ASC');

    // 1.2 Get list of unique suppliers in inventory for autocomplete datalist
    const [suppliers] = await db.query('SELECT DISTINCT supplier FROM inventory WHERE supplier IS NOT NULL AND supplier != "" ORDER BY supplier ASC');

    // 1.3 Get list of unique part names in inventory for autocomplete datalist
    const [partNames] = await db.query('SELECT DISTINCT part_name FROM inventory WHERE part_name IS NOT NULL AND part_name != "" ORDER BY part_name ASC');

    let sql = 'SELECT * FROM inventory WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (part_name LIKE ? OR part_number LIKE ? OR supplier LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (filterLowStock) {
      sql += ' AND stock_qty <= min_qty';
    }

    sql += ' ORDER BY part_name ASC';

    const [rows] = await db.query(sql, params);

    res.render('inventory/index', {
      title: 'สต็อกอะไหล่',
      activePage: 'inventory',
      inventory: rows,
      categories: categories,
      suppliers: suppliers,
      partNames: partNames,
      search: search,
      selectedCategory: category,
      lowStockFiltered: filterLowStock
    });
  } catch (err) {
    console.error('Get Inventory Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลสต็อกอะไหล่ได้' });
  }
};

// Add new spare part
const addInventoryPart = async (req, res) => {
  const { part_name, part_number, category, stock_qty, min_qty, cost_price, sell_price, supplier } = req.body;

  if (!part_name || !part_number || !cost_price || !sell_price) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่ออะไหล่, รหัสอะไหล่, ราคาทุน และราคาขาย' });
  }

  try {
    // Check duplication
    const [existing] = await db.query('SELECT id FROM inventory WHERE part_number = ?', [part_number]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'รหัสอะไหล่นี้ซ้ำกับที่มีอยู่แล้วในคลัง' });
    }

    const sql = `
      INSERT INTO inventory (part_name, part_number, category, stock_qty, min_qty, cost_price, sell_price, supplier) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.query(sql, [
      part_name,
      part_number,
      category || null,
      parseInt(stock_qty) || 0,
      parseInt(min_qty) || 5,
      parseFloat(cost_price) || 0.00,
      parseFloat(sell_price) || 0.00,
      supplier || null
    ]);

    res.json({ success: true, message: 'บันทึกข้อมูลอะไหล่ลงคลังเรียบร้อย' });
  } catch (err) {
    console.error('Add Inventory Part Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดทางเทคนิคในการเพิ่มอะไหล่' });
  }
};

// Edit spare part info
const editInventoryPart = async (req, res) => {
  const { id } = req.params;
  const { part_name, part_number, category, min_qty, cost_price, sell_price, supplier } = req.body;

  if (!part_name || !part_number || !cost_price || !sell_price) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่สำคัญให้ครบถ้วน' });
  }

  try {
    // Check duplicate code excluding current
    const [existing] = await db.query('SELECT id FROM inventory WHERE part_number = ? AND id != ?', [part_number, id]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'รหัสอะไหล่ชนกับรายการอื่นในคลัง' });
    }

    const sql = `
      UPDATE inventory 
      SET part_name = ?, part_number = ?, category = ?, min_qty = ?, cost_price = ?, sell_price = ?, supplier = ? 
      WHERE id = ?
    `;
    const [result] = await db.query(sql, [
      part_name,
      part_number,
      category || null,
      parseInt(min_qty) || 5,
      parseFloat(cost_price) || 0.00,
      parseFloat(sell_price) || 0.00,
      supplier || null,
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบรายการสินค้าที่ระบุ' });
    }

    res.json({ success: true, message: 'อัปเดตข้อมูลอะไหล่ในคลังเรียบร้อย' });
  } catch (err) {
    console.error('Edit Inventory Part Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลอะไหล่' });
  }
};

// Delete spare part from stock
const deleteInventoryPart = async (req, res) => {
  const { id } = req.params;

  try {
    const sql = 'DELETE FROM inventory WHERE id = ?';
    const [result] = await db.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบรายการสินค้า' });
    }

    res.json({ success: true, message: 'ลบรายการอะไหล่ออกจากคลังคลังเรียบร้อย' });
  } catch (err) {
    console.error('Delete Part Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถลบได้ เนื่องจากรายการอะไหล่นี้ถูกเบิกใช้งานในประวัติการซ่อมแล้ว' });
  }
};

// restock/add stock quantity (" Restock")
const restockPart = async (req, res) => {
  const { id } = req.params;
  const { restock_qty } = req.body;

  const qtyToAdd = parseInt(restock_qty);
  if (isNaN(qtyToAdd) || qtyToAdd <= 0) {
    return res.status(400).json({ success: false, message: 'จำนวนเติมสต็อกต้องเป็นตัวเลขที่มากกว่า 0' });
  }

  try {
    const sql = 'UPDATE inventory SET stock_qty = stock_qty + ? WHERE id = ?';
    const [result] = await db.query(sql, [qtyToAdd, id]);

    if (result.affectedRows === 0) {
      return res.status(444).json({ success: false, message: 'ไม่พบรายการสินค้า' });
    }

    // Write Restock to Finance as expense (optional but good for tracking: cost_price * qtyToAdd)
    const [[part]] = await db.query('SELECT part_name, cost_price FROM inventory WHERE id = ?', [id]);
    const totalCost = part.cost_price * qtyToAdd;

    await db.query(`
      INSERT INTO finances (type, amount, description, transaction_date) 
      VALUES ('expense', ?, ?, ?)
    `, [totalCost, `ซื้อเติมสต็อกอะไหล่: ${part.part_name} จำนวน ${qtyToAdd} ชิ้น`, new Date().toISOString().split('T')[0]]);

    res.json({ success: true, message: `เติมสต็อกอะไหล่สำเร็จจำนวน +${qtyToAdd} ชิ้น (บันทึกรายจ่ายระบบเรียบร้อย)` });
  } catch (err) {
    console.error('Restock Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเติมสต็อก' });
  }
};

module.exports = {
  getAllInventory,
  addInventoryPart,
  editInventoryPart,
  deleteInventoryPart,
  restockPart
};
