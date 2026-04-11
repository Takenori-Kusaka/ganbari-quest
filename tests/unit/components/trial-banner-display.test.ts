// tests/unit/components/trial-banner-display.test.ts
// #777 — TrialBanner の 5 状態表示（not-started / active x2 / expired / suppressed）
//
// 本来 Issue は Playwright E2E (`trial-banner-display.spec.ts`) を提案しているが、
// E2E で TrialBanner の各状態を再現するには DEBUG_PLAN/DEBUG_TRIAL (#758) を
// playwright.config.ts の webServer.env 経由で切替える必要があり、state ごとに
// サーバー再起動が要る。既存 E2E に DEBUG_* 経由のパターンがまだなく、本 Issue
// の目的は「5 状態の分岐と表示内容を保証する」ことなので、@testing-library/svelte
// でコンポーネント単体を jsdom にマウントして検証する。この方式なら props を
// 直接渡せるため、全 5 状態を高速に網羅できる。
//
// 将来、admin 画面側の DEBUG_PLAN 起動 E2E セットアップが入れば上位テストとして
// 別 spec を追加してよい。コンポーネントの分岐が変わった時の安全網としては
// 本ユニットテストで十分。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TrialBanner from '../../../src/lib/features/admin/components/TrialBanner.svelte';

describe('TrialBanner 表示', () => {
	afterEach(() => {
		cleanup();
	});

	// ============================================================
	// 1) not-started: 未利用 free ユーザー
	// ============================================================

	describe('not-started 状態', () => {
		const props = {
			isTrialActive: false,
			daysRemaining: 0,
			trialUsed: false,
			trialEndDate: null,
			planTier: 'free' as const,
		};

		it('「7日間 無料で試す」ボタンが表示される', () => {
			render(TrialBanner, props);
			const btn = screen.getByTestId('trial-banner-start-button');
			expect(btn).toBeDefined();
			expect(btn.textContent).toContain('7日間');
		});

		it('not-started コンテナが描画される', () => {
			render(TrialBanner, props);
			expect(screen.getByTestId('trial-banner-not-started')).toBeDefined();
		});

		it('active / expired の CTA は描画されない', () => {
			render(TrialBanner, props);
			expect(screen.queryByTestId('trial-banner-active-cta')).toBeNull();
			expect(screen.queryByTestId('trial-banner-expired-cta')).toBeNull();
		});
	});

	// ============================================================
	// 2) active（残り 7 日 — 通常）
	// ============================================================

	describe('active 状態（残り 7 日）', () => {
		const props = {
			isTrialActive: true,
			daysRemaining: 7,
			trialUsed: true,
			trialEndDate: '2099-12-31',
			planTier: 'free' as const,
		};

		it('「残り7日」表記と「プランを見る」CTA が表示される', () => {
			render(TrialBanner, props);
			const cta = screen.getByTestId('trial-banner-active-cta');
			expect(cta).toBeDefined();
			expect(cta.getAttribute('href')).toBe('/admin/license');

			// タイトル本文に残り日数が含まれる
			expect(document.body.textContent).toContain('残り7日');
		});

		it('not-started / expired CTA は描画されない', () => {
			render(TrialBanner, props);
			expect(screen.queryByTestId('trial-banner-not-started')).toBeNull();
			expect(screen.queryByTestId('trial-banner-expired-cta')).toBeNull();
		});
	});

	// ============================================================
	// 3) active（残り 1 日 — urgent）
	// ============================================================

	describe('active 状態（残り 1 日 — urgent）', () => {
		const props = {
			isTrialActive: true,
			daysRemaining: 1,
			trialUsed: true,
			trialEndDate: '2099-12-31',
			planTier: 'free' as const,
		};

		it('「明日で終了します」のタイトルが表示される', () => {
			render(TrialBanner, props);
			expect(document.body.textContent).toContain('明日で終了');
		});

		it('urgent クラスがバナーに付く', () => {
			const { container } = render(TrialBanner, props);
			const banner = container.querySelector('.trial-banner');
			expect(banner).not.toBeNull();
			expect(banner?.classList.contains('urgent')).toBe(true);
		});

		it('active CTA（プランを見る）は引き続き描画される', () => {
			render(TrialBanner, props);
			expect(screen.getByTestId('trial-banner-active-cta')).toBeDefined();
		});
	});

	// ============================================================
	// 4) expired: 利用済み + 非アクティブ
	// ============================================================

	describe('expired 状態', () => {
		const props = {
			isTrialActive: false,
			daysRemaining: 0,
			trialUsed: true,
			trialEndDate: '2026-01-01',
			planTier: 'free' as const,
		};

		it('アップグレード CTA が表示される', () => {
			render(TrialBanner, props);
			const cta = screen.getByTestId('trial-banner-expired-cta');
			expect(cta).toBeDefined();
			expect(cta.getAttribute('href')).toBe('/admin/license');
			expect(cta.textContent).toContain('アップグレード');
		});

		it('not-started 状態は描画されない（再開不可 = used=true ルール）', () => {
			render(TrialBanner, props);
			expect(screen.queryByTestId('trial-banner-not-started')).toBeNull();
			expect(screen.queryByTestId('trial-banner-start-button')).toBeNull();
		});

		it('expired タイトル「無料体験が終了しました」が表示される', () => {
			render(TrialBanner, props);
			expect(document.body.textContent).toContain('無料体験が終了しました');
		});
	});

	// ============================================================
	// 5) 有料プラン: バナーは一切描画されない
	// ============================================================

	describe('有料プラン（バナー非表示）', () => {
		it('standard プランでは何も描画されない', () => {
			const { container } = render(TrialBanner, {
				isTrialActive: false,
				daysRemaining: 0,
				trialUsed: false,
				trialEndDate: null,
				planTier: 'standard',
			});
			// コンポーネントは {#if ...} チェーンで全て偽なら何も出力しない
			expect(container.querySelector('.trial-banner')).toBeNull();
		});

		it('family プランでもバナーは描画されない', () => {
			const { container } = render(TrialBanner, {
				isTrialActive: false,
				daysRemaining: 0,
				trialUsed: false,
				trialEndDate: null,
				planTier: 'family',
			});
			expect(container.querySelector('.trial-banner')).toBeNull();
		});
	});
});
