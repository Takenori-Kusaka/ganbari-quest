// tests/unit/components/account-deletion-export-panel.test.ts
// #4472: 退会画面のデータ持ち出し導線 (AccountDeletionExportPanel)
//
// 固定する挙動:
//   - 無料プランでもボタンが押せる (プランで出し分けない = 本 Issue の主旨)
//   - 押すとダウンロード処理が呼ばれる
//   - 失敗するとエラー文言が画面に出る (ADR-0062 無言失敗の禁止)
//   - プランごとに「何が入るか」の 1 行説明が変わる

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_LABELS } from '../../../src/lib/domain/labels';
import AccountDeletionExportPanel from '../../../src/lib/features/admin/components/AccountDeletionExportPanel.svelte';

describe('AccountDeletionExportPanel (#4472)', () => {
	afterEach(() => {
		cleanup();
	});

	it('無料プランでもダウンロードボタンが enabled で表示される', () => {
		render(AccountDeletionExportPanel, {
			planTier: 'free',
			download: async () => ({ ok: true as const, filename: 'x.json' }),
		});
		const btn = screen.getByTestId('account-deletion-export-button');
		expect(btn).toBeTruthy();
		expect((btn as HTMLButtonElement).disabled).toBe(false);
	});

	it('クリックするとダウンロード処理が呼ばれる', async () => {
		const download = vi.fn(async () => ({ ok: true as const, filename: 'x.json' }));
		render(AccountDeletionExportPanel, { planTier: 'free', download });

		await fireEvent.click(screen.getByTestId('account-deletion-export-button'));

		await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
	});

	it('失敗するとエラー文言が画面に出る', async () => {
		const download = vi.fn(async () => ({
			ok: false as const,
			message: 'ダウンロードできませんでした',
		}));
		render(AccountDeletionExportPanel, { planTier: 'free', download });

		await fireEvent.click(screen.getByTestId('account-deletion-export-button'));

		await waitFor(() => {
			expect(screen.getByText('ダウンロードできませんでした')).toBeTruthy();
		});
	});

	it('プランごとに「何が入るか」の説明が変わる', () => {
		render(AccountDeletionExportPanel, {
			planTier: 'free',
			download: async () => ({ ok: true as const, filename: 'x.json' }),
		});
		expect(screen.getByTestId('account-deletion-export-scope').textContent).toContain(
			SETTINGS_LABELS.accountDeleteExportScopeMinimal,
		);
		cleanup();

		render(AccountDeletionExportPanel, {
			planTier: 'standard',
			download: async () => ({ ok: true as const, filename: 'x.json' }),
		});
		expect(screen.getByTestId('account-deletion-export-scope').textContent).toContain(
			SETTINGS_LABELS.accountDeleteExportScopeFull,
		);
	});
});
