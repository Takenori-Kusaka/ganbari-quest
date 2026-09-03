// tests/unit/routes/error-page-child-tone-4690.test.ts (#4690 F3)
//
// 存在しないパス (実測 `/preschool/battle`) の 404 で、3〜5 歳の画面に保護者向けの
// 「お探しのページは存在しないか、移動した可能性があります。」が出ていた。
// 子供 layout の load が走らず `page.data.role` が null になるため、role だけを見る
// 判定では子供画面と分からないのが原因。URL からも判定することを、描画結果で固定する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_PAGE_LABELS, getChildErrorPageLabels } from '../../../src/lib/domain/labels';

const pageState: {
	status: number;
	error: { message: string; reason?: string } | null;
	data: unknown;
	url: URL;
} = {
	status: 404,
	error: null,
	data: {},
	url: new URL('https://example.test/'),
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

describe('#4690 F3: 404 の文言が「誰の画面か」と年齢帯に従う', () => {
	beforeEach(() => {
		pageState.status = 404;
		pageState.error = null;
		// role が解決できない状態 (子供 layout の load が走らなかったとき) を再現する
		pageState.data = {};
	});

	afterEach(() => {
		cleanup();
	});

	it('preschool 配下の 404 は、role が無くてもひらがなの子供向け文言を出す', async () => {
		pageState.url = new URL('https://example.test/preschool/battle');
		await renderErrorPage();

		expect(screen.getByText(getChildErrorPageLabels('preschool').desc404)).toBeTruthy();
		expect(screen.queryByText(ERROR_PAGE_LABELS.desc404Parent)).toBeNull();
	});

	it('senior 配下の 404 は漢字の子供向け文言を出す', async () => {
		pageState.url = new URL('https://example.test/senior/battle');
		await renderErrorPage();

		const senior = getChildErrorPageLabels('senior');
		expect(screen.getByText(senior.desc404)).toBeTruthy();
		// ひらがな変種に戻っていないこと
		expect(screen.queryByText(getChildErrorPageLabels('preschool').desc404)).toBeNull();
		expect(screen.queryByText(ERROR_PAGE_LABELS.desc404Parent)).toBeNull();
	});

	it('保護者画面の 404 は従来どおり保護者向け文言のまま', async () => {
		pageState.url = new URL('https://example.test/admin/rewards');
		await renderErrorPage();

		expect(screen.getByText(ERROR_PAGE_LABELS.desc404Parent)).toBeTruthy();
		expect(screen.queryByText(getChildErrorPageLabels('preschool').desc404)).toBeNull();
	});
});
