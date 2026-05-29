const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { auth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  dest: path.join(__dirname, '../uploads/receipts/'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  },
});

const CATEGORIES = ['Fuel','Maintenance','Tires','Insurance','Permits & Licenses','Tolls & Scales',
  'Meals','Lodging','Phone & Data','Equipment','Lumper Fees','Parking','Other'];

function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

router.post('/scan', auth, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = req.file.path;
  try {
    const anthropic = getAnthropic();
    if (!anthropic) {
      fs.unlink(filePath, () => {});
      return res.status(503).json({ error: 'Receipt scanning not configured. Add ANTHROPIC_API_KEY.' });
    }
    const base64    = fs.readFileSync(filePath).toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `Parse this receipt. Return ONLY valid JSON:
{"date":"YYYY-MM-DD or null","amount":number or null,"merchant":"name or null","description":"brief description","category":one of: ${CATEGORIES.map(c=>`"${c}"`).join(',')}}
Today is ${new Date().toISOString().slice(0,10)}.` },
        ],
      }],
    });
    fs.unlink(filePath, () => {});

    const raw     = message.content[0]?.text?.trim() || '';
    const jsonStr = raw.replace(/^```json?\s*/i,'').replace(/```\s*$/,'').trim();
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch { return res.status(422).json({ error: 'Could not read receipt. Try a clearer photo.' }); }

    res.json({
      date:        parsed.date        || new Date().toISOString().slice(0,10),
      amount:      parsed.amount != null ? Math.abs(Number(parsed.amount)) : null,
      merchant:    parsed.merchant    || '',
      description: parsed.description || parsed.merchant || '',
      category:    CATEGORIES.includes(parsed.category) ? parsed.category : 'Other',
    });
  } catch (err) {
    fs.unlink(filePath, () => {});
    console.error('Receipt scan error:', err.message);
    res.status(500).json({ error: 'Scan failed. Enter manually.' });
  }
});

module.exports = router;
