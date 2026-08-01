// #3970 AC2 — off-site 検査が **service 層に実際に配線されている**ことを固定する。
//
// ## なぜ純粋関数の test だけでは足りないか
//
// 判定 (`judgeOffsiteReplication`) の test は `tests/unit/domain/backup-offsite.test.ts` にあるが、
// **judge を呼ばなくしても / expected を false に固定しても、それらは 1 件も落ちない**。
// 機構が丸ごと死んでいても CI が緑になる形は、#3950 の「毎晩成功していたが実データは無保護」と
// 同型であり、ADR-0061 の fitness function 原則に直接該当する (QM 指摘 PR #4159)。
//
// 本 test は「env が立っているとき、目印の有無が result に伝わるか」を実 FS で検証する。
// 経路のどこか 1 箇所でも切れれば落ちる。

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFSITE_MARKER_FILENAME } from '$lib/domain/backup-offsite';

// getEnv() を差し替えて BACKUP_OFFSITE_EXPECTED を制御する。
// process.env 直接参照は ADR-0040 P1 で禁止されているため、env module 経由で注入する。
const envMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('$lib/runtime/env', () => ({ getEnv: () => envMock.value }));

const { runPgliteBackup } = await import('$lib/server/services/pglite-backup-service');

let backupDir: string;
let client: PGlite;

/** journal と突合できる最小構成の migrations dir を作る。 */
async function makeMigrationsDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'gq-mig-'));
	const meta = join(dir, 'meta');
	await import('node:fs/promises').then((m) => m.mkdir(meta, { recursive: true }));
	// when を 0 にして「適用済み最大 created_at 以下」を常に満たす (V3 の突合を通す)。
	await writeFile(
		join(meta, '_journal.json'),
		JSON.stringify({ entries: [{ idx: 0, when: 0, tag: 'x' }] }),
	);
	return dir;
}

let migrationsDir: string;

beforeEach(async () => {
	backupDir = await mkdtemp(join(tmpdir(), 'gq-backup-'));
	migrationsDir = await makeMigrationsDir();
	client = new PGlite();
	await client.waitReady;
	// 復元検証 V1/V2 を通すための最小 schema。
	await client.exec('create table t (id int); insert into t values (1);');
	await client.exec('create schema if not exists drizzle;');
	await client.exec(
		'create table if not exists drizzle.__drizzle_migrations (id serial, hash text, created_at bigint);',
	);
	await client.exec("insert into drizzle.__drizzle_migrations (hash, created_at) values ('h', 1);");
	envMock.value = {};
});

afterEach(async () => {
	await client.close();
	await rm(backupDir, { recursive: true, force: true });
	await rm(migrationsDir, { recursive: true, force: true });
});

const run = () => runPgliteBackup({ client, backupDir, migrationsDir, retention: 3 });

// 1 回の run が実 PGlite の dumpDataDir + 別インスタンスへの復元検証を伴うため 10 秒前後かかる。
// 複数回 run する test は既定 5 秒を超えるので、明示 timeout を置く (固定待ちではない)。
const MULTI_RUN_TIMEOUT_MS = 60_000;

describe('#3970 AC2 off-site 検査の service 配線', () => {
	it('[OW1] BACKUP_OFFSITE_EXPECTED 未設定なら検査しない (警告を常態化させない)', async () => {
		const result = await run();
		expect(result.offsite).toEqual({ level: 'not-expected' });
		expect(result.offsiteMessage).toBeNull();
	});

	it('[OW2] expected + 目印なし → critical が result に載る', async () => {
		// **これが本丸**: マウントが外れて Docker が空ディレクトリを作った状態。
		// 取得は成功しているので result 自体は返るが、off-site は critical になる。
		envMock.value = { BACKUP_OFFSITE_EXPECTED: 'true' };
		const result = await run();
		expect(result.offsite).toEqual({ level: 'critical', reason: 'marker-missing' });
		expect(result.offsiteMessage).not.toBeNull();
		// 取得自体は成功していること (off-site 異常を取得失敗にすり替えていない)。
		expect(result.filename).toMatch(/^pglite-\d{8}T\d{6}Z\.tgz$/);
	});

	it('[OW3] expected + 目印あり → ok になり通知文言が出ない', async () => {
		envMock.value = { BACKUP_OFFSITE_EXPECTED: 'true' };
		await writeFile(join(backupDir, OFFSITE_MARKER_FILENAME), 'NAS 1F');
		const result = await run();
		expect(result.offsite).toEqual({ level: 'ok' });
		expect(result.offsiteMessage).toBeNull();
	});

	it('[OW4] 空文字の BACKUP_OFFSITE_EXPECTED は「期待していない」扱い', async () => {
		// compose の `${HOST_BACKUP_DIR:+true}` は未設定時に **空文字**へ展開される。
		// 'true' の厳密比較でなければ空文字が truthy 判定されて全家庭に誤報が出る。
		envMock.value = { BACKUP_OFFSITE_EXPECTED: '' };
		const result = await run();
		expect(result.offsite).toEqual({ level: 'not-expected' });
	});

	it(
		'[OW5] 同じ critical が続く 2 回目は通知文言を載せない (毎晩の再送を止める)',
		async () => {
			// 同じ警告が毎晩届くと数日で無視され、同じ通知先を共有している本物の失敗 alert
			// (#4129 / #4087) まで一緒に見られなくなる。
			envMock.value = { BACKUP_OFFSITE_EXPECTED: 'true' };
			const first = await run();
			expect(first.offsiteMessage).not.toBeNull();

			const second = await run();
			// 判定自体は critical のまま (状態を隠さない)。載せないのは通知文言だけ。
			expect(second.offsite).toEqual({ level: 'critical', reason: 'marker-missing' });
			expect(second.offsiteMessage).toBeNull();
		},
		MULTI_RUN_TIMEOUT_MS,
	);

	it(
		'[OW6] critical → ok → critical と戻ったら再通知する',
		async () => {
			envMock.value = { BACKUP_OFFSITE_EXPECTED: 'true' };
			await run(); // critical (通知あり)

			await writeFile(join(backupDir, OFFSITE_MARKER_FILENAME), 'NAS 1F');
			const recovered = await run();
			expect(recovered.offsite).toEqual({ level: 'ok' });

			await rm(join(backupDir, OFFSITE_MARKER_FILENAME));
			const again = await run();
			expect(again.offsiteMessage).not.toBeNull();
		},
		MULTI_RUN_TIMEOUT_MS,
	);
});
