// tests/unit/components/ai-suggest-panel-plan-gate.test.ts
// #734: AiSuggestPanel のクライアント側プランゲート
//
// テスト観点:
// - isPremium=false: ロックバッジ・アップセル CTA が表示され、input/button が disabled
// - isPremium=true: ロック UI が出ない、input/button が enabled
// - CTA リンク先は /admin/license
//
// 本来 E2E を推すが、AiSuggestPanel の可視状態を検証するだけなら jsdom で十分。
// props を直接渡せるので free/standard/family 相当を高速に切替確認できる。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AiSuggestPanel from '../../../src/lib/features/admin/components/AiSuggestPanel.svelte';

describe('AiSuggestPanel プランゲート (#734)', () => {
	afterEach(() => {
		cleanup();
	});

	// ============================================================
	// isPremium=false（free / non-paid）
	// ============================================================

	describe('無料プラン（isPremium=false）', () => {
		const props = { onaccept: () => {}, isPremium: false };

		it('パネル本体は描画される（機能の存在を示す）', () => {
			render(AiSuggestPanel, props);
			const panel = screen.getByTestId('ai-suggest-panel');
			expect(panel).toBeDefined();
			expect(panel.getAttribute('data-plan-locked')).toBe('true');
		});

		it('ロックバッジ（スタンダード限定）が表示される', () => {
			render(AiSuggestPanel, props);
			const badge = screen.getByTestId('ai-suggest-locked-badge');
			expect(badge).toBeDefined();
			expect(badge.textContent).toContain('スタンダード');
		});

		it('アップセルカードが表示される', () => {
			render(AiSuggestPanel, props);
			expect(screen.getByTestId('ai-suggest-upgrade-card')).toBeDefined();
		});

		it('「スタンダードで解放する」CTA が /admin/license へ導線する', () => {
			render(AiSuggestPanel, props);
			const cta = screen.getByTestId('ai-suggest-upgrade-cta');
			expect(cta).toBeDefined();
			expect(cta.getAttribute('href')).toBe('/admin/license');
			expect(cta.textContent).toContain('スタンダード');
		});

		it('入力フィールドが disabled で入力不可', () => {
			render(AiSuggestPanel, props);
			const input = document.querySelector<HTMLInputElement>('input[type="text"]');
			expect(input).toBeDefined();
			expect(input?.disabled).toBe(true);
		});

		it('提案ボタンが disabled', () => {
			render(AiSuggestPanel, props);
			const btn = document.querySelector<HTMLButtonElement>('button[type="button"]');
			expect(btn).toBeDefined();
			expect(btn?.disabled).toBe(true);
		});
	});

	// ============================================================
	// isPremium=true（standard / family）
	// ============================================================

	describe('有料プラン（isPremium=true）', () => {
		const props = { onaccept: () => {}, isPremium: true };

		it('パネル本体が描画され data-plan-locked が false', () => {
			render(AiSuggestPanel, props);
			const panel = screen.getByTestId('ai-suggest-panel');
			expect(panel).toBeDefined();
			expect(panel.getAttribute('data-plan-locked')).toBe('false');
		});

		it('ロックバッジが表示されない', () => {
			render(AiSuggestPanel, props);
			expect(screen.queryByTestId('ai-suggest-locked-badge')).toBeNull();
		});

		it('アップセルカードが表示されない', () => {
			render(AiSuggestPanel, props);
			expect(screen.queryByTestId('ai-suggest-upgrade-card')).toBeNull();
		});

		it('アップセル CTA が表示されない', () => {
			render(AiSuggestPanel, props);
			expect(screen.queryByTestId('ai-suggest-upgrade-cta')).toBeNull();
		});

		it('入力フィールドが enabled（入力可能）', () => {
			render(AiSuggestPanel, props);
			const input = document.querySelector<HTMLInputElement>('input[type="text"]');
			expect(input).toBeDefined();
			expect(input?.disabled).toBe(false);
		});

		it('提案ボタンは未入力時のみ disabled（入力で有効化される）', () => {
			render(AiSuggestPanel, props);
			const btn = document.querySelector<HTMLButtonElement>('button[type="button"]');
			// 入力が空なので disabled、ただし !isPremium ではなく !aiInput.trim() が理由
			expect(btn?.disabled).toBe(true);
		});
	});

	// ============================================================
	// デフォルト props（isPremium 省略時は false 扱い）
	// ============================================================

	describe('isPremium 省略時', () => {
		it('デフォルトは free 扱い（ロック表示）', () => {
			render(AiSuggestPanel, { onaccept: () => {} });
			expect(screen.getByTestId('ai-suggest-panel').getAttribute('data-plan-locked')).toBe('true');
			expect(screen.getByTestId('ai-suggest-upgrade-cta')).toBeDefined();
		});
	});
});
