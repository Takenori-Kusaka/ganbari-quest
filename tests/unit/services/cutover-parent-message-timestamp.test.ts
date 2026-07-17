// tests/unit/services/cutover-parent-message-timestamp.test.ts
// #3851 — NUC cutover (旧 sqlite → PGlite) で、SQLite `CURRENT_TIMESTAMP` 既定値由来の
// スペース区切り日時 (`YYYY-MM-DD HH:MM:SS`) を持つ親メッセージが verbatim import で
// silent drop され、件数突合 (parentMessages export=1 imported=0) で cutover が abort する
// 回帰を固定する。
//
// 真因: `validateParentMessageRow` の `isValidIsoDateTime` が 'T' 区切り必須の regex
// (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/`) で、通常送信経路 (sendCheer) が使う SQLite
// `CURRENT_TIMESTAMP` 既定値 (スペース区切り) を「不正」と誤判定していた。#3284 の
// point_ledger dedup は無関係 (dedup 後も件数は export=import で一致する) — 実 CI 失敗軸は
// parentMessages。
//
// 構成は pglite-cutover-roundtrip.test.ts と同型 (1 it 内で 2 phase 直列):
//   Phase A: DATA_SOURCE=sqlite + test-db → child seed + 親メッセージ (既定 sent_at) → export
//   Phase B: DATA_SOURCE=pglite → verbatim import → nuc-cutover-verify で件数突合
// 併せて「握り潰し過剰でない」= 真の欠落 (validator が正当に reject する破損値) は依然
// count-verify が検知する、というネガティブ不変条件も同 it 内で確認する (ADR-0061)。

import { afterAll, describe, expect, it, vi } from 'vitest';

let testDb: unknown;
let testSqlite: import('better-sqlite3').Database | null = null;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = '00000000-0000-4000-8000-00000000cc51';
const originalDataSource = process.env.DATA_SOURCE;

afterAll(async () => {
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	testSqlite?.close();
});

describe('NUC cutover — legacy SQL-datetime 親メッセージ timestamp (#3851)', () => {
	it('スペース区切り sent_at (valid) は import・破損 sent_at は reject し、件数突合が data-loss を隠さない', async () => {
		// ═══ Phase A: 旧 sqlite backend で seed → export ═══
		process.env.DATA_SOURCE = 'sqlite';
		const { createTestDb } = await import('../helpers/test-db');
		const t = createTestDb();
		testDb = t.db;
		testSqlite = t.sqlite;

		const { getRepos } = await import('../../../src/lib/server/db/factory');
		const repos = getRepos();

		const taro = await repos.child.insertChild(
			{ nickname: '移行太郎', age: 8, birthDate: '2018-02-10' },
			TENANT,
		);

		// (1) 通常の送信経路 (insertMessage / sendCheer) は sent_at を指定せず、SQLite の
		//     `CURRENT_TIMESTAMP` 既定値 (= 'YYYY-MM-DD HH:MM:SS'、スペース区切り) が入る。
		//     実 legacy NUC DB の親メッセージはこの形式で保存されている (= 修正前は誤 reject)。
		t.sqlite
			.prepare(
				`INSERT INTO parent_messages (child_id, message_type, body, icon) VALUES (?, 'text', 'よくがんばったね', '💌')`,
			)
			.run(Number(taro.id));

		const stored = t.sqlite.prepare('SELECT sent_at FROM parent_messages').get() as {
			sent_at: string;
		};
		// legacy 格納形式 = スペース区切り (回帰の前提を固定)
		expect(stored.sent_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

		// (2) 破損した sent_at を持つ行も 1 件混ぜる。validator が正当に reject すべき値であり、
		//     修正 (区切り緩和) 後も依然 skip されること = 握り潰し過剰でないことを担保する。
		t.sqlite
			.prepare(
				`INSERT INTO parent_messages (child_id, message_type, body, icon, sent_at) VALUES (?, 'text', 'こわれた日時', '💌', 'not-a-valid-date')`,
			)
			.run(Number(taro.id));

		const { exportFamilyData } = await import('../../../src/lib/server/services/export-service');
		const exportData = await exportFamilyData({ tenantId: TENANT });

		// export は verbatim: 2 件とも JSON に載る (1 件 valid スペース区切り + 1 件破損)
		expect(exportData.data.parentMessages).toHaveLength(2);
		expect(exportData.data.parentMessages.some((m) => /^\d{4}-\d{2}-\d{2} /.test(m.sentAt))).toBe(
			true,
		);

		// ═══ Phase B: PGlite backend へ verbatim import → 件数突合 ═══
		vi.resetModules();
		process.env.DATA_SOURCE = 'pglite';
		delete process.env.PGLITE_DATA_DIR; // in-memory

		const pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
		const verify = await import('../../../scripts/lib/runtime/nuc-cutover-verify');
		const { importFamilyData } = await import('../../../src/lib/server/services/import-service');

		await pgliteConn.resetPgliteConnectionForTesting();
		await pgliteConn.initPgliteConnection();

		try {
			const result = await importFamilyData(exportData, TENANT, undefined, { mode: 'verbatim' });
			// 破損行の skip は warnings に可視化される。hard error (insert 失敗) は無いこと。
			expect(result.errors, `import errors: ${JSON.stringify(result.errors)}`).toEqual([]);

			const actual = await verify.collectImportedCounts(pgliteConn.getPgliteDbSync(), TENANT);

			// positive: スペース区切り legacy 日時の行は drop されず import される (修正前は 0 件)。
			// negative: 破損 sent_at の行は依然 reject され import されない (握り潰し過剰でない)。
			// → tenant の parent_messages 実件数はちょうど 1。
			expect(actual.parentMessages).toBe(1);
			expect(result.parentMessagesImported).toBe(1);
			expect(result.parentMessagesSkipped).toBe(1);

			// count-verify は「export emit 件数 (=2) vs import insert 件数 (=1)」の差を依然検知する。
			// = 正当な行数変化を許容しつつ、真の data-loss (破損行の欠落) を隠さない不変条件。
			const expected = verify.summarizeExportCounts(exportData); // parentMessages = 2
			const mismatches = verify.diffCutoverCounts(expected, actual);
			expect(mismatches.some((m) => m.startsWith('parentMessages'))).toBe(true);

			// 一方、破損行を含まない (valid のみの) export では突合が完全一致する = 誤検知しない。
			const cleanExport = structuredClone(exportData);
			cleanExport.data.parentMessages = cleanExport.data.parentMessages.filter((m) =>
				/^\d{4}-\d{2}-\d{2}[T ]/.test(m.sentAt),
			);
			// clean 側で破損行を除いた期待値は import 実測 (1 件) と完全一致する
			const cleanExpected = verify.summarizeExportCounts(cleanExport);
			expect(verify.diffCutoverCounts(cleanExpected, actual)).toEqual([]);
		} finally {
			await pgliteConn.resetPgliteConnectionForTesting();
		}
	}, 120_000);
});
