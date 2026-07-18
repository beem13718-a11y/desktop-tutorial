const db = require('../config/db');

const getDashboardData = async (req, res) => {
  try {
    // 1. Core Summary Stats
    const [[{ total_customers }]] = await db.query('SELECT COUNT(*) AS total_customers FROM customers');
    const [[{ total_vehicles }]] = await db.query('SELECT COUNT(*) AS total_vehicles FROM vehicles');
    const [[{ total_repairs }]] = await db.query('SELECT COUNT(*) AS total_repairs FROM repairs');
    const [[{ low_stock_count }]] = await db.query('SELECT COUNT(*) AS low_stock_count FROM inventory WHERE stock_qty <= min_qty');

    // 2. Financial Metrics (Today & Current Month)
    const [[{ total: today_income }]] = await db.query(`
      SELECT SUM(amount) AS total FROM finances 
      WHERE type = 'income' AND status = 'paid' AND transaction_date = CURDATE()
    `);
    const [[{ total: month_income }]] = await db.query(`
      SELECT SUM(amount) AS total FROM finances 
      WHERE type = 'income' AND status = 'paid' AND DATE_FORMAT(transaction_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
    `);

    // 3. Status Count Breakdown
    const [[pending]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'pending'");
    const [[inspecting]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'inspecting'");
    const [[waiting_parts]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'waiting_parts'");
    const [[repairing]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'repairing'");
    const [[checking]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'checking'");
    const [[ready]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'ready'");
    const [[completed]] = await db.query("SELECT COUNT(*) AS count FROM repairs WHERE status = 'completed'");

    // 4. Recent 5 repairs (Latest Activities)
    const [recentRepairs] = await db.query(`
      SELECT r.*, c.fullname AS customer_name, v.license_plate, v.brand, v.model 
      FROM repairs r
      JOIN customers c ON r.customer_id = c.id
      JOIN vehicles v ON r.vehicle_id = v.id
      ORDER BY r.created_at DESC LIMIT 5
    `);

    // 5. Chart 1: Monthly Revenues (Past 6 Months)
    const [revenueHistory] = await db.query(`
      SELECT DATE_FORMAT(transaction_date, '%Y-%m') AS month, SUM(amount) AS total 
      FROM finances 
      WHERE type = 'income' AND status = 'paid' AND transaction_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY month 
      ORDER BY month ASC
    `);

    // 6. Chart 2: Monthly Repairs count (Past 6 Months)
    const [repairsHistory] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS total 
      FROM repairs 
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY month 
      ORDER BY month ASC
    `);

    // Map month names to Thai for chart display
    const monthThaiNames = {
      '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.', '05': 'พ.ค.', '06': 'มิ.ย.',
      '07': 'ก.ค.', '08': 'ส.ค.', '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
    };

    // Format chart data arrays
    const chartLabels = [];
    const revenueData = [];
    const repairsData = [];

    // Combine chart arrays
    // Create base labels from past 6 months to make sure they match even if database records are empty
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const year = d.getFullYear();
      const monthNum = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${monthNum}`;
      
      chartLabels.push(`${monthThaiNames[monthNum]} ${String(year).substring(2)}`);

      const revObj = revenueHistory.find(r => r.month === key);
      revenueData.push(revObj ? parseFloat(revObj.total) : 0);

      const repObj = repairsHistory.find(r => r.month === key);
      repairsData.push(repObj ? parseInt(repObj.total) : 0);
    }

    res.render('dashboard', {
      title: 'แผงควบคุมหลัก',
      activePage: 'dashboard',
      stats: {
        customers: total_customers,
        vehicles: total_vehicles,
        repairs: total_repairs,
        lowStock: low_stock_count,
        todayIncome: parseFloat(today_income) || 0.00,
        monthIncome: parseFloat(month_income) || 0.00
      },
      statusStats: {
        pending,
        inspecting,
        waiting_parts,
        repairing,
        checking,
        ready,
        completed
      },
      recentRepairs: recentRepairs,
      charts: {
        labels: JSON.stringify(chartLabels),
        revenue: JSON.stringify(revenueData),
        repairs: JSON.stringify(repairsData)
      }
    });
  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'เกิดข้อผิดพลาดในการรวบรวมข้อมูลสำหรับแดชบอร์ด' });
  }
};

module.exports = {
  getDashboardData
};
