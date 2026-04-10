// tests/unit/helpers/test-db.ts
// Shared test database helper — imports SQL_CREATE_TABLES from implementation
// as the single source of truth. No more hand-maintained duplicate SQL.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SQL_CREATE_TABLES } from '../../../src/lib/server/db/create-tables';
import * as schema from '../../../src/lib/server/db/schema';

// ============================================================
// Types
// ============================================================

export type TestSqlite = InstanceType<typeof Database>;
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDatabase {
	sqlite: TestSqlite;
	db: TestDb;
}

// ============================================================
// All table names for reset operations (reverse FK dependency order).
// Derived from SQL_CREATE_TABLES — when a new table is added to
// create-tables.ts, add it here too (before its parent tables).
// ============================================================

const ALL_TABLES = [
	'trial_history',
	'viewer_tokens',
	'auto_challenges',
	'tenant_event_progress',
	'tenant_events',
	'cloud_exports',
	'custom_achievements',
	'certificates',
	'report_daily_summaries',
	'notification_logs',
	'push_subscriptions',
	'sibling_cheers',
	'sibling_challenge_progress',
	'sibling_challenges',
	'child_event_progress',
	'season_events',
	'stamp_entries',
	'stamp_cards',
	'stamp_masters',
	'activity_mastery',
	'child_activity_preferences',
	'child_custom_voices',
	'parent_messages',
	'daily_missions',
	'birthday_reviews',
	'checklist_overrides',
	'checklist_logs',
	'checklist_template_items',
	'checklist_templates',
	'special_rewards',
	'child_achievements',
	'achievements',
	'login_bonuses',
	'character_images',
	'rest_days',
	'evaluations',
	'status_history',
	'statuses',
	'market_benchmarks',
	'point_ledger',
	'activity_logs',
	'activities',
	'children',
	'settings',
	// categories is seed data, not cleared by resetDb
] as const;

// ============================================================
// Helper functions
// ============================================================

/**
 * Create an in-memory test database with the full schema.
 * Uses SQL_CREATE_TABLES from implementation — schema changes
 * automatically propagate to tests.
 * Returns { sqlite, db } for use in tests.
 */
export function createTestDb(): TestDatabase {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_CREATE_TABLES);
	const db = drizzle(sqlite, { schema });
	return { sqlite, db };
}

/**
 * Delete all data from all tables (except categories seed data).
 * Resets autoincrement counters. Safe to call between tests.
 */
export function resetDb(sqlite: TestSqlite): void {
	for (const table of ALL_TABLES) {
		sqlite.exec(`DELETE FROM ${table}`);
	}
	// Reset autoincrement counters
	const tableNames = ALL_TABLES.join("','");
	sqlite.exec(`DELETE FROM sqlite_sequence WHERE name IN ('${tableNames}')`);
}

/**
 * Close the test database connection.
 */
export function closeDb(sqlite: TestSqlite): void {
	sqlite.close();
}
