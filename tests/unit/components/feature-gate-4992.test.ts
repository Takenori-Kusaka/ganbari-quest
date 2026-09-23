// tests/unit/components/feature-gate-4992.test.ts
//
// #4992: 無料プランのごほうび「編集」を、押す前に理由が読める形でロック表示する。
// admin/rewards は FeatureGate (§10.2 パターン A) を使うため、FeatureGate に次を足した:
//   - unlocked: 呼び出し側が判定済みの解放状態。tier / quota より優先する
//     (ごほうび管理は server の拒否と同じ述語 isCustomRewardUnlocked で判定する、#4584)
//   - describedBy: ロック中の trigger の aria-describedby (画面に常時出している理由の id)
//   - testid: 一覧の各行に置くときの区別
//
// 観点:
//   - ロック中の trigger は native disabled にしない (フォーカスでき、押すと理由の popover が開く)
//   - aria-disabled="true" で「実行できない」ことを支援技術に伝える
//   - 解放時は children (本物の操作) をそのまま描画し、ゲート痕跡を残さない

import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FeatureGate from '../../../src/lib/ui/components/FeatureGate.svelte';

const children = createRawSnippet(() => ({
	render: () => '<button type="button" data-testid="gated-action">編集</button>',
}));

describe('FeatureGate — 呼び出し側の判定を使うロック表示 (#4992)', () => {
	afterEach(() => {
		cleanup();
	});

	it('unlocked=false なら tier が最上位でもロック表示になる (呼び出し側の述語が優先)', () => {
		render(FeatureGate, {
			currentTier: 'family',
			requiredTier: 'standard',
			unlocked: false,
			display: 'inline',
			buttonLabel: '編集',
			children,
		});
		expect(screen.getByTestId('feature-gate-locked-trigger')).toBeTruthy();
		expect(screen.queryByTestId('gated-action')).toBeNull();
	});

	it('unlocked=true なら tier が free でも本物の操作を描画し、ゲート痕跡を残さない', () => {
		render(FeatureGate, {
			currentTier: 'free',
			requiredTier: 'standard',
			unlocked: true,
			display: 'inline',
			buttonLabel: '編集',
			children,
		});
		expect(screen.getByTestId('gated-action')).toBeTruthy();
		expect(screen.queryByTestId('feature-gate-locked-trigger')).toBeNull();
	});

	it('unlocked 未指定なら従来どおり tier で判定する (free はロック / family は解放)', () => {
		render(FeatureGate, {
			currentTier: 'free',
			requiredTier: 'standard',
			display: 'inline',
			buttonLabel: '編集',
			children,
		});
		expect(screen.getByTestId('feature-gate-locked-trigger')).toBeTruthy();
		cleanup();

		render(FeatureGate, {
			currentTier: 'family',
			requiredTier: 'standard',
			display: 'inline',
			buttonLabel: '編集',
			children,
		});
		expect(screen.getByTestId('gated-action')).toBeTruthy();
	});

	it('ロック中の trigger は理由の要素を aria-describedby で指し、testid を差し替えられる', () => {
		render(FeatureGate, {
			currentTier: 'free',
			requiredTier: 'standard',
			unlocked: false,
			display: 'inline',
			buttonLabel: '編集',
			describedBy: 'reward-edit-gate-note',
			testid: 'reward-edit-locked-btn-7',
			children,
		});
		const trigger = screen.getByTestId('reward-edit-locked-btn-7');
		expect(trigger.getAttribute('aria-describedby')).toBe('reward-edit-gate-note');
		expect(trigger.textContent).toContain('編集');
		expect(trigger.textContent).toContain('🔒');
	});

	it('ロック中の trigger は native disabled にせず aria-disabled で表す (押すと理由が開ける)', () => {
		render(FeatureGate, {
			currentTier: 'free',
			requiredTier: 'standard',
			unlocked: false,
			display: 'inline',
			buttonLabel: '編集',
			children,
		});
		const trigger = screen.getByTestId('feature-gate-locked-trigger') as HTMLButtonElement;
		expect(trigger.tagName).toBe('BUTTON');
		expect(trigger.disabled).toBe(false);
		expect(trigger.getAttribute('aria-disabled')).toBe('true');
	});

	it('describedBy 未指定なら aria-describedby を付けない (存在しない id を指さない)', () => {
		render(FeatureGate, {
			currentTier: 'free',
			requiredTier: 'standard',
			display: 'inline',
			buttonLabel: '編集',
			children,
		});
		const trigger = screen.getByTestId('feature-gate-locked-trigger');
		expect(trigger.hasAttribute('aria-describedby')).toBe(false);
	});
});
