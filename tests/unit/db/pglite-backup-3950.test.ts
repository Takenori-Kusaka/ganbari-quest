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
//   [BK7] ファイル名は辞書順 = 時系列順 (ローテーションの前提)
//   [BK8] **命名規則に従わない同 prefix ファイル (手動スナップショット) を世代として数えない**
//         — 数えると実保持が 3 → 2 世代に減る (QA レビュー #3956 指摘の回帰固定)
//   [BK9] Runbook の退避先 `manual/` が実 FS 上に同居してもローテーションは世代だけを削る
//         (readdir → フィルタ → rm の実経路。ディレクトリが混ざれば rm が EISDIR で落ちる)
//
// #4129 (E3) で追加:
//   [BK10] **retention 引き下げ後の初回ローテーションで一度に複数世代を消さない** (fail-closed)
//          — #3950 は BACKUP_RETENTION を 7 → 3 に下げており、初回実行で 4 世代が一括物理削除される
//          状態だった。削除は不可逆で、退避していなければ過去世代は永久に戻らない。
//          2026-07-31 時点で未発火だったのは「backup job 自体が CRON_SECRET 未配布で止まっていた」
//          という幸運によるもの (#4119)。job を直した以上、次に動く回で発火する
//   [BK11] **連続失敗回数が状態ファイルに積算される** — 失敗が「1 回きりの alert」で埋もれると
//          毎晩失敗し続けていることに誰も気づけない (2026-07-31 は 18 日間気づかれなかった)
//
// [BK2] / [BK3] / [BK5] は「gate を書いたが実は何も落とせていない」を防ぐ実効性検証。

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateBackupHealth } from '../../../src/lib/domain/backup-health';
import {
	backupFilename,
	loadJournalEntries,
	PGLITE_BACKUP_FILENAME_PATTERN,
	PGLITE_BACKUP_PREFIX,
	PgliteBackupVerificationError,
	sortBackupsNewestFirst,
	verifyPgliteDump,
} from '../../../src/lib/server/db/pglite/backup';
import {
	BACKUP_STATUS_FILENAME,
	getPgliteBackupStatus,
	PgliteBackupRotationGuardError,
	runPgliteBackup,
} from '../../../src/lib/server/services/pglite-backup-service';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'pglite');

/**
 * #3947 hotfix の際に本番 BACKUP_DIR へ手で採った暫定スナップショット (#3950 の一次証跡)。
 * `pglite-` prefix + `.tgz` を持つが日次バックアップの命名規則には従わない実在ファイル名。
 * 実名で固定しておくことで、緩い一致に戻した瞬間にテストが落ちる。
 */
