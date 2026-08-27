const promptpay = require('promptpay-qr');
const QRCode = require('qrcode');
const db = require('../config/db');

/**
 * Generate Dynamic PromptPay QR Code
 */
exports.generatePromptPayQR = async (req, res) => {
  try {
    const { amount, promptpay_target, note } = req.query;

    // Fetch garage default promptpay from settings if not specified
    let target = promptpay_target;
    let recipientName = 'BT Auto Garage';

    try {
      const [rows] = await db.query('SELECT `key`, value FROM settings');
      const settings = {};
      if (rows && rows.length > 0) {
        rows.forEach(r => { settings[r.key] = r.value; });
      }

      if (!target && settings.promptpay_number) {
        target = settings.promptpay_number;
      }
      if (settings.promptpay_name || settings.shop_name) {
        recipientName = settings.promptpay_name || settings.shop_name;
      }
    } catch (dbErr) {
      console.warn('[QR] Could not fetch settings:', dbErr.message);
    }

    // Default fallback target if none set
    if (!target) {
      target = '0812345678';
    }

    const numAmount = amount ? parseFloat(amount) : 0;
    const payload = promptpay(target, { amount: numAmount > 0 ? numAmount : undefined });

    // Generate QR Code as DataURL (PNG Base64)
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
      color: {
        dark: '#002B49', // PromptPay Deep Navy
        light: '#FFFFFF'
      }
    });

    return res.json({
      success: true,
      target: target,
      recipientName: recipientName,
      amount: numAmount > 0 ? numAmount.toFixed(2) : '0.00',
      qrDataUrl: qrDataUrl,
      payload: payload,
      note: note || ''
    });
  } catch (error) {
    console.error('[QR Generation Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'ไม่สามารถสร้าง QR Code ได้: ' + error.message
    });
  }
};
