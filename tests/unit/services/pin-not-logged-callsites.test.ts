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
// 固定する不変条件:
//   [C1] 退会時に S3 削除が失敗しても、ログに PIN が出ない (err の message 経由も含む)
//   [C2] build 失敗の `failureReason` に PIN が出ない
//        — これは DB の failure_reason に入り、**保護者の画面にそのまま表示される**
//   [C3] 起票ログに PIN が出ない (前版で唯一固定できていた経路。振る舞いへ移す過程で
//        coverage が消えていたので、ここで取り戻す)

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

const state = {
	purgeThrows: true,
	exports: [{ id: 'e-1', s3Key: S3_KEY, pinCode: PIN }],
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		cloudExport: {
			findByTenant: vi.fn(async () => state.exports),
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
