// tests/unit/routes/error-page-parent-500-5050.test.ts (#5050)
//
// 保護者が 500 を踏んだとき、子供向けのひらがな画面ではなく保護者向けの文言と
// 問い合わせ用のエラー ID が出ることを、描画結果で固定する。
// CloudFront が origin の 500 を静的ページへ差し替えない前提 (#5053) では、
// この +error.svelte が保護者に見える唯一の 500 画面になる。
// 次に誰かがロール判定を触っても、保護者に子供向け文言が出ない / ID が消えない担保。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_PAGE_LABELS, getChildErrorPageLabels } from '../../../src/lib/domain/labels';

const REQUEST_ID = 'req-5050-abcdef';

const pageState: {
	status: number;
	error: { message: string; reason?: string } | null;
	data: unknown;
	url: URL;
} = {
	status: 500,
	error: null,
	data: {},
	url: new URL('https://example.test/admin'),
};

vi.mock('$app/state', () => ({
	get page() {
		return pageState;
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

async function renderErrorPage() {
	const mod = await import('../../../src/routes/+error.svelte');
	render(mod.default);
}

describe('#5050: 保護者 × 500 の +error.svelte', () => {
	beforeEach(() => {
		pageState.status = 500;
		pageState.error = { message: 'Internal Error' };
		pageState.url = new URL('https://example.test/admin');
	});

	afterEach(() => {
		cleanup();
	});

	it.each([
		'owner',
		'parent',
	])('role=%s は保護者向けの文言とエラー ID を出し、子供向け文言は出さない', async (role) => {
		pageState.data = { role, requestId: REQUEST_ID };
		await renderErrorPage();

		expect(screen.getByText(ERROR_PAGE_LABELS.titleDefault)).toBeTruthy();
		expect(screen.getByText(ERROR_PAGE_LABELS.descGenericParent)).toBeTruthy();
		// エラー ID (問い合わせで特定するための値)
		expect(screen.getByText(REQUEST_ID)).toBeTruthy();
		expect(screen.getByText(ERROR_PAGE_LABELS.errorIdPrefix.trim(), { exact: false })).toBeTruthy();
		// 子供向けのひらがな / 漢字文言は出ない
		for (const mode of ['preschool', 'senior']) {
			const child = getChildErrorPageLabels(mode);
			expect(screen.queryByText(child.titleDefault)).toBeNull();
			expect(screen.queryByText(child.descGeneric)).toBeNull();
		}
		// 保護者は自動で /switch に飛ばされず、再読み込みの導線がある
		expect(screen.getByText(ERROR_PAGE_LABELS.btnRetry)).toBeTruthy();
		expect(document.querySelector('[data-role="parent"]')).not.toBeNull();
	});

	it('role が解決できない /admin 配下の 500 も保護者扱いでエラー ID を出す', async () => {
		pageState.data = { requestId: REQUEST_ID };
		await renderErrorPage();

		expect(screen.getByText(ERROR_PAGE_LABELS.descGenericParent)).toBeTruthy();
		expect(screen.getByText(REQUEST_ID)).toBeTruthy();
		expect(screen.queryByText(getChildErrorPageLabels('preschool').descGeneric)).toBeNull();
	});

	it('対照: 子供ロールの 500 は子供向け文言で、エラー ID は出さない', async () => {
		pageState.data = { role: 'child', requestId: REQUEST_ID };
		pageState.url = new URL('https://example.test/preschool/home');
		await renderErrorPage();

		expect(screen.getByText(getChildErrorPageLabels('preschool').descGeneric)).toBeTruthy();
		expect(screen.queryByText(REQUEST_ID)).toBeNull();
		expect(screen.queryByText(ERROR_PAGE_LABELS.descGenericParent)).toBeNull();
	});
});
