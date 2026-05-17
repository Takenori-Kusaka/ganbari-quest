// tests/unit/ui/activity-card-must.test.ts
// #2146 — ActivityCard `isMust` prop (priority='must' のカード演出統合) の検証
//
// 旧 `MustProgressBar.svelte` 専用セクションを撤去し、ActivityCard 自身に
// 「⭐ おやくそく」ribbon badge + gold border を表示する設計（#2146 AC2）。
// ADR-0012 anti-engagement 原則準拠で、完了時の追加アニメーションは行わない。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { UI_COMPONENTS_LABELS } from '../../../src/lib/domain/labels';
import ActivityCard from '../../../src/lib/ui/components/ActivityCard.svelte';

const BASE_PROPS = {
	activityId: 100,
	icon: '🦷',
	name: 'はみがき',
	categoryId: 3, // life カテゴリ
};

describe('#2146 ActivityCard isMust prop', () => {
	afterEach(() => cleanup());

	describe('badge / class 表示判定', () => {
		it('isMust=false (default) のとき ribbon badge は描画されない', () => {
			render(ActivityCard, { ...BASE_PROPS });
			expect(screen.queryByTestId('must-ribbon-100')).toBeNull();
		});

		it('isMust=true && completed=false のとき ribbon badge が表示される', () => {
			render(ActivityCard, { ...BASE_PROPS, isMust: true });
			const ribbon = screen.getByTestId('must-ribbon-100');
			expect(ribbon).not.toBeNull();
			expect(ribbon.textContent?.trim()).toBe(UI_COMPONENTS_LABELS.activityCardMustBadge);
		});

		it('isMust=true && completed=true のとき ribbon badge は非表示（anti-engagement 準拠）', () => {
			render(ActivityCard, { ...BASE_PROPS, isMust: true, completed: true });
			expect(screen.queryByTestId('must-ribbon-100')).toBeNull();
		});

		it('isMust=true のとき button に data-must="1" が付与される', () => {
			const { container } = render(ActivityCard, { ...BASE_PROPS, isMust: true });
			const btn = container.querySelector('[data-testid="activity-card-100"]');
			expect(btn?.getAttribute('data-must')).toBe('1');
		});

		it('isMust=false のとき data-must 属性は付与されない', () => {
			const { container } = render(ActivityCard, { ...BASE_PROPS, isMust: false });
			const btn = container.querySelector('[data-testid="activity-card-100"]');
			expect(btn?.hasAttribute('data-must')).toBe(false);
		});

		it('isMust=true && completed=false のとき card-must class が button に付く', () => {
			const { container } = render(ActivityCard, { ...BASE_PROPS, isMust: true });
			const btn = container.querySelector('[data-testid="activity-card-100"]');
			expect(btn?.classList.contains('card-must')).toBe(true);
		});
	});

	describe('aria-label への must サフィックス追加', () => {
		it('isMust=true で aria-label に「（今日のおやくそく）」が含まれる', () => {
			render(ActivityCard, { ...BASE_PROPS, isMust: true });
			const btn = screen.getByLabelText(/はみがき/);
			expect(btn.getAttribute('aria-label')).toContain(UI_COMPONENTS_LABELS.activityCardMust);
		});

		it('isMust=true && completed=true は completed サフィックスのみ（must サフィックスは付かない）', () => {
			render(ActivityCard, { ...BASE_PROPS, isMust: true, completed: true });
			const btn = screen.getByLabelText(/はみがき/);
			const label = btn.getAttribute('aria-label') ?? '';
			expect(label).toContain(UI_COMPONENTS_LABELS.activityCardCompleted);
			expect(label).not.toContain(UI_COMPONENTS_LABELS.activityCardMust);
		});
	});

	describe('main-quest / mission との同時表示優先順位', () => {
		it('isMainQuest=true && isMust=true のとき main quest badge が優先表示される', () => {
			render(ActivityCard, { ...BASE_PROPS, isMainQuest: true, isMust: true });
			// main-quest badge が存在
			const btn = screen.getByLabelText(/はみがき/);
			expect(btn.classList.contains('card-main-quest')).toBe(true);
			// must badge は同時に出る（左上 vs 右上で重ならない位置）
			expect(screen.getByTestId('must-ribbon-100')).not.toBeNull();
		});

		it('isMission=true && isMust=true のとき mission の breathing-glow と must badge が共存', () => {
			render(ActivityCard, { ...BASE_PROPS, isMission: true, isMust: true });
			const btn = screen.getByLabelText(/はみがき/);
			expect(btn.classList.contains('card-mission')).toBe(true);
			expect(screen.getByTestId('must-ribbon-100')).not.toBeNull();
		});
	});

	describe('SSOT labels 参照', () => {
		it('UI_COMPONENTS_LABELS.activityCardMustBadge が定義されている', () => {
			expect(UI_COMPONENTS_LABELS.activityCardMustBadge).toBeDefined();
			expect(UI_COMPONENTS_LABELS.activityCardMustBadge).toContain('おやくそく');
		});

		it('UI_COMPONENTS_LABELS.activityCardMust が定義されている (aria-label 用)', () => {
			expect(UI_COMPONENTS_LABELS.activityCardMust).toBeDefined();
			expect(UI_COMPONENTS_LABELS.activityCardMust).toContain('今日のおやくそく');
		});
	});
});
