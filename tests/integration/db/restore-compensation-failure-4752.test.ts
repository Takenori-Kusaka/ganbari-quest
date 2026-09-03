// tests/integration/db/restore-compensation-failure-4752.test.ts
// #4752 PO 回答 (2026-09-03): 置換インポート (バックアップ復元) を pg 系 backend で補償トランザクション
// として実装した #4752 は、顧客に見える 2 条件が **実測** (pg 系 backend で途中失敗を実際に起こす) で
// 成り立つときだけ承認する:
//   1. 失敗したとき、旧データが実際に残る (残らない場合に「保全されています」と言わない)
//   2. 補償 (自動復元) に失敗して中途半端になった場合、その旨と復旧手段が顧客に出る
//
// 本 test は #3531 の PGlite 基盤 (実 migration + factory + service + route 貫通) で、
//   [C1] import の後半 (ごほうび insert) で **本物の pg 制約違反** (int4 overflow) を起こす
//        → 旧データが件数・内容とも残り、API 応答と、client (settings/data page) が実際に画面へ出す
//          文言 (`resolveApiErrorMessage`) が「既存データは保全されています」を含む
//   [C2] さらに補償 (snapshot からの復元) の途中で失敗を注入し半端な状態を作る
//        → DB は実際に半端 (子供は戻ったがごほうびは無い) であり、API 応答は「保全されています」と
//          言わず、半端である旨 + 復旧手段 (設定 > サポートから運営連絡 + 復旧コード) を顧客に出す。
//          復旧用 ZIP が storage に残り、中身に旧データが入っている (復旧手段が実在する)
//   [C3] 置換前 snapshot を保存できない → 置換を開始せず旧データ無傷、顧客には「保全」を含まない
//        汎用文言 (再試行) が出る
//   [C4] 3 文言が client の echo hardening (sanitizeServerMessage) を素通りする (文言が届く契約)
//
// 「文言が実態と一致する」を client が実際に表示する関数まで含めて固定する: 500 で返すと
// resolveApiErrorMessage が body を捨てるため、server の文言がどれだけ正しくても顧客には届かない。

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_CODE_TO_ID } from '../../../src/lib/domain/categories';
import type { ExportData } from '../../../src/lib/domain/export-format';
import { asCategoryId } from '../../../src/lib/domain/ids';
import { ERROR_NOTIFY_LABELS, IMPORT_LABELS } from '../../../src/lib/domain/labels';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// 二次故障時の運営向け alert。実 webhook を叩かず呼び出し内容だけ検証する。
vi.mock('$lib/server/discord-alert', () => ({
	sendDiscordAlert: vi.fn(async () => {}),
}));

// route の認可ヘルパは実体 (guards.requireRole) を使う。auth/factory 全体を読み込むと
// cognito provider 群の module 副作用を持ち込むため、必要な 1 関数だけ実体に委譲する。
vi.mock('$lib/server/auth/factory', async () => {
	const guards = await import('../../../src/lib/server/auth/guards');
	return { requireRole: guards.requireRole };
});

// error-notify (client 側の表示文言決定) を読むために Toast primitive (.svelte) だけ差し替える。
vi.mock('$lib/ui/primitives/Toast.svelte', () => ({ showToast: vi.fn() }));

// storage は S3 実装 (factory の pg 分岐) のため in-memory に差し替える (#4720 の integration test と同型)。
const storageFiles = new Map<string, { data: Buffer; contentType: string }>();
const storageFailOn = { save: false };
vi.mock('$lib/server/storage', () => ({
	saveFile: vi.fn(async (key: string, data: Buffer, contentType: string) => {
		if (storageFailOn.save) throw new Error('storage 障害注入');
		storageFiles.set(key, { data, contentType });
	}),
	readFile: vi.fn(async (key: string) => storageFiles.get(key) ?? null),
	deleteFile: vi.fn(async (key: string) => {
		storageFiles.delete(key);
	}),
	listFiles: vi.fn(async (prefix: string) =>
		[...storageFiles.keys()].filter((k) => k.startsWith(prefix)),
	),
	deleteByPrefix: vi.fn(async (prefix: string) => {
		let n = 0;
		for (const k of [...storageFiles.keys()]) {
			if (k.startsWith(prefix)) {
				storageFiles.delete(k);
				n++;
			}
		}
		return n;
	}),
	fileExists: vi.fn(async (key: string) => storageFiles.has(key)),
}));

