const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');

let defaultDbInstance = null;

function initializeDatabase(dbPath = config.DB_PATH) {
  const isMemory = dbPath === ':memory:';

  if (!isMemory) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Enable foreign keys and WAL mode (WAL mode is only applicable to disk databases)
  db.exec('PRAGMA foreign_keys = ON;');
  if (!isMemory) {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  // Execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  const wrapper = {
    raw: db,
    exec(sql) {
      return db.exec(sql);
    },
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    get(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    },
    run(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.run(...params);
    },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const result = fn();
        db.exec('COMMIT;');
        return result;
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    close() {
      try {
        db.close();
      } catch (e) {
        // Ignored if already closed
      }
    }
  };

  return wrapper;
}

function getDatabase(customPath) {
  if (customPath) {
    return initializeDatabase(customPath);
  }
  if (!defaultDbInstance) {
    defaultDbInstance = initializeDatabase();
  }
  return defaultDbInstance;
}

function setDatabaseInstance(instance) {
  defaultDbInstance = instance;
}

module.exports = {
  initializeDatabase,
  getDatabase,
  setDatabaseInstance
};

