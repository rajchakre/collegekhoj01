// src/db.js - Resilient Database setup supporting SQLite (WASM) and In-Memory Fallback for Vercel Serverless
const path = require('path');
const fs = require('fs');

let collegesData = [];
try {
  collegesData = require('../data/collegesData.json');
} catch (e) {
  collegesData = [];
}

// In-Memory Database Implementation for Serverless Fallback
class InMemoryDB {
  constructor(initialColleges) {
    this.colleges = [];
    this.courses = [];
    let collegeIdCounter = 1;
    let courseIdCounter = 1;

    for (const c of initialColleges) {
      const cid = c.id || collegeIdCounter++;
      this.colleges.push({
        id: cid,
        name: c.name || '',
        city: c.city || '',
        state: c.state || '',
        contact_number: c.contact_number || ''
      });
      if (Array.isArray(c.courses)) {
        for (const course of c.courses) {
          this.courses.push({
            id: courseIdCounter++,
            college_id: cid,
            course_name: course
          });
        }
      }
    }
    this.nextCollegeId = collegeIdCounter;
    this.nextCourseId = courseIdCounter;
  }

  exec(sql) {
    // No-op for PRAGMAs or CREATE TABLEs in memory
    return;
  }

  prepare(sql) {
    const s = sql.trim();
    const self = this;

    return {
      all: (params = []) => {
        // Query 1: Colleges Search & Filter
        if (s.includes('FROM colleges') && !s.includes('COUNT(')) {
          let list = [...self.colleges];

          // Check if single college by id
          if (s.includes('WHERE id = ?')) {
            const id = Number(params[0]);
            return list.filter(c => c.id === id);
          }

          // Full search query with LIKE params
          // Format in route: [q, q, q, state, city] or subsets
          let pIdx = 0;
          if (s.includes('(name LIKE ? OR city LIKE ? OR state LIKE ?)')) {
            const pattern = (params[pIdx] || '').replace(/%/g, '').toLowerCase();
            pIdx += 3;
            if (pattern) {
              list = list.filter(c =>
                c.name.toLowerCase().includes(pattern) ||
                c.city.toLowerCase().includes(pattern) ||
                c.state.toLowerCase().includes(pattern)
              );
            }
          }
          if (s.includes('state LIKE ?')) {
            const statePattern = (params[pIdx++] || '').replace(/%/g, '').toLowerCase();
            if (statePattern) {
              list = list.filter(c => c.state.toLowerCase() === statePattern || c.state.toLowerCase().includes(statePattern));
            }
          }
          if (s.includes('city LIKE ?')) {
            const cityPattern = (params[pIdx++] || '').replace(/%/g, '').toLowerCase();
            if (cityPattern) {
              list = list.filter(c => c.city.toLowerCase() === cityPattern || c.city.toLowerCase().includes(cityPattern));
            }
          }

          list.sort((a, b) => a.name.localeCompare(b.name));
          return list;
        }

        // Query 2: Courses with JOIN
        if (s.includes('FROM courses JOIN colleges') || s.includes('FROM courses')) {
          let list = self.courses.map(course => {
            const college = self.colleges.find(c => c.id === course.college_id);
            return {
              ...course,
              college_name: college ? college.name : ''
            };
          });

          let pIdx = 0;
          if (s.includes('courses.college_id = ?') || s.includes('college_id = ?')) {
            const cid = Number(params[pIdx++]);
            list = list.filter(c => c.college_id === cid);
          }
          if (s.includes('courses.course_name LIKE ?')) {
            const q = (params[pIdx++] || '').replace(/%/g, '').toLowerCase();
            if (q) {
              list = list.filter(c => c.course_name.toLowerCase().includes(q));
            }
          }

          list.sort((a, b) => a.course_name.localeCompare(b.course_name));
          return list;
        }

        return [];
      },

      get: (params = []) => {
        // Stats: COUNT(*) AS count FROM colleges
        if (s.includes('COUNT(*) AS count FROM colleges')) {
          return { count: self.colleges.length };
        }
        // Stats: COUNT(*) AS count FROM courses
        if (s.includes('COUNT(*) AS count FROM courses')) {
          return { count: self.courses.length };
        }
        // Stats: COUNT(DISTINCT state) AS count FROM colleges
        if (s.includes('COUNT(DISTINCT state)')) {
          const states = new Set(self.colleges.map(c => c.state).filter(Boolean));
          return { count: states.size };
        }
        // Single college by id
        if (s.includes('FROM colleges WHERE id = ?')) {
          const id = Number(params[0]);
          return self.colleges.find(c => c.id === id) || null;
        }

        return null;
      },

      run: (params = []) => {
        // Insert College
        if (s.includes('INSERT INTO colleges')) {
          const [name, city, state, contact_number] = params;
          const newId = self.nextCollegeId++;
          self.colleges.push({ id: newId, name, city, state, contact_number });
          return { lastInsertRowid: newId, changes: 1 };
        }
        // Insert Course
        if (s.includes('INSERT INTO courses')) {
          const [college_id, course_name] = params;
          const newId = self.nextCourseId++;
          self.courses.push({ id: newId, college_id: Number(college_id), course_name });
          return { lastInsertRowid: newId, changes: 1 };
        }
        return { changes: 0, lastInsertRowid: 0 };
      }
    };
  }
}

// Attempt SQLite initialization, with graceful fallback to In-Memory DB
let dbInstance = null;

try {
  // If running on Vercel or if WASM cannot load, use InMemoryDB directly
  if (process.env.VERCEL) {
    dbInstance = new InMemoryDB(collegesData);
    console.log('[CollegeKhoj] Running on Vercel: Initialized zero-dependency In-Memory Data Store');
  } else {
    const { Database } = require('node-sqlite3-wasm');
    const DB_PATH = path.join(__dirname, '..', 'data', 'collegekhoj.db');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

    const lockPath = DB_PATH + '.lock';
    if (fs.existsSync(lockPath)) {
      try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch (err) {}
    }

    const sqliteDb = new Database(DB_PATH);
    try { sqliteDb.exec('PRAGMA busy_timeout = 5000'); } catch (e) {}

    // Verify database has data
    const row = sqliteDb.prepare('SELECT COUNT(*) AS count FROM colleges').get([]);
    if (row && row.count > 0) {
      dbInstance = sqliteDb;
      console.log('[CollegeKhoj] Initialized SQLite database successfully');
    } else {
      dbInstance = new InMemoryDB(collegesData);
      console.log('[CollegeKhoj] Database empty, using embedded data store');
    }
  }
} catch (err) {
  console.warn('[CollegeKhoj] SQLite WASM unavailable, falling back to In-Memory Store:', err.message);
  dbInstance = new InMemoryDB(collegesData);
}

module.exports = dbInstance;