const TENANT = '00000000-0000-4000-8000-00000000a752';
const OLD_CHILD = '旧データ子';
const OLD_REWARD = '旧ごほうび';
const NEW_CHILD = '新データ子';
const NEW_REWARD = '新ごほうび';
/** pg の integer (int4) 上限 + 1。special_rewards.points は integer 列なので INSERT が実 DB 側で失敗する。 */
const INT4_OVERFLOW = 2_147_483_648;
const originalDataSource = process.env.DATA_SOURCE;
const originalDataDir = process.env.PGLITE_DATA_DIR;

type PgliteConn = typeof import('../../../src/lib/server/db/pglite/connection');
let pgliteConn: PgliteConn;
let repos: ReturnType<typeof import('../../../src/lib/server/db/factory').getRepos>;
let dataService: typeof import('../../../src/lib/server/services/data-service');
let exportService: typeof import('../../../src/lib/server/services/export-service');
let backupArchive: typeof import('../../../src/lib/server/services/backup-archive');
let replaceImport: typeof import('../../../src/lib/server/services/replace-import-service');
let errorNotify: typeof import('../../../src/lib/ui/error-notify');
let discordAlert: typeof import('../../../src/lib/server/discord-alert');
let loggerMod: typeof import('../../../src/lib/server/logger');
let importRoute: typeof import('../../../src/routes/api/v1/import/+server');

/** 旧データ: 子供 1 人 + 活動 1 件 + 記録 1 件 + ごほうび 1 件 (points=30)。 */
async function seedOldFamily(): Promise<void> {
	const child = await repos.child.insertChild({ nickname: OLD_CHILD, age: 8 }, TENANT);
	const act = await repos.childActivity.insertActivity(
		{
			childId: child.id,
			name: 'はみがき',
			categoryId: asCategoryId(CATEGORY_CODE_TO_ID.seikatsu),
			icon: '🦷',
			basePoints: 10,
		},
		TENANT,
	);
	await repos.activity.insertActivityLog(
		{
			childId: child.id,
			activityId: act.id,
			points: 10,
			streakDays: 1,
			streakBonus: 0,
			recordedDate: '2026-08-01',
			recordedAt: '2026-08-01T10:00:00.000Z',
		},
		TENANT,
	);
	await repos.specialReward.insertSpecialReward(
		{ childId: child.id, title: OLD_REWARD, points: 30, category: 'privilege' },
		TENANT,
	);
}

/**
 * 顧客が復元しようとするバックアップ (新データ)。旧データの export を雛形に、子供とごほうびを
 * 別名にし、ごほうびの points を int4 上限超にする = import の後半 (ごほうび insert) で
 * **実 DB の制約** に当たって失敗する。checksum は export-service の finalizeExport で正しく付け直す
 * (route の checksum 検証を素通りさせない)。
 */
async function buildFailingBackup(): Promise<ExportData> {
	const { exportData } = await exportService.exportFamilyDataForZip({ tenantId: TENANT });
	const { checksum: _drop, ...body } = structuredClone(exportData);
	for (const c of body.family.children) if (c.nickname === OLD_CHILD) c.nickname = NEW_CHILD;
	expect(body.data.specialRewards).toHaveLength(1);
	for (const r of body.data.specialRewards) {
		r.title = NEW_REWARD;
		r.points = INT4_OVERFLOW;
	}
	return (await exportService.finalizeExport(body)).exportData;
}

async function countRows(table: string): Promise<number> {
	const db = await pgliteConn.getPgliteDb();
	const r = await db.execute(
		sql`SELECT count(*)::int AS c FROM ${sql.raw(table)} WHERE family_id = ${TENANT}`,
	);
	return Number((r.rows[0] as { c: number }).c);
}

async function rewardRows(): Promise<Array<{ title: string; points: number }>> {
	const db = await pgliteConn.getPgliteDb();
	const r = await db.execute(
		sql`SELECT title, points FROM special_rewards WHERE family_id = ${TENANT} ORDER BY title`,
	);
	return (r.rows as Array<{ title: string; points: number }>).map((x) => ({
		title: x.title,
		points: Number(x.points),
	}));
}

