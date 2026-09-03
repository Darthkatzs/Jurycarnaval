const fs = require('fs');
const { Pool } = require('pg');

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`Failed to read ${filePath}, using fallback:`, err.message);
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function shouldUseSsl() {
  return process.env.PGSSLMODE === 'require' || process.env.POSTGRES_SSL === 'true';
}

function createStorage({ configPath, statePath }) {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!databaseUrl) {
    return {
      type: 'file',
      async load(defaults) {
        return {
          config: readJsonFile(configPath, defaults.config),
          state: readJsonFile(statePath, defaults.state),
        };
      },
      async saveConfig(config) {
        writeJsonFile(configPath, config);
      },
      async saveState(state) {
        writeJsonFile(statePath, state);
      },
      async close() {},
    };
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
  });

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_storage (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async function getOrSeed(key, seedValue) {
    const existing = await pool.query('SELECT value FROM app_storage WHERE key = $1', [key]);
    if (existing.rowCount > 0) {
      return existing.rows[0].value;
    }

    await pool.query(
      `INSERT INTO app_storage (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(seedValue)]
    );
    return seedValue;
  }

  async function save(key, value) {
    await pool.query(
      `INSERT INTO app_storage (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  }

  return {
    type: 'postgres',
    async load(defaults) {
      await ensureTable();
      const [config, state] = await Promise.all([
        getOrSeed('config', defaults.config),
        getOrSeed('state', defaults.state),
      ]);
      return { config, state };
    },
    async saveConfig(config) {
      await save('config', config);
    },
    async saveState(state) {
      await save('state', state);
    },
    async close() {
      await pool.end();
    },
  };
}

module.exports = { createStorage, readJsonFile };
