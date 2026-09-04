// tests/unit/routes/id-only-child-scope.test.ts
//
// 「**行 id しか受け取らない** per-child mutation」の child scope を、route → service の引数で固定する。
//
// `per-child-sibling-authz.test.ts` は「兄弟の childId を渡すと 403」を見るが、これらの endpoint は
// 要求に childId が現れないので同じ形では検証できない (adversarial review M2-b/M2-c の指摘)。
// ここでは service を mock し、**route が `requireChildScope` の戻り値を service へそのまま渡している**
// ことを assert する。scope を捨てる実装 (`f(id, tenantId)` / `f(id, tenantId, scope ? null : null)`) は
// 引数が `undefined` / `null` になるため必ず落ちる。
//
// 併せて「紐づいていない child セッションは 403」も固定する (fail-closed)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

const cancelActivityLog = vi.fn();
const endUsageSession = vi.fn();
const startUsageSession = vi.fn();

vi.mock('$lib/server/services/activity-log-service', () => ({
	cancelActivityLog: (...args: unknown[]) => cancelActivityLog(...args),
	recordActivity: vi.fn(),
	getActivityLogs: vi.fn(),
}));

vi.mock('$lib/server/services/usage-log-service', () => ({
	endUsageSession: (...args: unknown[]) => endUsageSession(...args),
	startUsageSession: (...args: unknown[]) => startUsageSession(...args),
}));

/** 自分 (child セッションが紐づく子供) */
const SELF = asChildId('1');

function childLocals(): App.Locals {
	return {
		authenticated: true,
		identity: { type: 'cognito', userId: 'u-child', email: 'c@example.com' },
		context: { tenantId: 't-1', role: 'child', childId: SELF },
	} as unknown as App.Locals;
}

function parentLocals(): App.Locals {
	return {
		authenticated: true,
		identity: { type: 'cognito', userId: 'u-parent', email: 'p@example.com' },
		context: { tenantId: 't-1', role: 'parent' },
	} as unknown as App.Locals;
}

/** child ロールだが子供レコードに紐づいていない (childId 未解決) セッション */
function unlinkedChildLocals(): App.Locals {
	return {
		authenticated: true,
		identity: { type: 'cognito', userId: 'u-child', email: 'c@example.com' },
		context: { tenantId: 't-1', role: 'child' },
	} as unknown as App.Locals;
}

async function statusOf(run: () => Response | Promise<Response>): Promise<number> {
	try {
		const res = await run();
		return res?.status ?? 200;
	} catch (e) {
		return (e as { status?: number })?.status ?? 500;
	}
}

describe('DELETE /api/v1/activity-logs/[id] — 行 id だけの mutation を child scope に絞る', () => {
	beforeEach(() => {
		cancelActivityLog.mockReset();
		cancelActivityLog.mockResolvedValue({ refundedPoints: 3 });
	});

	it('child ロールは自分の childId が service へ渡る (scope を捨てていない)', async () => {
		const mod = await import('../../../src/routes/api/v1/activity-logs/[id]/+server');
		await mod.DELETE({ params: { id: 'log-1' }, locals: childLocals() } as never);

		expect(cancelActivityLog).toHaveBeenCalledTimes(1);
		expect(cancelActivityLog).toHaveBeenCalledWith('log-1', 't-1', SELF);
	});

	it('parent は絞り込みなし (null) — 全 child の記録をとりけせる', async () => {
		const mod = await import('../../../src/routes/api/v1/activity-logs/[id]/+server');
		await mod.DELETE({ params: { id: 'log-1' }, locals: parentLocals() } as never);

		expect(cancelActivityLog).toHaveBeenCalledWith('log-1', 't-1', null);
	});

	it('未紐づけ child は 403 で閉じ、service を呼ばない', async () => {
		const mod = await import('../../../src/routes/api/v1/activity-logs/[id]/+server');
		const status = await statusOf(() =>
			mod.DELETE({ params: { id: 'log-1' }, locals: unlinkedChildLocals() } as never),
		);

		expect(status).toBe(403);
		expect(cancelActivityLog).not.toHaveBeenCalled();
	});
});

describe('PATCH /api/v1/usage — 行 id だけの mutation を child scope に絞る (M1)', () => {
	beforeEach(() => {
		endUsageSession.mockReset();
		endUsageSession.mockResolvedValue({ durationSec: 42 });
	});

	function patchEvent(locals: App.Locals) {
		return {
			request: { json: async () => ({ id: 'usage-1' }) },
			locals,
		} as never;
	}

	it('child ロールは自分の childId が service へ渡る (兄弟のセッションを終了できない)', async () => {
		const mod = await import('../../../src/routes/api/v1/usage/+server');
		await mod.PATCH(patchEvent(childLocals()));

		expect(endUsageSession).toHaveBeenCalledTimes(1);
		expect(endUsageSession).toHaveBeenCalledWith('usage-1', 't-1', SELF);
	});

	it('parent は絞り込みなし (null) — 従来どおり任意のセッションを終了できる', async () => {
		const mod = await import('../../../src/routes/api/v1/usage/+server');
		await mod.PATCH(patchEvent(parentLocals()));

		expect(endUsageSession).toHaveBeenCalledWith('usage-1', 't-1', null);
	});

	it('未紐づけ child は 403 で閉じ、service を呼ばない', async () => {
		const mod = await import('../../../src/routes/api/v1/usage/+server');
		const status = await statusOf(() => mod.PATCH(patchEvent(unlinkedChildLocals())));

		expect(status).toBe(403);
		expect(endUsageSession).not.toHaveBeenCalled();
	});
});
