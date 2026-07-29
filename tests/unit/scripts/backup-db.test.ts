import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildBackupFilename,
	SQLITE_BACKUP_FILENAME_PATTERN,
	selectBackupGenerations,
} from '../../../scripts/backup-db.cjs';

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

	function runBackup(hookEnv: string, extraEnv: Record<string, string> = {}) {
		const env = {
			...process.env,
			DATABASE_URL: dbPath,
			BACKUP_DIR: backupDir,
			BACKUP_POST_HOOK: hookEnv,
			...extraEnv,
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

	// -----------------------------------------------------------------------
	// ローテーションの世代判定 (#3978)
	//
	// 旧実装は `f.startsWith('ganbari-quest-') && f.endsWith('.db')` の緩い一致で世代を数え、
	// その結果を `.sort().reverse().slice(MAX_BACKUPS)` して unlinkSync していた。
	// BACKUP_DIR には運用中に命名規則外のファイルが同居するため、それらが世代枠を食って
	// 実バックアップの最古世代が本来より早く消える (#3956 で PGlite 側について受けた指摘と同 class)。
	//
	// fixture には **規則に従わないが実在するもの**を実名で混ぜる (dev-session.md §台帳 #3)。
	// -----------------------------------------------------------------------

	/** 命名規則に従う世代 (`ganbari-quest-<YYYYMMDDHHMMSS>.db`)。古い順。 */
	const VALID_GENERATIONS = [
		'ganbari-quest-20260101000000.db',
		'ganbari-quest-20260102000000.db',
		'ganbari-quest-20260103000000.db',
		'ganbari-quest-20260104000000.db',
	];

	/**
	 * 命名規則から外れているが BACKUP_DIR に実在し得るファイル群。
	 * 先頭 2 件は旧実装の緩い一致に **一致してしまう** (= 世代枠を食う) もの。
	 */
	const NON_CONFORMING_FILES = [
		// 手動退避。辞書順で 'm' > 数字のため降順ソートの先頭 (最新扱い) に恒久的に居座る。
		'ganbari-quest-manual-pre-hotfix.db',
		// 旧命名の残骸 (ハイフン区切り)。prefix / 拡張子とも一致する。
		'ganbari-quest-2026-07-26.db',
		// 中断した採取の残骸。
		'ganbari-quest-20260105000000.db.tmp',
		// SQLite WAL sidecar。
		'ganbari-quest-20260104000000.db-wal',
		// PGlite 側の手動スナップショット (#3950 一次証跡の実名)。同じ dir に置かれ得る。
		'pglite-snapshot-20260726-0738-pre-pr3947.tgz',
	];

	function seedBackupDir(files: string[]) {
		fs.mkdirSync(backupDir, { recursive: true });
		for (const f of files) fs.writeFileSync(path.join(backupDir, f), 'x');
	}

	function listBackupDir(): string[] {
		return fs.readdirSync(backupDir).sort();
	}

	function listGenerations(): string[] {
		return listBackupDir().filter((f) => /^ganbari-quest-\d{14}\.db$/.test(f));
	}

	it('[BK-R1] 命名規則外ファイルが同居しても保持世代数・削除対象が変わらない', () => {
		seedBackupDir([...VALID_GENERATIONS, ...NON_CONFORMING_FILES]);

		const out = runBackup('', { BACKUP_RETENTION: '3' });
		expect(out).toContain('=== Backup complete ===');

		// 新規採取 1 本を含めて 5 世代 → 新しい順に 3 世代だけ残る。
		const generations = listGenerations();
		expect(generations).toHaveLength(3);
		// 残るのは「新規採取 + 20260104 + 20260103」。同居物に枠を食われていない。
		expect(generations).toContain('ganbari-quest-20260104000000.db');
		expect(generations).toContain('ganbari-quest-20260103000000.db');
		expect(generations).not.toContain('ganbari-quest-20260102000000.db');
		expect(generations).not.toContain('ganbari-quest-20260101000000.db');
		expect(out).toContain('[Backup] Total: 3 backups');

		// 命名規則外のファイルは 1 件も削除されていない (世代でもゴミでもなく、運用者の持ち物)。
		const remaining = listBackupDir();
		for (const f of NON_CONFORMING_FILES) {
			expect(remaining, `${f} が削除された`).toContain(f);
		}
	});

	it('[BK-R2] prefix に一致するディレクトリを世代として数えない', () => {
		// 運用者が古い世代を退避したディレクトリ。名前だけでは file と区別できず、
		// 世代に数えると保持枠を食い、削除対象に入れば unlinkSync が EISDIR で落ちる。
		seedBackupDir(VALID_GENERATIONS.slice(0, 2));
		fs.mkdirSync(path.join(backupDir, 'ganbari-quest-archive.db'));

		const out = runBackup('', { BACKUP_RETENTION: '2' });
		expect(out).toContain('=== Backup complete ===');
		expect(out).toContain('[Backup] Total: 2 backups');

		expect(listGenerations()).toHaveLength(2);
		expect(fs.statSync(path.join(backupDir, 'ganbari-quest-archive.db')).isDirectory()).toBe(true);
	});

	it('[BK-R3] 生成したファイル名は世代判定パターンに完全一致する (命名変更で silent に壊れない)', () => {
		seedBackupDir([]);
		const out = runBackup('', { BACKUP_RETENTION: '7' });
		expect(out).toContain('=== Backup complete ===');

		const generations = listGenerations();
		expect(generations).toHaveLength(1);
		// 生成側の assert (buildBackupFilename 内) が効いていること = 生成名と判定パターンが同期。
		expect(generations[0]).toMatch(SQLITE_BACKUP_FILENAME_PATTERN);
	});

	it('[BK-R4] selectBackupGenerations は完全一致した世代のみを新しい順で返す', () => {
		expect(selectBackupGenerations([...VALID_GENERATIONS, ...NON_CONFORMING_FILES])).toStrictEqual([
			'ganbari-quest-20260104000000.db',
			'ganbari-quest-20260103000000.db',
			'ganbari-quest-20260102000000.db',
			'ganbari-quest-20260101000000.db',
		]);
	});

	it('[BK-R5] buildBackupFilename は UTC の 14 桁タイムスタンプを使う (辞書順 = 時系列順)', () => {
		expect(buildBackupFilename(new Date('2026-07-26T07:38:09.123Z'))).toBe(
			'ganbari-quest-20260726073809.db',
		);
		expect(buildBackupFilename(new Date('2026-07-26T07:38:09.123Z'))).toMatch(
			SQLITE_BACKUP_FILENAME_PATTERN,
		);
		// 辞書順が時系列順であること (降順ソート = 新しい順、が成立する前提)。
		expect(
			buildBackupFilename(new Date('2026-01-01T00:00:00Z')) <
				buildBackupFilename(new Date('2026-12-31T23:59:59Z')),
		).toBe(true);
	});
});