/** 顧客の操作そのもの: settings/data 画面が叩く `POST /api/v1/import?mode=replace` (JSON body)。 */
async function postReplace(backup: ExportData): Promise<{ status: number; body: ApiErrorBody }> {
	const url = new URL('http://localhost/api/v1/import?mode=replace');
	const request = new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(backup),
	});
	const res = (await importRoute.POST({
		request,
		url,
		locals: { context: { tenantId: TENANT, role: 'owner' } },
	} as never)) as Response;
	return { status: res.status, body: (await res.json()) as ApiErrorBody };
}

type ApiErrorBody = {
	ok?: boolean;
	error?: { code: string; message: string; userMessage: string; severity: string; action: string };
};

function recoveryKeys(): string[] {
	return [...storageFiles.keys()].filter((k) => k.includes('/recovery/'));
}

beforeAll(async () => {
	vi.resetModules();
	process.env.DATA_SOURCE = 'pglite';
	delete process.env.PGLITE_DATA_DIR;
	pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
	await pgliteConn.resetPgliteConnectionForTesting();
	await pgliteConn.initPgliteConnection();
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	repos = getRepos();
	dataService = await import('../../../src/lib/server/services/data-service');
	exportService = await import('../../../src/lib/server/services/export-service');
	backupArchive = await import('../../../src/lib/server/services/backup-archive');
	replaceImport = await import('../../../src/lib/server/services/replace-import-service');
	errorNotify = await import('../../../src/lib/ui/error-notify');
	discordAlert = await import('../../../src/lib/server/discord-alert');
	loggerMod = await import('../../../src/lib/server/logger');
	importRoute = await import('../../../src/routes/api/v1/import/+server');
}, 120_000);

afterAll(async () => {
	await pgliteConn?.resetPgliteConnectionForTesting();
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	if (originalDataDir === undefined) delete process.env.PGLITE_DATA_DIR;
	else process.env.PGLITE_DATA_DIR = originalDataDir;
});

