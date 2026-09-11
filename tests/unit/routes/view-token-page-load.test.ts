// tests/unit/routes/view-token-page-load.test.ts
// #4703: 閲覧リンク /view/<token> の load が「画面がそのまま出せる形」を返すことを固定する。
//
// ## 旧実装の何が壊れていたか
//
// `getPointBalance()` は `PointBalance | { error: 'NOT_FOUND' }` を返すのに、load は戻り値を
// そのまま `totalPoints` に代入していた。`+page.svelte` は `totalPoints.toLocaleString()` を
// 呼ぶため、プレミアムの祖父母向け閲覧リンクを開いた人が最初に見る数字が、子供全員分
// **「[object Object] ポイント」**になっていた。
//
// 無効 / 期限切れ token も汎用 404「ページが みつかりません」に落ちるだけで、
// 「このリンクは無効か、期限切れです」という専用の説明が出なかった。

import { describe, expect, it, vi } from 'vitest';

const resolveViewerToken = vi.fn();
const getAllChildren = vi.fn();
const getPointBalance = vi.fn();
const getChildStatus = vi.fn();

vi.mock('$lib/server/services/viewer-token-service', () => ({
	resolveViewerToken: (...args: unknown[]) => resolveViewerToken(...args),
}));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => getAllChildren(...args),
}));
vi.mock('$lib/server/services/point-service', () => ({
	getPointBalance: (...args: unknown[]) => getPointBalance(...args),
}));
vi.mock('$lib/server/services/status-service', () => ({
	getChildStatus: (...args: unknown[]) => getChildStatus(...args),
}));

interface ViewerPageData {
	label: string;
	childrenData: {
		nickname: string;
		age: number;
		totalPoints: number;
		totalLevel: number;
		statuses: { categoryId: string; level: number; totalXp: number }[];
	}[];
}

async function loadView(token = 'tok-1'): Promise<ViewerPageData> {
	const mod = await import('../../../src/routes/view/[token]/+page.server.ts');
	return (await mod.load({ params: { token } } as never)) as unknown as ViewerPageData;
}

const CHILD = { id: 1, nickname: 'たろう', age: 4 };

function mockOk({ balance, status }: { balance: unknown; status: unknown }) {
	resolveViewerToken.mockResolvedValue({ tenantId: 't-1', label: 'おばあちゃん用' });
	getAllChildren.mockResolvedValue([CHILD]);
	getPointBalance.mockResolvedValue(balance);
	getChildStatus.mockResolvedValue(status);
}

describe('/view/[token] load — ポイントは数値で渡す (#4703)', () => {
	it('PointBalance オブジェクトではなく balance の数値を渡す', async () => {
		mockOk({
			balance: { childId: 1, balance: 1234, convertableAmount: 1000, nextConvertAt: 1234 },
			status: { statuses: { 1: { level: 3, value: 120 } } },
		});

		const data = await loadView();
		const child = data.childrenData[0];

		expect(typeof child?.totalPoints).toBe('number');
		expect(child?.totalPoints).toBe(1234);
		// 画面は toLocaleString() を呼ぶ。オブジェクトが混ざると "[object Object]" になる
		expect(String(child?.totalPoints)).not.toContain('[object');
	});

	it('ポイント取得が NOT_FOUND でも数値 0 を渡す (画面を壊さない)', async () => {
		mockOk({
			balance: { error: 'NOT_FOUND' },
			status: { statuses: { 1: { level: 3, value: 120 } } },
		});

		const data = await loadView();
		expect(data.childrenData[0]?.totalPoints).toBe(0);
	});

	it('ステータス取得が失敗した場合もポイントは数値で渡す (旧実装が壊れていた分岐)', async () => {
		mockOk({
			balance: { childId: 1, balance: 77, convertableAmount: 0, nextConvertAt: 100 },
			status: { error: 'NOT_FOUND' },
		});

		const data = await loadView();
		const child = data.childrenData[0];
		expect(child?.totalPoints).toBe(77);
		expect(child?.statuses).toEqual([]);
	});
});

describe('/view/[token] load — 無効 token は専用メッセージ (#4703)', () => {
	it('無効 / 期限切れ token は 404 + viewer-token-invalid reason を投げる', async () => {
		resolveViewerToken.mockResolvedValue(null);

		const err = await loadView('bogus').then(
			() => null,
			(e: unknown) => e as { status?: number; body?: { message?: string; reason?: string } },
		);

		expect(err).not.toBeNull();
		expect(err?.status).toBe(404);
		// 画面側が「汎用 404」と区別するためのキー。message 本文には依存しない (ADR-0062)
		expect(err?.body?.reason).toBe('viewer-token-invalid');
	});
});
