// tests/unit/db/pglite-backup-3950.test.ts
// #3950 — PGlite 日次バックアップ (取得 → 復元検証 → 確定 → ローテーション) のテスト。
//
// 本 Issue の事故は「バックアップ job が毎日動いているように見えて、実データは 2 週間以上
// 1 件も保護されていなかった」。したがって本テストが固定すべきは **『取れた』ではなく『復旧できる』**。
//
//   [BK1] 実 migration を適用した PGlite から採ったダンプが、別インスタンスへ復元でき、
//         投入したデータが復元後も読める (往復の実証)
//   [BK2] 復元検証 V3: journal と適用実績が乖離した DB のダンプは **検証で落ちる**
//         (= #3946 同型の「永久 skip される migration」を含む復元先を合格にしない)
//   [BK3] 検証に落ちた回は **バックアップファイルを確定させない** (verify-then-commit)
//   [BK4] ローテーションは保持世代を超えた古い世代だけを消す
//   [BK5] 失敗した回は **古い世代を消さない** (失敗が続くほど手持ちが減る事故を作らない)
//   [BK6] 最終成功時刻が状態ファイルに残る (fail が沈黙しないための可視化点)
//
// [BK2] / [BK3] / [BK5] は「gate を書いたが実は何も落とせていない」を防ぐ実効性検証。

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	backupFilename,
	loadJournalEntries,
	PGLITE_BACKUP_PREFIX,
	PgliteBackupVerificationError,
	sortBackupsNewestFirst,
	verifyPgliteDump,
} from '../../../src/lib/server/db/pglite/backup';
import {
	BACKUP_STATUS_FILENAME,
	runPgliteBackup,
} from '../../../src/lib/server/services/pglite-backup-service';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'pglite');

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

const clients: PGlite[] = [];
/** 実 migration を適用した PGlite (in-memory) を作る。 */
async function migratedClient(): Promise<PGlite> {
	const client = new PGlite();
	await client.waitReady;
	clients.push(client);
	await client.exec("SET TIME ZONE 'UTC';");
	await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
	return client;
}

