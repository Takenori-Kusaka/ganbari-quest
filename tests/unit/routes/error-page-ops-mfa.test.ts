// tests/unit/routes/error-page-ops-mfa.test.ts
// #4282 AC5: エラー画面が「MFA が理由の 403」だけ復旧導線に切り替わることを固定する。
//
// component 単体 (ops-mfa-setup-notice.test.ts) と guard 単体 (ops-mfa-guard.test.ts) が
// 両方緑でも、`+error.svelte` の分岐が外れていれば運営者には従来の 403 が出たままになる
// (= 復旧できない締め出しが復活する)。両者を繋ぐ配線をここで assert する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_PAGE_LABELS, OPS_MFA_SETUP_LABELS } from '../../../src/lib/domain/labels';

const pageState: {
	status: number;
	error: { message: string; reason?: string } | null;
	data: unknown;
} = {
	status: 403,
	error: null,
	data: {},
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

describe('#4282 +error.svelte — MFA 理由の 403 だけ復旧導線に切り替える', () => {
	beforeEach(() => {
		pageState.status = 403;
		pageState.error = null;
		pageState.data = {};
	});

	afterEach(() => {
		cleanup();
	});

	it('reason=ops-mfa-required の 403 は設定導線を出す (汎用 403 は出さない)', async () => {
		pageState.error = { message: 'Forbidden: ops access requires MFA', reason: 'ops-mfa-required' };
		await renderErrorPage();

		expect(screen.getByTestId('ops-mfa-setup-notice')).toBeTruthy();
		expect(screen.getByRole('heading', { name: OPS_MFA_SETUP_LABELS.title })).toBeTruthy();
		// 汎用 403 (「アクセスが きょか されていません」) に戻っていないこと
		expect(screen.queryByText(ERROR_PAGE_LABELS.title403)).toBeNull();
	});

	it('reason の無い 403 は従来の汎用 403 のまま (非 ops に ops の存在を示唆しない)', async () => {
		pageState.error = { message: 'Forbidden' };
		await renderErrorPage();

		expect(screen.getByText(ERROR_PAGE_LABELS.title403)).toBeTruthy();
		expect(screen.queryByTestId('ops-mfa-setup-notice')).toBeNull();
	});

	it('内部の例外メッセージは画面に出さない (ADR-0062 内部例外非露出)', async () => {
		pageState.error = { message: 'Forbidden: ops access requires MFA', reason: 'ops-mfa-required' };
		await renderErrorPage();

		expect(screen.queryByText(/Forbidden/)).toBeNull();
	});
});
