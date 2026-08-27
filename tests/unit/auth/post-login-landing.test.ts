// tests/unit/auth/post-login-landing.test.ts
// #4641: ログイン直後の着地先はロールで決める。
//
// 旧実装は経路を問わず /admin に送っていたため、子供ロールはログインした瞬間に認可層で弾かれ
// `/switch?reason=admin_forbidden` に跳ね返され、身に覚えのない警告を最初に見せられていた。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveContext = vi.fn();
vi.mock('$lib/server/auth/factory', () => ({
	getAuthProvider: () => ({ resolveContext: mockResolveContext }),
}));

const mockGetChildById = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	getChildById: (...args: unknown[]) => mockGetChildById(...args),
}));

import {
	CHILD_LANDING,
	landingForRole,
	PARENT_LANDING,
	resolvePostLoginLanding,
	UNDECIDED_LANDING,
} from '../../../src/lib/server/auth/post-login-landing';

const identity = {
	type: 'cognito' as const,
	userId: 'cognito-sub-1',
	email: 'a@example.com',
};
function createEvent(cookieValues: Record<string, string> = {}) {
	const jar = new Map(Object.entries(cookieValues));
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => jar.set(name, value),
		delete: (name: string) => jar.delete(name),
	};
	// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の部分モック
	return { jar, event: { cookies } as any };
}

const { event } = createEvent();

beforeEach(() => {
	vi.clearAllMocks();
	mockGetChildById.mockResolvedValue({ id: 'c-1', uiMode: 'preschool' });
});

describe('#4641 ログイン直後の着地先', () => {
	it('紐づけ済みの子供は自分のホームへ直行する (選択操作を求めない)', async () => {
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'child', childId: 'c-1' });
		const { jar, event: ev } = createEvent();

		await expect(resolvePostLoginLanding(ev, identity)).resolves.toBe('/preschool/home');
		// cookie を確定させてから送る (未確定のまま送ると child layout が /switch に戻し往復する)
		expect(jar.get('selectedChildId')).toBe('c-1');
	});

	it('cookie に選択済みの子供が残っていればそこへ直行する', async () => {
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'child' });
		mockGetChildById.mockResolvedValue({ id: 'c-2', uiMode: 'junior' });
		const { event: ev } = createEvent({ selectedChildId: 'c-2' });

		await expect(resolvePostLoginLanding(ev, identity)).resolves.toBe('/junior/home');
	});

	it('どのプロフィールとも紐づいていない子供は選択画面へ (警告 query は付けない)', async () => {
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'child' });
		const { event: ev } = createEvent();

		await expect(resolvePostLoginLanding(ev, identity)).resolves.toBe(CHILD_LANDING);
	});

	it('cookie の子供が既に居なければ選択画面へ (存在しないホームへ送らない)', async () => {
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'child' });
		mockGetChildById.mockResolvedValue(null);
		const { event: ev } = createEvent({ selectedChildId: 'c-gone' });

		await expect(resolvePostLoginLanding(ev, identity)).resolves.toBe(CHILD_LANDING);
	});

	it('親は見守り画面へ送る', async () => {
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'parent' });

		await expect(resolvePostLoginLanding(event, identity)).resolves.toBe(PARENT_LANDING);
	});

	it('所属が確定していなければ理由を出す画面へ送る (#4636)', async () => {
		mockResolveContext.mockResolvedValue(null);

		await expect(resolvePostLoginLanding(event, identity)).resolves.toBe(UNDECIDED_LANDING);
	});

	it('呼び出し側の指定 (OAuth の戻り先) は親にだけ効かせる', async () => {
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'owner' });
		await expect(resolvePostLoginLanding(event, identity, '/auth/reset-pin')).resolves.toBe(
			'/auth/reset-pin',
		);

		// 子供に親向け画面を渡すと弾かれて元の跳ね返りに戻るため、指定を無視する
		mockResolveContext.mockResolvedValue({ tenantId: 't-1', role: 'child' });
		await expect(
			resolvePostLoginLanding(createEvent().event, identity, '/auth/reset-pin'),
		).resolves.toBe(CHILD_LANDING);
	});

	it('role から直接引く場合も同じ対応表を通る', () => {
		expect(landingForRole('child')).toBe(CHILD_LANDING);
		expect(landingForRole('owner')).toBe(PARENT_LANDING);
		expect(landingForRole('parent')).toBe(PARENT_LANDING);
	});
});