const MANUAL_SNAPSHOT_FILENAME = 'pglite-snapshot-20260726-0738-pre-pr3947.tgz';

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

	it('[BK4] ローテーションは保持世代を超えた古い世代だけを消す (手動スナップショット同居下でも)', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk4-');

		// #3950 の一次証跡として本番 BACKUP_DIR に現存する手動スナップショットを実名で同居させる。
		// prefix / 拡張子は一致するが命名規則には従わないため、世代として数えてはならない
		// (数えると辞書順で常に「最新」に居座り、実保持が 3 → 2 世代に減る / QA #3956 指摘)。
		writeFileSync(join(backupDir, MANUAL_SNAPSHOT_FILENAME), 'manual-snapshot');

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
		// 手動スナップショットは世代に数えられず、かつローテーションで削除もされない。
		expect(remaining).not.toContain(MANUAL_SNAPSHOT_FILENAME);
		expect(readdirSync(backupDir)).toContain(MANUAL_SNAPSHOT_FILENAME);
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
		// 生成側も世代判定パターンに一致する (命名とパターンの片側だけ変える改変を落とす)。
		expect(PGLITE_BACKUP_FILENAME_PATTERN.test(newer)).toBe(true);
	});

	it('[BK8] 同 prefix でも命名規則に従わないファイルは世代として数えない', () => {
		const gen = [
			backupFilename(new Date(Date.UTC(2026, 6, 27, 3, 0, 0))),
			backupFilename(new Date(Date.UTC(2026, 6, 28, 3, 0, 0))),
			backupFilename(new Date(Date.UTC(2026, 6, 29, 3, 0, 0))),
		];
		// 命名規則から外れるが prefix + 拡張子は一致する実在ファイル群。
		const intruders = [
			MANUAL_SNAPSHOT_FILENAME, // 手動スナップショット (#3950 一次証跡、本番 BACKUP_DIR に現存)
			'pglite-20260730T030000Z.tgz.tmp', // 取得中に落ちた残骸
			'pglite-backup-notes.tgz',
			BACKUP_STATUS_FILENAME,
		];

		const sorted = sortBackupsNewestFirst([...intruders, ...gen]);

		// 3 世代がそのまま新しい順で返り、混入物は 1 件も含まれない。
		expect(sorted).toEqual([...gen].reverse());
		for (const intruder of intruders) expect(sorted).not.toContain(intruder);
		// 旧実装 (prefix + 拡張子の緩い一致) では手動スナップショットが辞書順で先頭に来ていた。
		expect(sorted[0]).toBe(gen[2]);
	});

	it('[BK9] Runbook の退避先 manual/ が同居してもローテーションは世代だけを削る', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk9-');

		// Runbook が指示する退避先。readdir はディレクトリ名も返すため、フィルタが緩いと
		// ローテーションの rm がディレクトリを掴んで EISDIR で落ちる (= 日次バックアップが毎日 fail)。
		mkdirSync(join(backupDir, 'manual'), { recursive: true });
		writeFileSync(join(backupDir, 'manual', MANUAL_SNAPSHOT_FILENAME), 'manual-snapshot');

		const filenames: string[] = [];
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

		expect(sortBackupsNewestFirst(readdirSync(backupDir))).toEqual(filenames.slice(1).reverse());
		// 退避先ディレクトリと中身が無傷で残る。
		expect(readdirSync(join(backupDir, 'manual'))).toEqual([MANUAL_SNAPSHOT_FILENAME]);
	}, 120_000);

	it('[BK10] retention 引き下げ後の初回ローテーションは abort し、1 世代も削除しない (#4129 AC2)', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk10-');

		// retention=7 運用で 7 世代を作る (#3950 引き下げ前の実運用と同じ形)。
		for (let i = 0; i < 7; i++) {
			await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 7,
				now: new Date(Date.UTC(2026, 6, 10 + i, 3, 0, 0)),
			});
		}
		const before = sortBackupsNewestFirst(readdirSync(backupDir));
		expect(before).toHaveLength(7);

		// retention を 3 に引き下げた初回実行。旧実装はここで 4 世代を一括削除していた。
		await expect(
			runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 3,
				now: new Date(Date.UTC(2026, 6, 17, 3, 0, 0)),
			}),
		).rejects.toBeInstanceOf(PgliteBackupRotationGuardError);

		// **1 世代も消えていないこと** が本テストの主眼 (削除は不可逆)。
		const after = sortBackupsNewestFirst(readdirSync(backupDir));
		expect(after).toEqual(expect.arrayContaining(before));
		expect(after.length).toBeGreaterThanOrEqual(before.length);
	}, 180_000);

	it('[BK17] guard 発火時も「取得は成功」を状態ファイルに残す (#4162 診断反転の防止)', async () => {
		// 旧実装は throw だけして catch が lastFailureAt / consecutiveFailures++ を書いていた。
		// **新世代は確定しているのに状態ファイルには失敗しか残らない**ため、判定層 (#4148) が
		// 「job が動いていない」= stale-critical に倒れ、診断が真逆になっていた。
		// 実際に必要な行動は「古い世代を退避して手で削除」であり job の再起動ではない。
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk17-');

		for (let i = 0; i < 7; i++) {
			await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 7,
				now: new Date(Date.UTC(2026, 6, 10 + i, 3, 0, 0)),
			});
		}

		await expect(
			runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 3,
				now: new Date(Date.UTC(2026, 6, 17, 3, 0, 0)),
			}),
		).rejects.toBeInstanceOf(PgliteBackupRotationGuardError);

		const status = await getPgliteBackupStatus(backupDir);
		// 取得は成功している = 鮮度判定が「動いていない」に倒れない。
		expect(status.lastSuccessAt).not.toBeNull();
		// guard の発火は失敗ではないので連続失敗を積まない。
		expect(status.consecutiveFailures).toBe(0);
		// ローテーションが止まっていることは**別の事実として**残る (逆の silent 化を作らない)。
		expect(status.rotationPendingCount).toBeGreaterThan(1);
		expect(status.rotationBlockedSince).not.toBeNull();
	}, 180_000);

	it('[BK18] 退避して溢れが 1 世代に戻れば保留が解除される (#4162)', async () => {
		// 解除を書き忘れると「片付けたのに warn が消えない」状態が固定され、
		// 表示が現実から乖離する。
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk18-');

		for (let i = 0; i < 7; i++) {
			await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 7,
				now: new Date(Date.UTC(2026, 6, 10 + i, 3, 0, 0)),
			});
		}
		await expect(
			runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 3,
				now: new Date(Date.UTC(2026, 6, 17, 3, 0, 0)),
			}),
		).rejects.toBeInstanceOf(PgliteBackupRotationGuardError);
		expect((await getPgliteBackupStatus(backupDir)).rotationPendingCount).toBeGreaterThan(1);

		// 運用者が古い世代を手で退避 (= 削除) した状況を作る。
		const generations = sortBackupsNewestFirst(readdirSync(backupDir));
		for (const stale of generations.slice(3)) {
			rmSync(join(backupDir, stale));
		}

		await runPgliteBackup({
			client,
			backupDir,
			migrationsDir: MIGRATIONS_DIR,
			retention: 3,
			now: new Date(Date.UTC(2026, 6, 18, 3, 0, 0)),
		});

		const status = await getPgliteBackupStatus(backupDir);
		expect(status.rotationPendingCount).toBe(0);
		expect(status.rotationBlockedSince).toBeNull();
	}, 180_000);

	it('[BK10] 定常運用 (1 世代だけ溢れる) は abort せず従来どおり削除する (#4129 AC2 false-positive 抑止)', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk10b-');

		// retention=3 のまま 5 回連続実行しても、毎回溢れるのは 1 世代だけ。
		for (let i = 0; i < 5; i++) {
			await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 3,
				now: new Date(Date.UTC(2026, 6, 10 + i, 3, 0, 0)),
			});
		}
		expect(sortBackupsNewestFirst(readdirSync(backupDir))).toHaveLength(3);
	}, 180_000);

	it('[BK11] 連続失敗回数が積算され、成功で 0 に戻る (#4129 AC4)', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk11-');

		const brokenMigrations = tempDir('gq-bk11-journal-');
		mkdirSync(join(brokenMigrations, 'meta'), { recursive: true });
		writeFileSync(
			join(brokenMigrations, 'meta', '_journal.json'),
			JSON.stringify({ entries: [{ idx: 0, when: 9_999_999_999_999, tag: '9999_unapplied' }] }),
		);

		const readStatus = () =>
			JSON.parse(readFileSync(join(backupDir, BACKUP_STATUS_FILENAME), 'utf-8')) as Record<
				string,
				unknown
			>;

		// 3 晩連続で失敗する状況 (2026-07-31 に実際に起きた形)。
		for (let i = 1; i <= 3; i++) {
			await expect(
				runPgliteBackup({ client, backupDir, migrationsDir: brokenMigrations, retention: 3 }),
			).rejects.toThrow();
			// 「1 回目の alert で埋もれる」を防ぐため、回数そのものを持つ。
			expect(readStatus().consecutiveFailures).toBe(i);
		}

		// 成功したらリセットされる (古い連続失敗が残り続けない)。
		await runPgliteBackup({
			client,
			backupDir,
			migrationsDir: MIGRATIONS_DIR,
			retention: 3,
		});
		expect(readStatus().consecutiveFailures).toBe(0);
	}, 180_000);

	// [BK12] **rotation guard (#4144) × backup health 判定層 (#4148) の合成** (#4162)
	//
	// 個別 PR ではどちらも正しいが、合成すると health が実態と真逆の診断を出す。
	// guard の throw は `rename` (新世代の確定) の **後** に起きるため:
	//   - 新世代はディスク上に確定している (guard 自身のコメントもそう明言している)
	//   - しかし throw は try 内で起きるので catch が `consecutiveFailures++` を書き、
	//     `lastSuccessAt` は進まない
	//   - `evaluateBackupHealth` は `lastSuccessAt` と `consecutiveFailures` しか見ないため、
	//     2 晩目で critical、50h で `stale-critical` (= 「job が動いていない」) と判定する
	// 実際には毎晩正常に取れており、世代は増え続けている。**診断が真逆**で、運用者は
	// 「退避して古い世代を手で削除する」ではなく「job を再起動する」方向へ誘導される。
	//
	// 既存テストはこの経路を通っていない: [BK10] は世代ファイル数しか見ず状態ファイルを読まない。
	// `backup-health.test.ts` は手書きリテラル入力のみ、`health-backup-status.test.ts` は
	// status を mock する。**実 status → verdict の経路をどのテストも通っていない。**
	//
	// 本テストは監査が **現在の挙動を固定する characterization test** として置いたもので、
	// 「#4162 で是正する際は期待値の更新が必要 (= 修正が必ず可視化される)」と設計されていた。
	// #4162 の是正に伴い、期待値を **正しい挙動** へ反転させている (assertion の弱体化ではなく
	// 反転。検証している経路の強度は落としていない — (4) で「戻っていないこと」も固定する)。
	it('[BK12] guard 発火中は「取得は成功 / ローテーションが保留」と診断する (#4162 是正済)', async () => {
		const client = await migratedClient();
		const backupDir = tempDir('gq-bk12-');

		const readStatus = () =>
			JSON.parse(readFileSync(join(backupDir, BACKUP_STATUS_FILENAME), 'utf-8')) as {
				lastSuccessAt: string | null;
				consecutiveFailures: number;
				rotationPendingCount?: number;
			};

		// retention=7 運用で 7 世代を作る (#3950 引き下げ前と同じ形)。
		for (let i = 0; i < 7; i++) {
			await runPgliteBackup({
				client,
				backupDir,
				migrationsDir: MIGRATIONS_DIR,
				retention: 7,
				now: new Date(Date.UTC(2026, 6, 10 + i, 3, 0, 0)),
			});
		}
		const successAtBeforeGuard = readStatus().lastSuccessAt;
		expect(successAtBeforeGuard).not.toBeNull();
		const generationsBefore = sortBackupsNewestFirst(readdirSync(backupDir)).length;

		// retention 引き下げ後、2 晩連続で guard が発火する。
		// **溢れは減らない** (毎晩 1 世代増えるため) = guard は自己解除しない。
		for (let night = 1; night <= 2; night++) {
			await expect(
				runPgliteBackup({
					client,
					backupDir,
					migrationsDir: MIGRATIONS_DIR,
					retention: 3,
					now: new Date(Date.UTC(2026, 6, 17 + night, 3, 0, 0)),
				}),
			).rejects.toBeInstanceOf(PgliteBackupRotationGuardError);
		}

		// (1) 新世代は毎晩ディスク上に確定している (guard の約束どおり失われていない)。
		const generationsAfter = sortBackupsNewestFirst(readdirSync(backupDir)).length;
		expect(generationsAfter).toBe(generationsBefore + 2);

		// (2) 状態ファイルは取得の成功を記録し、成功時刻が進んでいる。
		//     guard の発火は失敗ではないので連続失敗を積まない。
		const status = readStatus();
		expect(status.consecutiveFailures).toBe(0);
		expect(status.lastSuccessAt).not.toBe(successAtBeforeGuard);
		// ローテーションが止まっていることは**別の事実として**残る (逆の silent 化を作らない)。
		expect(status.rotationPendingCount).toBeGreaterThan(1);

		// (3) 判定層は「動いていない」ではなく「片付いていない」と読む。
		//     必要な行動 (古い世代を退避して手で削除) と診断が一致する。
		const verdict = evaluateBackupHealth(
			{
				lastSuccessAt: status.lastSuccessAt,
				consecutiveFailures: status.consecutiveFailures,
				lastFailureMessage: null,
				notificationConfigured: true,
				rotationPendingCount: status.rotationPendingCount ?? 0,
			},
			new Date(Date.UTC(2026, 6, 19, 3, 5, 0)),
		);
		expect(verdict.level).toBe('warn');
		expect(verdict.reason).toBe('rotation-blocked');

		// (4) **本 Issue の核心**: 直近の世代が実在するのに「job が動いていない」と
		//     読まれる状態に戻っていないこと。stale / 連続失敗のいずれにも倒れない。
		expect(verdict.reason).not.toBe('stale-critical');
		expect(verdict.reason).not.toBe('consecutive-failures-critical');
	}, 180_000);
});
