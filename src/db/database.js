const { createClient } = require('@libsql/client');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../../config');
const { SCHEMA_SQL } = require('./schema');

let defaultDbInstance = null;

/**
 * Initializes and returns a unified async database adapter
 * Supports Turso Cloud (@libsql/client over HTTP) and local SQLite fallback.
 *
 * @param {string} [customPath] Custom database path or connection URL
 * @returns {object} Database wrapper matching the async database contract
 */
function initializeDatabase(customPath) {
  let url;
  let authToken = undefined;

  // Determine connection mode: Cloud or Local Fallback
  if (customPath && (customPath.startsWith('libsql://') || customPath.startsWith('http://') || customPath.startsWith('https://'))) {
    url = customPath;
    authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  } else if (!customPath && process.env.TURSO_DATABASE_URL) {
    url = process.env.TURSO_DATABASE_URL;
    authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  } else {
    // Local SQLite fallback
    const targetPath = customPath || config.DB_PATH;
    if (targetPath === ':memory:' || targetPath === 'file::memory:') {
      url = 'file::memory:';
    } else {
      const resolved = path.resolve(targetPath);
      try {
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (e) {
        // Safe for read-only serverless filesystems
      }
      url = `file:${resolved.replace(/\\/g, '/')}`;
    }
  }

  const client = createClient({
    url,
    authToken
  });

  let schemaInitPromise = null;

  const wrapper = {
    client,
    raw: client,

    /**
     * Initializes the database schema idempotently
     */
    async initSchema() {
      if (typeof client.executeMultiple === 'function') {
        await client.executeMultiple(SCHEMA_SQL);
      } else {
        const statements = SCHEMA_SQL
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const stmt of statements) {
          await client.execute(stmt);
        }
      }

      // Safeguard for migrations: ensure file_data column exists on attachments table
      try {
        await client.execute('ALTER TABLE attachments ADD COLUMN file_data BLOB');
      } catch (e) {
        // Column already exists or table was just created with file_data
      }
    },

    async _ensureSchema() {
      if (!schemaInitPromise) {
        schemaInitPromise = wrapper.initSchema().catch((err) => {
          schemaInitPromise = null;
          throw err;
        });
      }
      return schemaInitPromise;
    },

    /**
     * Executes arbitrary DDL or multi-statement SQL
     * @param {string} sql
     */
    async exec(sql) {
      if (typeof client.executeMultiple === 'function') {
        return client.executeMultiple(sql);
      }
      return client.execute(sql);
    },

    /**
     * Executes a query returning an array of row objects
     * @param {string} sql
     * @param {Array} params
     * @returns {Promise<Array<Object>>}
     */
    async query(sql, params = []) {
      await wrapper._ensureSchema();
      const res = await client.execute({ sql, args: params });
      return Array.from(res.rows);
    },

    /**
     * Executes a query returning a single row object or null
     * @param {string} sql
     * @param {Array} params
     * @returns {Promise<Object|null>}
     */
    async get(sql, params = []) {
      await wrapper._ensureSchema();
      const res = await client.execute({ sql, args: params });
      return res.rows[0] || null;
    },

    /**
     * Executes an INSERT / UPDATE / DELETE statement
     * @param {string} sql
     * @param {Array} params
     * @returns {Promise<{ lastInsertRowid: number, changes: number }>}
     */
    async run(sql, params = []) {
      await wrapper._ensureSchema();
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
          ? Number(res.lastInsertRowid)
          : 0,
        changes: Number(res.rowsAffected || 0)
      };
    },

    /**
     * Executes a transaction block with atomicity
     * Passes a transaction-scoped wrapper `tx` to the callback
     * @param {Function} fn async (tx) => { ... }
     */
    async transaction(fn) {
      await wrapper._ensureSchema();
      const tx = await client.transaction('write');

      const txWrapper = {
        raw: tx,
        async query(sql, params = []) {
          const res = await tx.execute({ sql, args: params });
          return Array.from(res.rows);
        },
        async get(sql, params = []) {
          const res = await tx.execute({ sql, args: params });
          return res.rows[0] || null;
        },
        async run(sql, params = []) {
          const res = await tx.execute({ sql, args: params });
          return {
            lastInsertRowid: res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
              ? Number(res.lastInsertRowid)
              : 0,
            changes: Number(res.rowsAffected || 0)
          };
        },
        async exec(sql) {
          if (typeof tx.executeMultiple === 'function') {
            return tx.executeMultiple(sql);
          }
          return tx.execute(sql);
        }
      };

      try {
        const result = await fn(txWrapper);
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch (rbErr) {
          // Ignore rollback errors if transaction was aborted
        }
        throw err;
      }
    },

    /**
     * Closes the database client
     */
    async close() {
      try {
        if (typeof client.close === 'function') {
          client.close();
        }
      } catch (e) {
        // Ignore close error
      }
    }
  };

  return wrapper;
}

/**
 * Returns the active singleton database adapter instance
 * @param {string} [customPath]
 */
function getDatabase(customPath) {
  if (customPath) {
    return initializeDatabase(customPath);
  }
  if (!defaultDbInstance) {
    defaultDbInstance = initializeDatabase();
  }
  return defaultDbInstance;
}

/**
 * Overrides the active singleton database instance (used for test isolation)
 * @param {object} instance
 */
function setDatabaseInstance(instance) {
  defaultDbInstance = instance;
}

module.exports = {
  initializeDatabase,
  getDatabase,
  setDatabaseInstance
};
