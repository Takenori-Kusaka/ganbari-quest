import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

describe('backup-db.cjs (#2781 graceful fallback)', () => {
	let tmpDir: string;
	let dbPath: string;
	let backupDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-db-test-'));
		dbPath = path.join(tmpDir, 'test.db');
		backupDir = path.join(tmpDir, 'backups');

		// Create a dummy valid sqlite db
		const db = new Database(dbPath);
		db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY);');
		db.close();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function runBackup(hookEnv: string) {
		const env = {
			...process.env,
			DATABASE_URL: dbPath,
			BACKUP_DIR: backupDir,
			BACKUP_POST_HOOK: hookEnv,
		};
		// We execute the script directly in a child process
		// 2>&1 redirects stderr to stdout so we can capture console.warn
		return execSync('node scripts/backup-db.cjs 2>&1', { env, encoding: 'utf-8' });
	}

	it('hook file 不在時は warning を出して skip 成功する', () => {
		const out = runBackup(`node ${path.join(tmpDir, 'not-found.cjs')}`);
		expect(out).toContain('WARNING: BACKUP_POST_HOOK file not found');
		expect(out).toContain('skipping hook (backup itself succeeded)');
		expect(out).toContain('=== Backup complete ===');
		// 正常終了していれば execSync は例外を投げない
	});

	it('hook 実行失敗時も warning を出して backup は成功する', () => {
		const failingHookPath = path.join(tmpDir, 'fail.cjs');
		fs.writeFileSync(failingHookPath, 'process.exit(1);');

		const out = runBackup(`node ${failingHookPath}`);
		expect(out).toContain('WARNING: BACKUP_POST_HOOK failed:');
		expect(out).toContain('backup itself succeeded');
		expect(out).toContain('=== Backup complete ===');
	});

	it('正常な hook は OK と出力されて成功する', () => {
		const successHookPath = path.join(tmpDir, 'success.cjs');
		fs.writeFileSync(successHookPath, 'console.log("hook ran successfully");');

		const out = runBackup(`node ${successHookPath}`);
		expect(out).toContain('hook ran successfully');
		expect(out).toContain('[Hook] OK');
		expect(out).toContain('=== Backup complete ===');
	});
});
