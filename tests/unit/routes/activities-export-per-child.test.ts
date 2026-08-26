// tests/unit/routes/activities-export-per-child.test.ts
// #4692 F2: 活動エクスポートは「選択中の子」の活動だけを出す。
//
// 旧実装は `getActivities(tenantId)` (tenant 全 child aggregate) を子供の区別なく 1 ファイルへ
// 平坦化していた。その JSON を復元すると F1 (first-child silent bind) と合わさって
// 「全員分が最初の子に入る」事故になっていた。ごほうび (/api/v1/special-rewards/export) と
// 同型に childId 必須 + per-child 取得であることを固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

const mockGetChildActivities = vi.fn();
const mockGetActivities = vi.fn();

vi.mock('$lib/server/services/activity-service', () => ({
	getChildActivities: (...args: unknown[]) => mockGetChildActivities(...args),
	getActivities: (...args: unknown[]) => mockGetActivities(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireRole: vi.fn(),
	getAuthMode: vi.fn(() => 'cognito'),
}));

const mod = await import('../../../src/routes/api/v1/activities/export/+server');

function parentLocals() {
	return { context: { tenantId: 't-1', role: 'parent' } } as unknown as App.Locals;
}

async function callGet(urlStr: string) {
	return (await mod.GET({
		locals: parentLocals(),
		url: new URL(urlStr),
	} as never)) as Response;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetChildActivities.mockResolvedValue([
		{ name: 'けんたの活動', categoryId: 1, icon: '🏃', basePoints: 5, triggerHint: null },
	]);
	mockGetActivities.mockResolvedValue([]);
});

describe('#4692 F2 /api/v1/activities/export は per-child scope', () => {
	it('childId 未指定は 400 (tenant 全件を平坦化して返さない)', async () => {
		const res = await callGet('http://x/api/v1/activities/export');

		expect(res.status).toBe(400);
		expect(mockGetChildActivities).not.toHaveBeenCalled();
		expect(mockGetActivities).not.toHaveBeenCalled();
	});

	it('childId 指定でその子の活動だけを取得して返す', async () => {
		const res = await callGet('http://x/api/v1/activities/export?childId=903');

		expect(res.status).toBe(200);
		expect(mockGetChildActivities).toHaveBeenCalledWith(asChildId('903'), 't-1', {
			includeHidden: false,
		});
		// tenant 全 child aggregate API は使わない
		expect(mockGetActivities).not.toHaveBeenCalled();

		const body = JSON.parse(await res.text()) as { payload: { activities: { name: string }[] } };
		expect(body.payload.activities).toHaveLength(1);
		expect(body.payload.activities[0]?.name).toBe('けんたの活動');
	});

	it('その子の活動が 0 件なら 400 (空ファイルを配らない)', async () => {
		mockGetChildActivities.mockResolvedValue([]);

		const res = await callGet('http://x/api/v1/activities/export?childId=903');

		expect(res.status).toBe(400);
	});
});
