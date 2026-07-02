// tests/unit/routes/admin-activities-edit-clamp.test.ts
// #3463 item1/item2: 活動編集 route (/admin/activities/[id]/edit) の save action が
// dailyLimit / nameKana / nameKanji を sanitizer 経由で clamp することを検証する。
//
// 根本原因 (#3463 QM BLOCK): create/update/bulk action は sanitizeDailyLimit 化済だったが
// 編集 route だけが旧 `Number(raw)` 直書きのまま残り、改竄/破損由来の NaN/負値/巨大値/巨大文字列が
// 素通りしていた。本テストは編集経路でも sanitizer が適用されることを保証する。
//
// 設計判断: SvelteKit CSRF を回避するため action handler を直接呼び出す
// (admin-activities-import-plan-gate.test.ts と同型)。save 成功時は redirect(303) を throw するため
// updateActivity の呼出引数を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireTenantId = vi.fn();
const mockUpdateActivity = vi.fn();
const mockGetActivityById = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: mockRequireTenantId,
}));

vi.mock('$lib/server/services/activity-service', () => ({
	getActivityById: mockGetActivityById,
	updateActivity: mockUpdateActivity,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/activities/[id]/edit/+page.server');

type SaveEvent = {
	request: Request;
	locals: App.Locals;
	params: { id: string };
};
const saveAction = mod.actions.save as unknown as (event: SaveEvent) => Promise<unknown>;

function makeLocals() {
	return { context: { tenantId: 'tenant-1' } } as unknown as App.Locals;
}

function makeFormRequest(fields: Record<string, string | number>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		form.append(k, String(v));
	}
	return new Request('http://localhost/admin/activities/1/edit', { method: 'POST', body: form });
}

/** save action は成功時 redirect(303) を throw する。updateActivity が呼ばれた時点の payload を返す。 */
async function runSave(fields: Record<string, string | number>) {
	await saveAction({
		request: makeFormRequest(fields),
		locals: makeLocals(),
		params: { id: '1' },
	}).catch(() => {
		// redirect(303) の throw を握りつぶす (成功経路)
	});
	expect(mockUpdateActivity).toHaveBeenCalledTimes(1);
	return mockUpdateActivity.mock.calls[0]?.[1] as Record<string, unknown>;
}

const baseFields = { name: 'おてつだい', categoryId: 1, icon: '📝', basePoints: 5 };

describe('/admin/activities/[id]/edit save action — #3463 dailyLimit/name sanitize', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockUpdateActivity.mockResolvedValue(undefined);
	});

	it('負値 dailyLimit は安全既定 null (=1回) に倒す (0=無制限への昇格を防ぐ)', async () => {
		const payload = await runSave({ ...baseFields, dailyLimit: -5 });
		expect(payload.dailyLimit).toBeNull();
	});

	it('dailyLimit=0 (無制限) は保持する', async () => {
		const payload = await runSave({ ...baseFields, dailyLimit: 0 });
		expect(payload.dailyLimit).toBe(0);
	});

	it('上限超 dailyLimit は 99 に丸める', async () => {
		const payload = await runSave({ ...baseFields, dailyLimit: 1000 });
		expect(payload.dailyLimit).toBe(99);
	});

	it('非整数 dailyLimit は切り捨てる', async () => {
		const payload = await runSave({ ...baseFields, dailyLimit: 3.9 });
		expect(payload.dailyLimit).toBe(3);
	});

	it('巨大 nameKana / nameKanji は 50 文字に切詰める', async () => {
		const long = 'あ'.repeat(120);
		const payload = await runSave({ ...baseFields, nameKana: long, nameKanji: long });
		expect(payload.nameKana).toHaveLength(50);
		expect(payload.nameKanji).toHaveLength(50);
	});
});