afterAll(async () => {
	for (const c of clients) await c.close().catch(() => {});
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('#3950 PGlite backup — 復元できることの実証', () => {
	let journalEntries: Awaited<ReturnType<typeof loadJournalEntries>>;

	beforeAll(async () => {
		journalEntries = await loadJournalEntries(MIGRATIONS_DIR);
	});

	it('[BK1] 採ったダンプを別インスタンスへ復元すると、投入したデータが読める', async () => {
		const client = await migratedClient();
		// 復元後に「同じ行が読める」ことを見るための目印を 1 行入れる。
		await client.exec(`
			create table if not exists backup_roundtrip_probe (id text primary key, note text);
			insert into backup_roundtrip_probe (id, note) values ('bk1', 'restored');
		`);

		const dumped = await client.dumpDataDir('gzip');
		const bytes = Buffer.from(await dumped.arrayBuffer());
		expect(bytes.byteLength).toBeGreaterThan(0);

		const verification = await verifyPgliteDump(new Blob([bytes]), journalEntries);
		expect(verification.migrationsApplied).toBe(journalEntries.length);
		expect(verification.tablesVerified).toBeGreaterThan(0);

		// 検証関数の外でも独立に往復を確認する (検証関数が実は何も見ていない可能性を潰す)。
		const restored = new PGlite({ loadDataDir: new Blob([bytes]) });
		clients.push(restored);
		await restored.waitReady;
		const rows = await restored.query<{ note: string }>(
			"select note from backup_roundtrip_probe where id = 'bk1'",
		);
		expect(rows.rows[0]?.note).toBe('restored');
	}, 120_000);

	it('[BK2] journal に「適用済み最大 created_at より後の entry」があるダンプは検証で落ちる', async () => {
		const client = await migratedClient();
		const dumped = await client.dumpDataDir('gzip');
		const bytes = Buffer.from(await dumped.arrayBuffer());

		// #3946 同型: 適用実績より後ろの when を持つ entry = 復元先で未適用のまま残る migration。
		const drifted = [
			...journalEntries,
			{ idx: journalEntries.length, when: 9_999_999_999_999, tag: '9999_unapplied' },
		];

		await expect(verifyPgliteDump(new Blob([bytes]), drifted)).rejects.toThrow(
			PgliteBackupVerificationError,
		);
		await expect(verifyPgliteDump(new Blob([bytes]), drifted)).rejects.toThrow(
			/V3-journal-reconcile/,
		);
	}, 120_000);

	it('[BK3] 検証に落ちた回はバックアップファイルを確定させない', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk3-');
		// journal 側を細工して V3 を必ず落とす (migrationsDir をテスト用に差し替える)。
		const brokenMigrations = tempDir('gq-bk3-journal-');
		mkdirSync(join(brokenMigrations, 'meta'), { recursive: true });
		writeFileSync(
			join(brokenMigrations, 'meta', '_journal.json'),
			JSON.stringify({ entries: [{ idx: 0, when: 9_999_999_999_999, tag: '9999_unapplied' }] }),
		);

		await expect(
			runPgliteBackup({ client, backupDir, migrationsDir: brokenMigrations, retention: 3 }),
		).rejects.toThrow(/V3-journal-reconcile/);

		const produced = readdirSync(backupDir).filter((f) => f.startsWith(PGLITE_BACKUP_PREFIX));
		expect(produced).toEqual([]);
	}, 120_000);

	it('[BK4] ローテーションは保持世代を超えた古い世代だけを消す', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk4-');

		const filenames: string[] = [];
		// 保持 3 世代に対して 4 回取得する。now を注入してファイル名を時系列で固定する。
		for (let i = 0; i < 4; i++) {
			const result = await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 3,
				now: new Date(Date.UTC(2026, 6, 20 + i, 3, 0, 0)),
			});
			filenames.push(result.filename);
		}

		const remaining = sortBackupsNewestFirst(readdirSync(backupDir));
		expect(remaining).toHaveLength(3);
		// 残るのは新しい 3 世代。最初の 1 世代だけが消える。
		expect(remaining).toEqual(filenames.slice(1).reverse());
		expect(remaining).not.toContain(filenames[0]);
	}, 120_000);

	it('[BK5] 失敗した回は古い世代を消さない', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk5-');

		// まず正常に 2 世代作る。
		const kept: string[] = [];
		for (let i = 0; i < 2; i++) {
			const r = await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 1, // 保持 1 世代でも、失敗回に削除が走らないことを見たい
				now: new Date(Date.UTC(2026, 6, 20 + i, 3, 0, 0)),
			});
			kept.push(r.filename);
		}
		const beforeFailure = sortBackupsNewestFirst(readdirSync(backupDir));
		expect(beforeFailure).toHaveLength(1);

		// 次に必ず落ちる実行を挟む。
		const brokenMigrations = tempDir('gq-bk5-journal-');
		mkdirSync(join(brokenMigrations, 'meta'), { recursive: true });
		writeFileSync(
			join(brokenMigrations, 'meta', '_journal.json'),
			JSON.stringify({ entries: [{ idx: 0, when: 9_999_999_999_999, tag: '9999_unapplied' }] }),
		);
		await expect(
			runPgliteBackup({ client, backupDir, migrationsDir: brokenMigrations, retention: 1 }),
		).rejects.toThrow();

		// 失敗回で手持ちが減っていないこと。
		expect(sortBackupsNewestFirst(readdirSync(backupDir))).toEqual(beforeFailure);
	}, 120_000);

	it('[BK6] 成功・失敗ともに状態ファイルへ記録され、最終成功時刻が読める', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk6-');

		const ok = await runPgliteBackup({
			client,
			backupDir,
			migrationsDir: MIGRATIONS_DIR,
			retention: 3,
		});
		const afterSuccess = JSON.parse(
			readFileSync(join(backupDir, BACKUP_STATUS_FILENAME), 'utf-8'),
		) as Record<string, unknown>;
		expect(afterSuccess.lastSuccessFilename).toBe(ok.filename);
		expect(typeof afterSuccess.lastSuccessAt).toBe('string');
		expect(afterSuccess.lastFailureAt).toBeNull();

		const brokenMigrations = tempDir('gq-bk6-journal-');
		mkdirSync(join(brokenMigrations, 'meta'), { recursive: true });
		writeFileSync(
			join(brokenMigrations, 'meta', '_journal.json'),
			JSON.stringify({ entries: [{ idx: 0, when: 9_999_999_999_999, tag: '9999_unapplied' }] }),
		);
		await expect(
			runPgliteBackup({ client, backupDir, migrationsDir: brokenMigrations, retention: 3 }),
		).rejects.toThrow();

		const afterFailure = JSON.parse(
			readFileSync(join(backupDir, BACKUP_STATUS_FILENAME), 'utf-8'),
		) as Record<string, unknown>;
		// 失敗しても直前の成功時刻は保持される (「最後に成功したのはいつか」が失われない)。
		expect(afterFailure.lastSuccessFilename).toBe(ok.filename);
		expect(typeof afterFailure.lastFailureAt).toBe('string');
		expect(String(afterFailure.lastFailureMessage)).toMatch(/V3-journal-reconcile/);
	}, 120_000);

	it('[BK7] ファイル名は辞書順 = 時系列順になる (ローテーションの前提)', () => {
		const older = backupFilename(new Date(Date.UTC(2026, 6, 26, 3, 0, 0)));
		const newer = backupFilename(new Date(Date.UTC(2026, 6, 27, 3, 0, 0)));
		expect(older < newer).toBe(true);
		expect(sortBackupsNewestFirst([older, newer, 'ganbari-quest-20260725030000.db'])).toEqual([
			newer,
			older,
		]);
	});
});
