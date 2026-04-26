const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── PDF Upload ──────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const user = req.headers['x-user'] || 'shared';
    const dir = path.join(__dirname, 'uploads', user);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/api/pdfs/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const user = req.headers['x-user'] || 'shared';
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    url: `/uploads/${user}/${req.file.filename}`
  });
});

app.get('/api/pdfs', (req, res) => {
  const user = req.headers['x-user'] || 'shared';
  const dir = path.join(__dirname, 'uploads', user);
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.pdf'))
    .map(filename => {
      const stats = fs.statSync(path.join(dir, filename));
      const originalname = filename.split('_').slice(1).join('_') || filename;
      return { filename, originalname, size: stats.size, url: `/uploads/${user}/${filename}`, created: stats.birthtime };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  res.json(files);
});

app.delete('/api/pdfs/:filename', (req, res) => {
  const user = req.headers['x-user'] || 'shared';
  const filePath = path.join(__dirname, 'uploads', user, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// ── Serve App ───────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🍀 OppsTrack running at http://localhost:${PORT}\n`);
});
