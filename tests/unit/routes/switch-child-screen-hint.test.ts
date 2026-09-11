// tests/unit/routes/switch-child-screen-hint.test.ts
//
// **「押したのに終わらない」を残さない** (#4866 系 QM 監査 onboarding / PO 差し戻し 2026-09-09)。
//
// ## なぜ要るか
//
// admin の checklist の「お子さまの画面を確認する」は `/switch` へリンクしているが、
// 完了を書くのは `(child)/+layout.server.ts` — つまり **子供を選んで子供画面に入った時点**。
// リンクを踏んで `/switch` に着いただけでは完了しないので、保護者には
// 「リンクが効いていない」ように見える。自己ループ回避 (#4873) で再開バナーも消えるため、
// **この画面に手順の続け方が 1 つも出ていなかった**。
//
// ## 固定する不変条件
//
//   [H1] 「お子さまの画面を確認する」が未完了なら、あと 1 タップ要ることを出す旗が立つ
//   [H2] 完了済みなら旗は立たない (終わった手順を案内し続けない)
//   [H3] 子供ロール / demo では立たない (親の設定タスクなので、子供の画面に出さない)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOnboardingProgress = vi.fn();

vi.mock('$lib/server/services/onboarding-service', () => ({
	getOnboardingProgress: (...args: unknown[]) => mockGetOnboardingProgress(...args),
}));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(async () => [{ id: 'c-1', nickname: 'まさと' }]),
}));
vi.mock('$lib/server/services/auth-service', () => ({
	isPinConfigured: vi.fn(async () => true),
}));
vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	requireTenantId: () => 't-1',
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { load } = await import('../../../src/routes/switch/+page.server');

function progress(childScreenCompleted: boolean) {
	return {
		items: [
			{ key: 'children', label: 'x', completed: true, href: '/admin/children', required: true },
			{
				key: 'child_screen',
				label: 'y',
				completed: childScreenCompleted,
				href: '/switch',
				required: true,
			},
		],
		completedCount: childScreenCompleted ? 2 : 1,
		totalCount: 2,
		allCompleted: childScreenCompleted,
		wizardInProgress: false,
		// nextRecommendation を `/switch` にすると #4873 の自己ループ回避で onboarding が
		// null になる。**旗はそれとは独立に立つ**ことを見たいので別 path にしておく。
		nextRecommendation: { label: 'z', href: '/admin/activities' },
	};
}

function makeEvent(opts: { role?: string; isDemo?: boolean } = {}) {
	return {
		url: new URL('https://x/switch'),
		locals: {
			isDemo: opts.isDemo ?? false,
			identity: { type: 'cognito' },
			context: { tenantId: 't-1', role: opts.role ?? 'owner' },
		},
		cookies: { get: () => undefined },
		// biome-ignore lint/suspicious/noExplicitAny: minimal LoadEvent stub for load unit test
	} as any;
}

async function loadData(opts: { role?: string; isDemo?: boolean } = {}) {
	const data = await load(makeEvent(opts));
	if (!data) throw new Error('load が data を返さなかった');
	return data as unknown as { childScreenPending: boolean };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetOnboardingProgress.mockResolvedValue(progress(false));
});

describe('[H1] 未完了なら「あと 1 タップ」の旗が立つ', () => {
	it('child_screen が未完了なら childScreenPending=true', async () => {
		const data = await loadData();
		expect(
			data.childScreenPending,
			'旗が立たないと、この画面には手順の続け方が 1 つも出ない (再開バナーは自己ループ回避で消える)',
		).toBe(true);
	});
});

describe('[H2] 完了済みなら立たない', () => {
	it('child_screen が完了なら childScreenPending=false', async () => {
		mockGetOnboardingProgress.mockResolvedValue(progress(true));
		const data = await loadData();
		expect(data.childScreenPending).toBe(false);
	});
});

describe('[H3] 子供 / demo には出さない', () => {
	it('child ロールでは立たない', async () => {
		const data = await loadData({ role: 'child' });
		expect(data.childScreenPending, '親の設定タスクを子供の画面に出さない').toBe(false);
	});

	it('demo では立たない (完了を記録できないので永久に出続ける)', async () => {
		const data = await loadData({ isDemo: true });
		expect(data.childScreenPending).toBe(false);
	});
});
