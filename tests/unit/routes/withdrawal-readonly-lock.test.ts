// tests/unit/routes/withdrawal-readonly-lock.test.ts
// #3993 — 読み取り専用ロックと物理削除の対象を「退会申請済みか」だけで判定する。
//
// ## 何が壊れていたか
//
// `hooks.server.ts` の読み取り専用ロックと `tenant-cleanup` の削除対象が、どちらも
// `families.status === 'grace_period'` を条件にしていた。しかし `grace_period` は
// **支払い失敗の dunning 猶予**でも書かれる (`handlePaymentFailed`)。
//
// 結果、**カードの期限切れで決済が 1 回失敗しただけで**:
//   - 7 日間すべての書き込みが 403 になり、子どもががんばりを 1 件も記録できない
//   - 物理削除バッチの対象に入る
//
// 要件はこれと真逆を確定している (`phase1-dunning-requirements.md`):
//   NFR-3「子供の利用体験は支払い状態で突然中断しない」/ US-4「アクセス断を経験しない」
//
// 一方、実際の退会申請 (`softDeleteTenant`) は settings にしか書かず `families.status` を
// 触らないため、**止めるべき側にロックが無く、止めてはいけない側に掛かっていた**。
//
// ## 本 test が固定すること
//
// 「dunning では止まらない」「退会申請済みでは止まる」の両方。片方だけだと、
// 条件を丸ごと外す (常に許可) 修正でも緑になってしまう。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		settings: { getSettings: (...a: unknown[]) => getSettings(...a) },
	}),
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: vi.fn(async () => 'standard'),
}));

import { getGracePeriodStatus } from '../../../src/lib/server/services/grace-period-service';

/** 退会申請済み (soft delete) の settings 応答。 */
function softDeleted(physicalDeletionDate: string) {
	return {
		soft_deleted_at: '2026-07-01T00:00:00.000Z',
		deletion_grace_plan_tier: 'standard',
		physical_deletion_date: physicalDeletionDate,
	};
}

/** 退会申請していない (= dunning 中でもこれ) settings 応答。 */
function notWithdrawn() {
	return {};
}

describe('#3993 退会申請の判定は settings が SSOT (families.status ではない)', () => {
	beforeEach(() => {
		getSettings.mockReset();
	});

	// **これが本 Issue の中核。** dunning 中 (families.status = grace_period) でも
	// 退会申請していなければ soft-deleted ではない。
	// 旧実装はここを families.status で見ていたため dunning が誤発火していた。
	it('[L1] 支払い失敗 (dunning) 中でも、退会申請していなければ soft-deleted ではない', async () => {
		getSettings.mockResolvedValue(notWithdrawn());
		const status = await getGracePeriodStatus('t-dunning');
		expect(status.isSoftDeleted).toBe(false);
		// 呼び出しが settings 側であること (families.status を見ていないこと) を固定する
		expect(getSettings).toHaveBeenCalledWith(
			['soft_deleted_at', 'deletion_grace_plan_tier', 'physical_deletion_date'],
			't-dunning',
		);
	});

	it('[L2] 退会申請済みなら soft-deleted と判定される', async () => {
		getSettings.mockResolvedValue(softDeleted('2999-01-01T00:00:00.000Z'));
		const status = await getGracePeriodStatus('t-withdrawn');
		expect(status.isSoftDeleted).toBe(true);
		expect(status.isExpired).toBe(false);
	});

	it('[L3] 退会申請済みかつ physical_deletion_date 経過なら expired (削除対象)', async () => {
		getSettings.mockResolvedValue(softDeleted('2020-01-01T00:00:00.000Z'));
		const status = await getGracePeriodStatus('t-expired');
		expect(status.isSoftDeleted).toBe(true);
		expect(status.isExpired).toBe(true);
	});

	// 削除対象の母集団が「退会申請済み」からのみ導出されることの固定。
	// dunning テナントは settings に soft_deleted_at を持たないので、
	// findExpiredSoftDeletedTenants の母集団に入り得ない。
	it('[L4] dunning テナントは削除判定でも expired にならない', async () => {
		getSettings.mockResolvedValue(notWithdrawn());
		const status = await getGracePeriodStatus('t-dunning');
		expect(status.isExpired).toBe(false);
		expect(status.physicalDeletionDate).toBeNull();
	});
});

describe('#3993 tenant-cleanup は退会申請ベースの実装に委譲する', () => {
	it('[L5] purgeExpiredSoftDeletedTenants を import しており、subscription status を見ない', async () => {
		const { readFileSync } = await import('node:fs');
		const { resolve } = await import('node:path');
		const src = readFileSync(
			resolve(process.cwd(), 'src/routes/api/v1/admin/tenant-cleanup/+server.ts'),
			'utf8',
		);
		// 委譲していること
		expect(src).toContain('purgeExpiredSoftDeletedTenants');
		// **subscription status による選別を復活させないこと** (本 Issue の再発条件)。
		// コメント中の言及は許すため、実コードに現れる形 (SUBSCRIPTION_STATUS の参照) を禁じる。
		const codeOnly = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
			.join('\n');
		expect(codeOnly).not.toContain('SUBSCRIPTION_STATUS');
		expect(codeOnly).not.toContain('planExpiresAt');
	});
});
