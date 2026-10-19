// src/server.js - Express server entry point
const express = require('express');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Enable Cross-Origin Resource Sharing (CORS)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/colleges', require('./routes/colleges'));
app.use('/api/courses',  require('./routes/courses'));

app.get('/api/stats', (req, res) => {
  try {
    const db = require('./db');
    const colleges = db.prepare('SELECT COUNT(*) AS count FROM colleges').get([]);
    const courses   = db.prepare('SELECT COUNT(*) AS count FROM courses').get([]);
    const states    = db.prepare('SELECT COUNT(DISTINCT state) AS count FROM colleges').get([]);
    res.json({
      colleges: colleges ? colleges.count : 0,
      courses: courses ? courses.count : 0,
      states: states ? states.count : 0
    });
  } catch (err) {
    console.error('Error in /api/stats:', err);
    res.status(500).json({ error: err.message, colleges: 0, courses: 0, states: 0 });
  }
});

const fs = require('fs');

app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Page not found');
  }
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nCollegeKhoj running at http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/colleges\n`);
  });
}

module.exports = app;