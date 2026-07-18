-- Create Database
CREATE DATABASE IF NOT EXISTS garageflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE garageflow;

-- Drop existing tables to allow re-runs
DROP TABLE IF EXISTS repair_parts;
DROP TABLE IF EXISTS repair_logs;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS finances;
DROP TABLE IF EXISTS repairs;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS users;

-- 1. Users Table (Authentication and Roles)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    fullname VARCHAR(100) NOT NULL,
    role ENUM('owner', 'mechanic') NOT NULL,
    phone VARCHAR(20),
    skills VARCHAR(255) DEFAULT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Customers Table (Garage Customers)
CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    address TEXT,
    line_id VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Vehicles Table (Vehicles belonging to Customers)
CREATE TABLE IF NOT EXISTS vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    license_plate VARCHAR(50) UNIQUE NOT NULL,
    brand VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT,
    color VARCHAR(30),
    vin VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Repairs Table (Repair Jobs)
CREATE TABLE IF NOT EXISTS repairs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    customer_id INT NOT NULL,
    mechanic_id INT,
    description TEXT NOT NULL,
    status ENUM('pending', 'inspecting', 'waiting_parts', 'repairing', 'checking', 'ready', 'completed', 'cancelled') DEFAULT 'pending',
    estimated_cost DECIMAL(10, 2) DEFAULT 0.00,
    actual_cost DECIMAL(10, 2) DEFAULT 0.00,
    car_photo_before VARCHAR(255),
    car_photo_after VARCHAR(255),
    warranty_expire_date DATE DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (mechanic_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Inventory Table (Spare Parts)
CREATE TABLE IF NOT EXISTS inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    part_name VARCHAR(100) NOT NULL,
    part_number VARCHAR(50) UNIQUE NOT NULL,
    category VARCHAR(50) DEFAULT NULL,
    stock_qty INT NOT NULL DEFAULT 0,
    min_qty INT NOT NULL DEFAULT 5,
    cost_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    sell_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    supplier VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Finances Table (Income & Expenses)
CREATE TABLE IF NOT EXISTS finances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    repair_id INT DEFAULT NULL,
    type ENUM('income', 'expense') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('cash', 'transfer', 'qr') DEFAULT NULL,
    status ENUM('pending', 'paid', 'cancelled', 'installment') DEFAULT 'paid',
    installment_terms VARCHAR(50) DEFAULT NULL,
    description VARCHAR(255) NOT NULL,
    transaction_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Repair Logs (Status update history)
CREATE TABLE IF NOT EXISTS repair_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    repair_id INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    updated_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Repair Parts (Parts used for specific repairs)
CREATE TABLE IF NOT EXISTS repair_parts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    repair_id INT NOT NULL,
    part_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    sell_price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES inventory(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Audit Logs (System Action History)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    action VARCHAR(100) NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Mock Data
-- --------------------------------------------------------

-- Default passwords are 'owner123' and 'mechanic123' respectively (hashed using bcrypt)
-- owner123 -> $2a$10$i6bo0WsyCH3iiEf8GjpVnub80TYMbvbqehZ02B0EbempUP4HBzEGq
-- mechanic123 -> $2a$10$L2/ddd96h9rk5uFd.3BLWuVlsQPjGp4uR9wU9NCkg2VX1dh0uo7bW
INSERT INTO users (username, password, fullname, role, phone, skills, status) VALUES
('owner', '$2a$10$i6bo0WsyCH3iiEf8GjpVnub80TYMbvbqehZ02B0EbempUP4HBzEGq', 'สมชาย รักดี (เจ้าของอู่)', 'owner', '0812345678', 'บริหารจัดการ, ตรวจสอบสภาพรถขั้นสูง', 'active'),
('mechanic', '$2a$10$L2/ddd96h9rk5uFd.3BLWuVlsQPjGp4uR9wU9NCkg2VX1dh0uo7bW', 'สมศักดิ์ ช่างเหล็ก (ช่างใหญ่)', 'mechanic', '0898765432', 'ซ่อมเครื่องยนต์ดีเซล-เบนซิน, ระบบช่วงล่าง', 'active');

-- Mock Customers
INSERT INTO customers (fullname, phone, email, address) VALUES
('วิชัย รวยรุ่ง', '0823456789', 'wichai@email.com', '123/45 ถนนพัฒนาการ แขวงสวนหลวง เขตสวนหลวง กรุงเทพฯ'),
('นารี อ่อนหวาน', '0834567890', 'naree@email.com', '99/9 หมู่ 3 ถนนวิภาวดีรังสิต แขวงตลาดบางเขน เขตหลักสี่ กรุงเทพฯ'),
('มานะ อดทน', '0845678901', 'mana@email.com', '456 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพฯ');

-- Mock Vehicles
INSERT INTO vehicles (customer_id, license_plate, brand, model, year, color, vin) VALUES
(1, 'กก 1234 กรุงเทพมหานคร', 'Toyota', 'Camry', 2020, 'ดำ', 'MRHAC32L00012345'),
(2, 'รน 5678 นนทบุรี', 'Honda', 'Civic', 2021, 'ขาว', 'JHMCY23K00056789'),
(3, 'วว 9999 เชียงใหม่', 'Mazda', 'Mazda 3', 2019, 'แดง', 'JM1BP34M00099999');

-- Mock Repairs
INSERT INTO repairs (vehicle_id, customer_id, mechanic_id, description, status, estimated_cost, actual_cost) VALUES
(1, 1, 2, 'เปลี่ยนน้ำมันเครื่อง, ผ้าเบรคหน้า และเช็คระยะ 80,000 กม.', 'pending', 3500.00, 0.00),
(2, 2, 2, 'เครื่องยนต์มีเสียงดังผิดปกติและแอร์ไม่เย็น', 'repairing', 8500.00, 0.00),
(3, 3, 2, 'ซ่อมสีและตัวถังบริเวณกันชนท้าย', 'completed', 5000.00, 5000.00);

-- Mock Inventory (Parts)
INSERT INTO inventory (part_name, part_number, category, stock_qty, min_qty, cost_price, sell_price, supplier) VALUES
('น้ำมันเครื่องสังเคราะห์แท้ 4L', 'OIL-SYN-4L', 'ของเหลว', 20, 5, 800.00, 1200.00, 'PTT Lubricants Co., Ltd.'),
('กรองน้ำมันเครื่อง Toyota', 'FIL-TOY-001', 'ไส้กรอง', 50, 10, 120.00, 220.00, 'Denso Thailand'),
('ผ้าเบรคหน้า Toyota Camry', 'BRK-TOY-002', 'ระบบเบรก', 15, 3, 1100.00, 1800.00, 'Bendix Thailand'),
('น้ำยาแอร์ R134a', 'COL-R134A', 'ของเหลว', 10, 2, 500.00, 850.00, 'Cooling Parts Corp.'),
('หัวเทียน Honda Civic', 'PLG-HON-003', 'ระบบไฟ', 40, 5, 80.00, 150.00, 'NGK Spark Plugs');

-- Mock Finances (Income/Expenses)
INSERT INTO finances (repair_id, type, amount, payment_method, status, description, transaction_date) VALUES
(3, 'income', 5000.00, 'transfer', 'paid', 'ค่าซ่อมสีและตัวถังกันชนท้ายรถมาสด้ารุ่น 3 (ทะเบียน วว 9999)', '2026-07-01'),
(NULL, 'expense', 15000.00, 'transfer', 'paid', 'สั่งซื้ออะไหล่ผ้าเบรคและกรองน้ำมันเครื่องสะสมเข้าคลัง', '2026-06-30'),
(NULL, 'expense', 2500.00, 'cash', 'paid', 'ค่าน้ำค่าไฟของอู่ประจำเดือนมิถุนายน', '2026-06-28');

-- Mock Repair Logs
INSERT INTO repair_logs (repair_id, status, notes, updated_by) VALUES
(1, 'pending', 'ลงทะเบียนรับรถ รอการตรวจสภาพโดยละเอียด', 1),
(2, 'pending', 'รับรถเรียบร้อย รอช่างประเมินอาการแอร์ไม่เย็น', 1),
(2, 'inspecting', 'ตรวจเช็คคอมเพรสเซอร์แอร์ พบรอยรั่วและแบริ่งหลวม', 2),
(2, 'repairing', 'อยู่ระหว่างเบิกคอมเพรสเซอร์แอร์ใหม่และถอดเปลี่ยน', 2),
(3, 'pending', 'ลงทะเบียนรับรถซ่อมสีกันชนท้าย', 1),
(3, 'repairing', 'ขัดเตรียมพื้นผิวและพ่นสีใหม่เรียบร้อย', 2),
(3, 'completed', 'สีแห้งสนิท ล้างทำความสะอาดรถ และลูกค้าชำระเงินเรียบร้อย', 1);

-- Mock Audit Logs
INSERT INTO audit_logs (user_id, action, details) VALUES
(1, 'system_init', 'ระบบเริ่มต้นทำงานฐานข้อมูลเรียบร้อย'),
(1, 'login', 'เจ้าของอู่ สมชาย รักดี เข้าสู่ระบบ');

-- System Settings Table
CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(100) UNIQUE NOT NULL,
    value TEXT DEFAULT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value) VALUES
('line_notify_token', ''),
('line_channel_token', ''),
('line_channel_secret', '');
