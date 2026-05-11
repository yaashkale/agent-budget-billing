import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const migrationPaths = [
  resolve(process.cwd(), "db/migrations/001_initial_schema.sql"),
  resolve(process.cwd(), "db/migrations/002_usage_events_budget_id.sql"),
];

const client = new Client({
  connectionString: databaseUrl,
});

try {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existingMigrations = await client.query(
    "SELECT name FROM schema_migrations"
  );
  const applied = new Set(existingMigrations.rows.map((row) => row.name));

  if (!applied.has("001_initial_schema.sql")) {
    const hasPublishersTable = await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'publishers'
        ) AS exists
      `
    );

    if (hasPublishersTable.rows[0]?.exists) {
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        ["001_initial_schema.sql"]
      );
      applied.add("001_initial_schema.sql");
      console.log("[migrate] bootstrapped 001_initial_schema.sql");
    }
  }

  if (!applied.has("002_usage_events_budget_id.sql")) {
    const hasBudgetIdColumn = await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'usage_events'
            AND column_name = 'budget_id'
        ) AS exists
      `
    );

    if (hasBudgetIdColumn.rows[0]?.exists) {
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        ["002_usage_events_budget_id.sql"]
      );
      applied.add("002_usage_events_budget_id.sql");
      console.log("[migrate] bootstrapped 002_usage_events_budget_id.sql");
    }
  }

  for (const migrationPath of migrationPaths) {
    const migrationName = basename(migrationPath);

    if (applied.has(migrationName)) {
      console.log(`[migrate] skipped ${migrationName}`);
      continue;
    }

    const sql = await readFile(migrationPath, "utf8");
    await client.query("BEGIN");

    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [migrationName]
      );
      applied.add(migrationName);
      await client.query("COMMIT");
      console.log(`[migrate] applied ${migrationName}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  console.log("[migrate] complete");
} finally {
  await client.end();
}