beforeEach(async () => {
	storageFiles.clear();
	storageFailOn.save = false;
	vi.clearAllMocks();
	await dataService.clearAllFamilyData(TENANT);
	await seedOldFamily();
	expect(await countRows('children')).toBe(1);
	expect(await rewardRows()).toEqual([{ title: OLD_REWARD, points: 30 }]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('#4752 PO 条件の実測 (PGlite 実 migration、pg 系 backend で途中失敗を起こす)', () => {
	it('[C1] 条件 1: import 後半で実 DB 制約違反 → 旧データが実際に残り、顧客に「既存データは保全されています」が届く', async () => {
		const backup = await buildFailingBackup();
		// 途中まで進んだことの証跡: clear 後に新データの子供が実際に insert されてから失敗する
		const childInsert = vi.spyOn(repos.child, 'insertChild');

		const { status, body } = await postReplace(backup);

		// --- 途中失敗が本当に起きた (mid-failure の実測) ---
		const insertedNicknames = childInsert.mock.calls.map((c) => c[0].nickname);
		expect(insertedNicknames, '新データの子供が insert されるまで進んでから失敗している').toContain(
			NEW_CHILD,
		);
		expect(
			insertedNicknames,
			'補償 (snapshot からの復元) が旧データの子供を insert し直している',
		).toContain(OLD_CHILD);
		const errorLogs = vi
			.mocked(loggerMod.logger.error)
			.mock.calls.map((c) => JSON.stringify(c))
			.join('\n');
		// 失敗は mock された分岐ではなく、実 DB (PGlite) が int4 範囲外の値を拒否した結果である
		expect(errorLogs, '実 DB の special_rewards INSERT が失敗している').toMatch(
			/INSERT INTO special_rewards/,
		);
		expect(errorLogs, `拒否された値は int4 上限超 (${INT4_OVERFLOW})`).toContain(
			String(INT4_OVERFLOW),
		);
		expect(errorLogs).toContain(`ごほうび「${NEW_REWARD}」のインポートに失敗`);

		// --- 条件 1: 旧データが実際に残っている (件数・内容とも) ---
		expect(await countRows('children')).toBe(1);
		expect(await countRows('child_activities')).toBe(1);
		expect(await countRows('activity_logs')).toBe(1);
		expect(await rewardRows()).toEqual([{ title: OLD_REWARD, points: 30 }]);
		const children = await repos.child.findAllChildren(TENANT);
		expect(children.map((c) => c.nickname)).toEqual([OLD_CHILD]);
		// 復旧用 ZIP は復元成功後に削除される (storage に残らない)
		expect(recoveryKeys()).toEqual([]);

		// --- 条件 1 (文言): API 応答が保全を述べ、client が実際に画面へ出す文言にも保全が残る ---
		expect(status).toBe(400);
		expect(body.error?.code).toBe('VALIDATION_ERROR');
		expect(body.error?.message).toBe(IMPORT_LABELS.errorReplaceAbortedPreserved);
		expect(body.error?.message).toContain('既存データは保全されています');
		// settings/data page は `resolveApiErrorMessage(res.status, d.error.message)` を表示する。
		// 旧実装 (生の例外文字列を連結) では sanitize が例外クラス名を検出して汎用文言に落ち、
		// 「保全されています」が顧客に届かなかった。
		const shown = errorNotify.resolveApiErrorMessage(status, body.error?.message ?? '');
		expect(shown).toBe(IMPORT_LABELS.errorReplaceAbortedPreserved);
		expect(shown).toContain('既存データは保全されています');
	}, 60_000);

	it('[C2] 条件 2: 補償 (自動復元) の途中でも失敗 → DB は実際に半端で、顧客に「保全」と言わず半端な旨 + 復旧手段 (運営連絡 + 復旧コード) が届く', async () => {
		const backup = await buildFailingBackup();
		// 補償の途中失敗を注入: 復元フェーズで旧ごほうびを insert し直すところで storage 障害相当の例外。
		// import フェーズの新ごほうび (int4 overflow) は実 DB 制約でそのまま失敗させる (call-through)。
		const realInsert = repos.specialReward.insertSpecialReward.bind(repos.specialReward);
		vi.spyOn(repos.specialReward, 'insertSpecialReward').mockImplementation(
			async (input, tenantId) => {
				if (input.title === OLD_REWARD) throw new Error('compensation 途中の障害注入');
				return realInsert(input, tenantId);
			},
		);

		const { status, body } = await postReplace(backup);

		// --- DB は実際に半端 (子供・活動・記録は戻ったが、ごほうびは無い) ---
		expect(await countRows('children')).toBe(1);
		expect((await repos.child.findAllChildren(TENANT)).map((c) => c.nickname)).toEqual([OLD_CHILD]);
		expect(await countRows('activity_logs')).toBe(1);
		expect(await rewardRows(), '旧ごほうびが戻っていない = 半端な状態').toEqual([]);

		// --- 復旧手段が実在する: 復旧用 ZIP が storage に残り、中身に旧データが入っている ---
		const keys = recoveryKeys();
		expect(keys).toHaveLength(1);
		const zip = storageFiles.get(keys[0] as string);
		expect(zip?.contentType).toBe('application/zip');
		const parsed = await backupArchive.parseBackupZip(new Uint8Array(zip?.data ?? Buffer.alloc(0)));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const snapshot = parsed.value.body as ExportData;
		expect(snapshot.family.children.map((c) => c.nickname)).toEqual([OLD_CHILD]);
		expect(snapshot.data.specialRewards.map((r) => [r.title, r.points])).toEqual([
			[OLD_REWARD, 30],
		]);

		// --- 条件 2 (文言): 「保全されています」と言わず、半端な旨 + 復旧手段 + 復旧コードを顧客に出す ---
		const recoveryCode = replaceImport.recoveryCodeFromKey(keys[0] as string);
		expect(keys[0]).toContain(`replace-import-${recoveryCode}.zip`);
		expect(status, '500 だと client が body を捨てて文言が届かない').toBe(409);
		expect(body.error?.code).toBe('IMPORT_RESTORE_FAILED');
		expect(body.error?.severity).toBe('error');
		expect(body.error?.action, '次の行動 = 運営に連絡').toBe('contact_admin');
		expect(body.error?.message).toBe(IMPORT_LABELS.errorReplaceRestoreFailedWithCode(recoveryCode));
		expect(body.error?.message).not.toContain('保全されています');
		expect(body.error?.message).toContain('自動復元も途中で止まりました');
		expect(body.error?.message).toContain('不完全な状態');
		expect(body.error?.message).toContain('設定 > サポートから運営にご連絡ください');
		expect(body.error?.message).toContain(`復旧コード: ${recoveryCode}`);
		expect(body.error?.userMessage).toBe(IMPORT_LABELS.errorReplaceRestoreFailed);
		// client (settings/data page) が実際に表示する文言 = server の文言そのまま (sanitize を素通り)
		const shown = errorNotify.resolveApiErrorMessage(status, body.error?.message ?? '');
		expect(shown).toBe(body.error?.message);
		expect(shown).not.toBe(ERROR_NOTIFY_LABELS.conflict);
		expect(shown).not.toBe(ERROR_NOTIFY_LABELS.server);

		// --- 運営側: 原因付き log + Discord alert (復旧 key を運営に渡す) ---
		const alert = vi.mocked(discordAlert.sendDiscordAlert);
		expect(alert).toHaveBeenCalledTimes(1);
		const alertArg = alert.mock.calls[0]?.[0];
		expect(alertArg?.level).toBe('critical');
		expect(alertArg?.details).toContain(`recoveryKey=${keys[0]}`);
		expect(alertArg?.details).toContain('compensation 途中の障害注入');
		const routeLog = vi
			.mocked(loggerMod.logger.error)
			.mock.calls.find((c) => String(c[0]).includes('自動復元も失敗'));
		expect(routeLog, 'route が原因 (cause) と復旧コード付きで log する').toBeDefined();
		const ctx = (routeLog?.[1] as { context?: Record<string, unknown> } | undefined)?.context;
		expect(ctx?.recoveryCode).toBe(recoveryCode);
		expect(ctx?.recoveryKey).toBe(keys[0]);
		expect(String(ctx?.cause), '二次故障の cause = 復元を止めた例外').toContain(
			'compensation 途中の障害注入',
		);
		expect(String(ctx?.originalError), '元の取込失敗も原因の連鎖として残る').toContain(
			'AtomicReplaceError',
		);
	}, 60_000);

	it('[C3] 置換前 snapshot を保存できない → 置換を開始せず旧データ無傷、顧客に「保全」を含まない再試行文言が出る', async () => {
		const backup = await buildFailingBackup();
		storageFailOn.save = true;
		const childInsert = vi.spyOn(repos.child, 'insertChild');

		const { status, body } = await postReplace(backup);

		expect(childInsert, '置換 (clear + import) を開始していない').not.toHaveBeenCalled();
		expect(await countRows('children')).toBe(1);
		expect(await rewardRows()).toEqual([{ title: OLD_REWARD, points: 30 }]);
		expect(status).toBe(500);
		expect(body.error?.code).toBe('INTERNAL_ERROR');
		expect(body.error?.message).toBe(IMPORT_LABELS.errorReplaceSnapshotFailed);
		expect(body.error?.message).not.toContain('保全されています');
		// client は 500 の body を捨てて汎用文言 (再試行) を出す = 旧データ無傷なので再試行が正しい次の行動
		expect(errorNotify.resolveApiErrorMessage(status, body.error?.message ?? '')).toBe(
			ERROR_NOTIFY_LABELS.server,
		);
	}, 60_000);

	it('[C4] 3 文言は client の echo hardening (sanitizeServerMessage) を素通りする (文言が顧客に届く契約)', () => {
		const sampleCode = replaceImport.recoveryCodeFromKey(
			`tenants/${TENANT}/recovery/replace-import-2026-09-03T01-23-45-678Z.zip`,
		);
		expect(sampleCode).toBe('2026-09-03T01-23-45-678Z');
		for (const label of [
			IMPORT_LABELS.errorReplaceAbortedPreserved,
			IMPORT_LABELS.errorReplaceSnapshotFailed,
			IMPORT_LABELS.errorReplaceRestoreFailed,
			IMPORT_LABELS.errorReplaceRestoreFailedWithCode(sampleCode),
		]) {
			expect(errorNotify.sanitizeServerMessage(label)).toBe(label);
			expect(label.length).toBeLessThanOrEqual(errorNotify.MAX_SERVER_MESSAGE_LENGTH);
		}
	});
});
