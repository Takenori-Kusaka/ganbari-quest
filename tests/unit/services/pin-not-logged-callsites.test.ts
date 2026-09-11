// tests/unit/services/pin-not-logged-callsites.test.ts
//
// **PIN を外へ出しうる経路を、実際に走らせて**「出ない」ことを固定する (#4867)。
//
// なぜ別 file か: `cloud-export-pin-not-logged.test.ts` は `storage.purgeByPrefix` を mock
// するため、**repo 層と退会経路には 1 度も到達しない**。adversarial が mutation を当てて
// 実測したところ、直したはずの 2 経路 (s3 の purge サマリ / 退会時のログ) は
// **戻しても緑のまま**だった。「3 経路すべて塞いだ」という記録が、実際には 1 経路しか
// 固定していない状態になっていた。ここでは mock の位置を下げて、その 2 経路を通す。
//
// **この file が固定するのは [C1] だけ**。宣言と実装をずらさないために、他の経路が
// どこで守られているかも書いておく (前版はここで [C2] [C3] を宣言しながら実装しておらず、
// 「宣言だけあって実装が無い」を同じ file で 2 度やった):
//
//   [C1] 退会時に S3 削除が失敗しても、ログに PIN が出ない (err の message 経由も含む)
//        → **この file が振る舞いで固定する**
//   repo 層 (`purgeByPrefix` の tolerant ログ / throw する Error の message)
//        → `tests/unit/db/s3-storage-repo.test.ts` が **@aws-sdk/client-s3 を mock して
//          repo の実コードを走らせる** (この file は `$lib/server/db/factory` を mock するので
//          repo 層に 1 行も到達しない)
//   削除失敗経路 (`deleteCloudExport`)
//        → `tests/unit/services/cloud-export-pin-not-logged.test.ts` が振る舞いで固定
//   build 失敗経路 (`drainPendingExports`)
//        → `tests/unit/services/cloud-export-build-failure-pin.test.ts` が **振る舞いで**
//          固定する ([C2]。ログ / DB の failureReason / 親の画面の 3 箇所)
//   起票 / cloud-import の呼び出し口
//        → `tests/unit/services/pin-redaction-callsites-source.test.ts` が **source** で見る
//          (依存が深く mock の量が釣り合わないため。**組み立て式しか見ない**ので、
//          その値をどこへ何と一緒に渡すかは見えない)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const logged: string[] = [];
const record = (...args: unknown[]) => {
	logged.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? v.message : v)));
};
vi.mock('$lib/server/logger', () => ({
	logger: { info: record, warn: record, error: record, debug: record },
}));

const PIN = 'K7M2QX';
const TENANT = 't-owner';
const S3_KEY = `exports/${TENANT}/${PIN}/backup.zip`;

/** S3 の部分失敗は、失敗キーをそのまま message に載せてくる。 */
const purgeFailure = new Error(
	`S3 purge partially failed: 1/1 objects remain (${S3_KEY}:AccessDenied)`,
);

/**
 * 一覧取得 / 行削除が driver 由来で落ちる形。PostgreSQL は UNIQUE 違反の detail に
 * `Key (pin_code)=(…)` を**素で**載せる — `pin_code` に global UNIQUE を張っている以上、
 * PIN を載せる可能性が最も高い実エラーがここに来る。
 */
const listFailure = new Error(
	`duplicate key value violates unique constraint "cloud_exports_pin_code_key" ` +
		`Detail: Key (pin_code)=(${PIN}) already exists. (${S3_KEY})`,
);

const state = {
	purgeThrows: true,
	/** 一覧取得そのものが落ちる経路 (外側 catch)。driver の例外に key が載りうる。 */
	findByTenantThrows: false,
	exports: [{ id: 'e-1', s3Key: S3_KEY, pinCode: PIN }],
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		cloudExport: {
			findByTenant: vi.fn(async () => {
				if (state.findByTenantThrows) throw listFailure;
				return state.exports;
			}),
			deleteById: vi.fn(async () => undefined),
			findById: vi.fn(async () => state.exports[0]),
		},
		storage: {
			purgeByPrefix: vi.fn(async () => {
				if (state.purgeThrows) throw purgeFailure;
				return 1;
			}),
			deleteByPrefix: vi.fn(async () => 0),
		},
	}),
}));

const { deleteTenantScopedData } = await import(
	'../../../src/lib/server/services/tenant-cleanup-service'
);

beforeEach(() => {
	logged.length = 0;
	state.purgeThrows = true;
	state.findByTenantThrows = false;
	vi.clearAllMocks();
});

describe('[C1] 退会時の S3 削除失敗', () => {
	it('ログのどこにも PIN が出ない (err の message 経由も含む)', async () => {
		// 他の削除対象で落ちても、cloudExport の block まで到達していればよい
		await deleteTenantScopedData(TENANT).catch(() => undefined);

		const cloudLogs = logged.filter((l) => l.includes('cloud'));
		expect(
			cloudLogs.length,
			'cloudExport の削除失敗ログが出ていない (この test が経路に届いていない)',
		).toBeGreaterThan(0);
		for (const line of logged) {
			expect(
				line.includes(PIN),
				`ログに PIN が出ている。他家庭の PII ZIP を引ける材料が残る:\n${line}`,
			).toBe(false);
		}
	});

	it('テナントは残る (どの家庭の実体が消せなかったか運用が追える)', async () => {
		await deleteTenantScopedData(TENANT).catch(() => undefined);
		const cloudLogs = logged.filter((l) => l.includes('cloud'));
		expect(cloudLogs.some((l) => l.includes(TENANT))).toBe(true);
	});
});

describe('[C1b] 退会時に cloudExport の一覧取得そのものが落ちる (外側 catch)', () => {
	it('ログに PIN が出ない (record が scope にある catch は機械的に redact を通す)', async () => {
		// #4867 adversarial should-1: 「PIN が載ると証明できたか」で個別に切るのをやめ、
		// `record` / `pinCode` / `s3Key` が scope にある catch は全部通す線にした。
		// この catch は `exports` (pinCode を持つ行) が scope にある。
		state.findByTenantThrows = true;

		await deleteTenantScopedData(TENANT).catch(() => undefined);

		const cloudLogs = logged.filter((l) => l.includes('cloudExports'));
		expect(
			cloudLogs.length,
			'cloudExports 削除失敗ログが出ていない (この test が経路に届いていない)',
		).toBeGreaterThan(0);
		for (const line of logged) {
			expect(
				line.includes(PIN),
				`ログに PIN が出ている:
${line}`,
			).toBe(false);
		}
	});

	it('原因は読める形で残る (伏せすぎて障害が追えなくならない)', async () => {
		state.findByTenantThrows = true;

		await deleteTenantScopedData(TENANT).catch(() => undefined);

		const line = logged.find((l) => l.includes('cloudExports')) ?? '';
		expect(line, '制約名まで消してはいけない (原因が読めなくなる)').toContain(
			'cloud_exports_pin_code_key',
		);
	});
});
