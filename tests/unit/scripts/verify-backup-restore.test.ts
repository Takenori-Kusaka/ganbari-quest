import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyRestoredDb } from '../../../scripts/verify-backup-restore.cjs';

describe('verify-backup-restore.cjs (#2542)', () => {
	let dbPath: string;
	let db: Database.Database;

	beforeEach(() => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-backup-test-'));
		dbPath = path.join(tmpDir, 'test.db');
		db = new Database(dbPath);

		// Initialize tables
		db.exec(`
			CREATE TABLE children (id INTEGER PRIMARY KEY);
			CREATE TABLE child_activities (id INTEGER PRIMARY KEY);
			CREATE TABLE activity_logs (id INTEGER PRIMARY KEY);
			CREATE TABLE point_ledger (id INTEGER PRIMARY KEY);
		`);

		// Set default env
		process.env.ALLOW_EMPTY = '0';
	});

	afterEach(() => {
		db.close();
		fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
		delete process.env.ALLOW_EMPTY;
	});

	it('AC2: day-0 normal state (children > 0, activities > 0, logs=0, ledger=0) should PASS', () => {
		db.exec(`
			INSERT INTO children (id) VALUES (1);
			INSERT INTO child_activities (id) VALUES (1);
		`);

		const result = verifyRestoredDb(dbPath);
		expect(result.ok).toBe(true);
		expect(result.failures).toHaveLength(0);
	});

	it('AC1: children > 0 but child_activities = 0 should FAIL (data loss risk)', () => {
		db.exec(`
			INSERT INTO children (id) VALUES (1);
		`);

		const result = verifyRestoredDb(dbPath);
		expect(result.ok).toBe(false);
		expect(result.failures).toContain('data loss risk: children > 0 but child_activities is empty');
	});

	it('AC3: All tables 0 rows should FAIL when ALLOW_EMPTY=0', () => {
		const result = verifyRestoredDb(dbPath);
		expect(result.ok).toBe(false);
		expect(result.failures).toContain('required table empty (data loss risk): children');
	});

	it('AC3: All tables 0 rows should PASS when ALLOW_EMPTY=1', () => {
		process.env.ALLOW_EMPTY = '1';
		const result = verifyRestoredDb(dbPath);
		expect(result.ok).toBe(true);
		expect(result.failures).toHaveLength(0);
	});

	it('Should fail if a required table is missing', () => {
		db.exec(`DROP TABLE point_ledger;`);
		const result = verifyRestoredDb(dbPath);
		expect(result.ok).toBe(false);
		expect(result.failures).toContain('required table missing: point_ledger');
	});
});
