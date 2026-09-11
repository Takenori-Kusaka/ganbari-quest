// tests/unit/services/usage-log-child-scope.test.ts
//
// `endUsageSession` の child scope が **repo の WHERE まで届いている**ことを固定する (#4851 M1)。
//
// 重要なのは「read してから判定する」のではなく「更新自体を (log_id, child_id) で絞る」こと。
// read → check → write にすると、判定より前に ended_at を書いてしまい、兄弟のセッションは
// 結局終了させられてしまう。したがって assert 対象は「repo 呼び出しに scope が乗っていること」と
// 「repo が該当なし (undefined) を返したら 2 回目の更新を行わないこと」の 2 点。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

const updateUsageLogEnd = vi.fn();
const closeOpenSessions = vi.fn();
const insertUsageLog = vi.fn();

vi.mock('$lib/server/db/usage-log-repo', () => ({
	updateUsageLogEnd: (...args: unknown[]) => updateUsageLogEnd(...args),
	closeOpenSessions: (...args: unknown[]) => closeOpenSessions(...args),
	insertUsageLog: (...args: unknown[]) => insertUsageLog(...args),
	findTodayUsageLogs: vi.fn(async () => []),
	findUsageLogsByChildAndDateRange: vi.fn(async () => []),
	deleteByTenantId: vi.fn(async () => undefined),
}));

const TENANT = 't-1';
const SELF = asChildId('1');

describe('endUsageSession の child scope', () => {
	beforeEach(() => {
		updateUsageLogEnd.mockReset();
	});

	it('scopeChildId は repo の updateUsageLogEnd に渡る (WHERE の複合キー化)', async () => {
		updateUsageLogEnd.mockResolvedValue({
			id: 'u-1',
			tenantId: TENANT,
			childId: SELF,
			startedAt: new Date(Date.now() - 60_000).toISOString(),
			endedAt: null,
			durationSec: null,
		});
		const { endUsageSession } = await import('$lib/server/services/usage-log-service');

		const result = await endUsageSession('u-1', TENANT, SELF);

		expect(result).not.toBeNull();
		// 1 回目 (duration=0 の暫定書込) / 2 回目 (実 duration) とも scope 付き
		expect(updateUsageLogEnd).toHaveBeenCalledTimes(2);
		for (const call of updateUsageLogEnd.mock.calls) {
			expect(call[3]).toBe(TENANT);
			expect(call[4]).toBe(SELF);
		}
	});

	it('兄弟の行は WHERE で外れる → 該当なしで null を返し、2 回目の更新を行わない', async () => {
		// repo が (log_id, child_id) で絞った結果 0 行 = undefined
		updateUsageLogEnd.mockResolvedValueOnce(undefined);
		const { endUsageSession } = await import('$lib/server/services/usage-log-service');

		const result = await endUsageSession('u-sibling', TENANT, SELF);

		expect(result).toBeNull();
		// 「該当なし」で打ち切る。2 回目を撃つと scope を無視した更新が走る
		expect(updateUsageLogEnd).toHaveBeenCalledTimes(1);
		expect(updateUsageLogEnd.mock.calls[0]?.[4]).toBe(SELF);
	});

	it('scopeChildId 省略 (owner/parent) は従来どおり scope なしで呼ぶ', async () => {
		updateUsageLogEnd.mockResolvedValue({
			id: 'u-1',
			tenantId: TENANT,
			childId: SELF,
			startedAt: new Date(Date.now() - 60_000).toISOString(),
			endedAt: null,
			durationSec: null,
		});
		const { endUsageSession } = await import('$lib/server/services/usage-log-service');

		await endUsageSession('u-1', TENANT);

		expect(updateUsageLogEnd.mock.calls[0]?.[4]).toBeNull();
	});
});
