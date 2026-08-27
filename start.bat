@echo off
chcp 65001 > nul
title GarageFlow - Auto Garage Management System

echo ========================================================
echo  🚗 กำลังเริ่มต้นระบบ GarageFlow (jectcar)...
echo ========================================================
echo.

:: 1. Start MariaDB Database
echo [1/3] กำลังตรวจสอบและเริ่มต้นฐานข้อมูล MariaDB...
tasklist /FI "IMAGENAME eq mariadbd.exe" 2>NUL | find /I /N "mariadbd.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo  - ฐานข้อมูลกำลังทำงานอยู่แล้ว (Port 3306)
) else (
    start "" /B "%LOCALAPPDATA%\Programs\MariaDB\bin\mariadbd.exe" --defaults-file="%LOCALAPPDATA%\Programs\MariaDB\data\my.ini"
    timeout /t 2 /nobreak > nul
    echo  - เริ่มต้น MariaDB สำเร็จ!
)

:: 2. Start Web Server
echo.
echo [2/3] กำลังเริ่มต้นเว็บเซิร์ฟเวอร์ Express (Node.js)...
cd /d "%~dp0"
start "GarageFlow Server" cmd /k "node server.js"

:: 3. Open Browser
echo.
echo [3/3] กำลังเปิดเว็บเบราว์เซอร์ http://localhost:3000 ...
timeout /t 2 /nobreak > nul
start http://localhost:3000

echo.
echo ========================================================
echo  🎉 ระบบเปิดใช้งานเรียบร้อยแล้ว!
echo  - เข้าสู่ระบบ: http://localhost:3000
echo  - บัญชีเจ้าของอู่: owner / owner123
echo ========================================================
echo.
pause
