// tests/unit/domain/labels-phase7-pr2b.test.ts
//
// Phase 7 PR-2b (#2697): labels.ts に新規追加した 5 compound の値検証 + atom 経由
// template literal 参照確認 + 補強 PR #2684 (代替案 D) 命名変更整合性検証。
//
// 検証対象 compound (Phase 5 子 5 #2656 §4 + Phase 4 #2621 §3.1 + 補強 PR #2684):
//   1. SUBSCRIPTION_PAGE_LABELS         — /admin/subscription プランページ (Phase 3 #2567)
//   2. UPGRADE_FLOW_LABELS              — アップグレード動線 4 段階 funnel (Phase 4 #2624)
//   3. IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS — 即時ダウン + Stripe credit memo banner
//      (旧 SCHEDULED_DOWNGRADE_BANNER_LABELS、補強 PR #2684 / 代替案 D で命名変更)
//   4. PHASE4_REACTIVATION_FLOW_LABELS  — reactivation banner 動線 (Phase 4 #2623)
//   5. LP_PRICING_LABELS 拡張           — LP pricing CTA / FAQ (Phase 4 #2621 §3.1 + §4.1 + §4.2)
//
// 設計 SSOT:
//   - docs/decisions/0045-terms-ssot-2-layer.md §3.3 (atom / compound 責務分離)
//   - docs/design/billing-redesign/phase5-atom-ssot-architecture.md §4 配置確定
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §3.8 R8 (credit memo 信頼毀損対処)
//   - docs/design/billing-redesign/phase5-stripe-product-architecture.md §代替案 D
//   - docs/design/billing-redesign/phase5-proration-architecture.md (即時 + always_invoice)
//   - docs/design/billing-redesign/phase3-subscription-page-ui-design.md §文言 atom
//   - docs/design/billing-redesign/phase4-upgrade-flow-design.md §4.2
//   - docs/design/billing-redesign/phase4-reactivation-flow-design.md §5
//   - docs/design/billing-redesign/phase4-lp-app-flow-design.md §3.1 / §4.1 / §4.2

import { describe, expect, it } from 'vitest';
import {
	IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS,
	LP_PRICING_LABELS,
	PHASE4_REACTIVATION_FLOW_LABELS,
	SUBSCRIPTION_PAGE_LABELS,
	UPGRADE_FLOW_LABELS,
} from '../../../src/lib/domain/labels';
import {
	CANCEL_TERMS,
	CTA_TERMS,
	PLAN_CHANGE_TERMS,
	PLAN_FULL_TERMS,
	TOKUSHOHO_TERMS,
	TRIAL_TERMS,
} from '../../../src/lib/domain/terms';

// ============================================================
// 1. SUBSCRIPTION_PAGE_LABELS (Phase 3 #2567 §文言 atom 確定 9 key)
// ============================================================
describe('SUBSCRIPTION_PAGE_LABELS (Phase 3 #2567、Phase 7 PR-2b #2697)', () => {
	it('ページタイトル + 現在のプラン見出しを持つ', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.pageTitle).toBe('ご家族のプラン管理');
		expect(SUBSCRIPTION_PAGE_LABELS.currentPlan).toBe('現在のプラン');
	});

	it('trial active 中の表示は PLAN_FULL_TERMS.family + TRIAL_TERMS.durationSpaced 経由 (atom 直書きなし)', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.trialActive).toContain(PLAN_FULL_TERMS.family);
		expect(SUBSCRIPTION_PAGE_LABELS.trialActive).toContain(TRIAL_TERMS.durationSpaced);
		expect(SUBSCRIPTION_PAGE_LABELS.trialActive).toBe(
			`${PLAN_FULL_TERMS.family}${TRIAL_TERMS.durationSpaced}無料体験中`,
		);
	});

	it('アップグレード CTA は PLAN_FULL_TERMS.family 経由 (Kinde what happens when clicked 原則)', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.upgradeCta).toContain(PLAN_FULL_TERMS.family);
	});

	it('cancelAnytime は CANCEL_TERMS.anytimeOk 経由', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.cancelAnytime).toBe(CANCEL_TERMS.anytimeOk);
	});

	it('noCreditCard は TRIAL_TERMS.noCreditCardMid 経由', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.noCreditCard).toBe(TRIAL_TERMS.noCreditCardMid);
	});

	it('V4 framing 軸 decoy bait standardRecommendBadge を持つ (Phase 1 補強 2 F9 解消)', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.standardRecommendBadge).toBe('✓ お勧め');
	});

	it('cancelLink は CANCEL_TERMS.canonical 経由 (frictionless Kinde 整合)', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.cancelLink).toContain(CANCEL_TERMS.canonical);
	});
});

// ============================================================
// 2. UPGRADE_FLOW_LABELS (Phase 4 #2624 §4.2 確定 5 method)
// ============================================================
describe('UPGRADE_FLOW_LABELS (Phase 4 #2624、Phase 7 PR-2b #2697)', () => {
	it('contextFromFeatureGate は 2 引数 (featureLabel, tierLabel) で context line を生成する', () => {
		const result = UPGRADE_FLOW_LABELS.contextFromFeatureGate('AI 提案', 'スタンダードプラン');
		expect(result).toContain('AI 提案');
		expect(result).toContain('スタンダードプラン');
		expect(result).toContain('アップグレード');
	});

	it('contextFromTrialEnd は tierLabel で trial 終了 context を生成する', () => {
		const result = UPGRADE_FLOW_LABELS.contextFromTrialEnd('ファミリープラン');
		expect(result).toContain('体験は終了');
		expect(result).toContain('ファミリープラン');
		expect(result).toContain('アップグレード');
	});

	it('contextFromHeaderBadge は空文字列 (Phase 3 #2573 6 ブロック構造をそのまま表示)', () => {
		expect(UPGRADE_FLOW_LABELS.contextFromHeaderBadge).toBe('');
	});

	it('contextFromBanner は tierLabel で上限到達 context を生成する', () => {
		const result = UPGRADE_FLOW_LABELS.contextFromBanner('ファミリープラン');
		expect(result).toContain('上限到達');
		expect(result).toContain('ファミリープラン');
	});

	it('contextFallback は空文字列 (?from パラメータ非該当時の安全フォールバック)', () => {
		expect(UPGRADE_FLOW_LABELS.contextFallback).toBe('');
	});
});

// ============================================================
// 3. IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS (補強 PR #2684 / 代替案 D)
// ============================================================
describe('IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS (補強 PR #2684、Phase 7 PR-2b #2697)', () => {
	it('completedTitle は targetPlan を含む即時ダウン完了 banner title を生成する', () => {
		const result = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.completedTitle('スタンダードプラン');
		expect(result).toContain('スタンダードプラン');
		expect(result).toContain('切り替わりました');
	});

	it('creditBalanceLine は credit memo 残高 + 次回控除見込み透明性を伝達する (R8 対処の核)', () => {
		const result = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.creditBalanceLine(
			'¥280',
			'2026年6月15日',
		);
		expect(result).toContain('¥280');
		expect(result).toContain('2026年6月15日');
		expect(result).toContain('次回ご請求');
		expect(result).toContain('自動的に差し引かれます');
	});

	it('archiveNotice は PLAN_CHANGE_TERMS.archiveVerb + restore atom 経由 (atom 直書きなし)', () => {
		const result = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.archiveNotice(3, 25);
		expect(result).toContain('3');
		expect(result).toContain('25');
		expect(result).toContain(PLAN_CHANGE_TERMS.archiveVerb);
		expect(result).toContain(PLAN_CHANGE_TERMS.restore);
	});

	it('ctaReactivate は sourcePlan を含むアップグレード CTA を生成する', () => {
		const result = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.ctaReactivate('ファミリープラン');
		expect(result).toContain('ファミリープラン');
		expect(result).toContain('戻す');
	});

	it('ctaReactivateAria は PLAN_CHANGE_TERMS.changeVerb 経由', () => {
		expect(IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.ctaReactivateAria).toContain(
			PLAN_CHANGE_TERMS.changeVerb,
		);
	});

	it('viewBillingHistoryLink + dismissAriaLabel を持つ', () => {
		expect(IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.viewBillingHistoryLink).toBe(
			'ご請求履歴で credit memo を確認する',
		);
		expect(IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.dismissAriaLabel).toBe('バナーを閉じる');
	});

	it('ADR-0012 Anti-engagement 整合: 「失う / 消える / 使えなくなる」文言を含まない', () => {
		const completedTitle = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.completedTitle('standard');
		const creditBalance = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.creditBalanceLine(
			'¥280',
			'2026/6/15',
		);
		const archiveNotice = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.archiveNotice(1, 1);
		const ctaReactivate = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.ctaReactivate('family');

		for (const value of [completedTitle, creditBalance, archiveNotice, ctaReactivate]) {
			expect(value).not.toMatch(/失う|消える|使えなくなる|ロックされる/);
		}
	});
});

// ============================================================
// 4. PHASE4_REACTIVATION_FLOW_LABELS (Phase 4 #2623 §文言 atom 確定 6 method)
// ============================================================
describe('PHASE4_REACTIVATION_FLOW_LABELS (Phase 4 #2623、Phase 7 PR-2b #2697)', () => {
	it('bannerDismissAriaLabel + bannerDismissHint を持つ (session storage 再表示の透明性)', () => {
		expect(PHASE4_REACTIVATION_FLOW_LABELS.bannerDismissAriaLabel).toBe('バナーを閉じる');
		expect(PHASE4_REACTIVATION_FLOW_LABELS.bannerDismissHint).toBe(
			'次回タブを開くまで表示されません',
		);
	});

	it('contextFromBanner は total + PLAN_CHANGE_TERMS.restore 経由 (atom 直書きなし)', () => {
		const result = PHASE4_REACTIVATION_FLOW_LABELS.contextFromBanner(5);
		expect(result).toContain('5件');
		expect(result).toContain(PLAN_CHANGE_TERMS.restore);
	});

	it('contextFromListing は total + PLAN_CHANGE_TERMS.restore 経由', () => {
		const result = PHASE4_REACTIVATION_FLOW_LABELS.contextFromListing(99);
		expect(result).toContain('99件');
		expect(result).toContain(PLAN_CHANGE_TERMS.restore);
	});

	it('confirmContext は total + PLAN_CHANGE_TERMS.restore 経由', () => {
		const result = PHASE4_REACTIVATION_FLOW_LABELS.confirmContext(10);
		expect(result).toContain('10件');
		expect(result).toContain(PLAN_CHANGE_TERMS.restore);
	});

	it('toastReactivationSuccess は total + PLAN_CHANGE_TERMS.restore 経由', () => {
		const result = PHASE4_REACTIVATION_FLOW_LABELS.toastReactivationSuccess(7);
		expect(result).toContain('7件');
		expect(result).toContain(PLAN_CHANGE_TERMS.restore);
		expect(result).toContain('しました');
	});

	it('ADR-0012 Anti-engagement 整合: 「失う / 消える / 使えなくなる」文言を含まない', () => {
		const total = 5;
		const allValues = [
			PHASE4_REACTIVATION_FLOW_LABELS.bannerDismissAriaLabel,
			PHASE4_REACTIVATION_FLOW_LABELS.bannerDismissHint,
			PHASE4_REACTIVATION_FLOW_LABELS.contextFromBanner(total),
			PHASE4_REACTIVATION_FLOW_LABELS.contextFromListing(total),
			PHASE4_REACTIVATION_FLOW_LABELS.confirmContext(total),
			PHASE4_REACTIVATION_FLOW_LABELS.toastReactivationSuccess(total),
		];
		for (const value of allValues) {
			expect(value).not.toMatch(/失う|消える|使えなくなる|ロックされる/);
		}
	});
});

// ============================================================
// 5. LP_PRICING_LABELS 拡張 (Phase 4 #2621 §3.1 + §4.1 + §4.2)
// ============================================================
describe('LP_PRICING_LABELS 拡張 (Phase 4 #2621、Phase 7 PR-2b #2697)', () => {
	it('ctaTrialVerb は TRIAL_TERMS.duration + CTA_TERMS.freeTrialVerb 経由 (= "7日間無料で試す")', () => {
		expect(LP_PRICING_LABELS.ctaTrialVerb).toBe(
			`${TRIAL_TERMS.duration}${CTA_TERMS.freeTrialVerb}`,
		);
	});

	it('faqPurchaseSteps: 質問 + 導入 + 3 ステップを持つ', () => {
		expect(LP_PRICING_LABELS.faqPurchaseStepsQ).toContain('どうやって');
		expect(LP_PRICING_LABELS.faqPurchaseStepsAIntro).toContain('3 ステップ');
		expect(LP_PRICING_LABELS.faqPurchaseStepsStep1).toContain(CTA_TERMS.freeTrialVerb);
		expect(LP_PRICING_LABELS.faqPurchaseStepsStep2).toContain('プラン');
		expect(LP_PRICING_LABELS.faqPurchaseStepsStep3).toContain(TOKUSHOHO_TERMS.heading6Important);
		expect(LP_PRICING_LABELS.faqPurchaseStepsStep3).toContain(TRIAL_TERMS.duration);
		expect(LP_PRICING_LABELS.faqPurchaseStepsStep3).toContain(TRIAL_TERMS.noCreditCardMid);
	});

	it('faqCancelSteps: 質問 + 導入 + 3 ステップ + closing を持つ', () => {
		expect(LP_PRICING_LABELS.faqCancelStepsQ).toContain(CANCEL_TERMS.canonicalVerb);
		expect(LP_PRICING_LABELS.faqCancelStepsAIntro).toContain('3 ステップ');
		expect(LP_PRICING_LABELS.faqCancelStepsAIntro).toContain(CANCEL_TERMS.canonicalVerb);
		expect(LP_PRICING_LABELS.faqCancelStepsStep1).toContain('ログイン');
		expect(LP_PRICING_LABELS.faqCancelStepsStep2).toContain('Stripe');
		expect(LP_PRICING_LABELS.faqCancelStepsStep3).toContain(CANCEL_TERMS.canonicalVerb);
		expect(LP_PRICING_LABELS.faqCancelStepsClosing).toContain(CANCEL_TERMS.anytimeOk);
	});
});

// ============================================================
// 共通整合性: ADR-0045 §3.3 atom 直書き複製禁止
// ============================================================
describe('ADR-0045 §3.3 atom 直書き複製禁止 (Phase 7 PR-2b 5 compound 整合性)', () => {
	it('SUBSCRIPTION_PAGE_LABELS 内に atom 値の文字列リテラル直書きが存在しない', () => {
		// atom 値はすべて `${...}` template literal 経由参照されること
		// (静的検証は check-no-plan-literals.mjs が担当、ここでは値整合のみ assert)
		expect(SUBSCRIPTION_PAGE_LABELS.trialActive).toBe(
			`${PLAN_FULL_TERMS.family}${TRIAL_TERMS.durationSpaced}無料体験中`,
		);
		expect(SUBSCRIPTION_PAGE_LABELS.cancelAnytime).toBe(CANCEL_TERMS.anytimeOk);
		expect(SUBSCRIPTION_PAGE_LABELS.noCreditCard).toBe(TRIAL_TERMS.noCreditCardMid);
	});

	it('LP_PRICING_LABELS.ctaTrialVerb は terms.ts atom 2 件結合 (compound 例)', () => {
		expect(LP_PRICING_LABELS.ctaTrialVerb).toBe(
			`${TRIAL_TERMS.duration}${CTA_TERMS.freeTrialVerb}`,
		);
	});
});

// ============================================================
// 補強 PR #2684 命名変更整合: SCHEDULED_DOWNGRADE_BANNER_LABELS → IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS
// ============================================================
describe('補強 PR #2684 命名変更整合性 (代替案 D 採用に伴う rename)', () => {
	it('IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS の文言は「期末ダウン予約」ではなく「即時ダウン完了 + credit memo」文脈', () => {
		// 旧 SCHEDULED_DOWNGRADE_BANNER_LABELS は「次回 YYYY/M/D から ${targetPlan} に切り替わります」
		// 等の「期末ダウン予約」文脈だったが、代替案 D で「ダウン即時完了 + credit memo 残高表示」に変更。
		// 本テストは命名変更後の文脈整合性を assert する。
		const completedTitle = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.completedTitle('スタンダード');
		// 完了形「切り替わりました」を含む (旧版「切り替わります」予約形ではない)
		expect(completedTitle).toContain('切り替わりました');
		expect(completedTitle).not.toContain('切り替わります');

		// credit memo 残高表示が主訴求
		const creditBalance = IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS.creditBalanceLine(
			'¥500',
			'2026/7/1',
		);
		expect(creditBalance).toContain('次回ご請求');
		expect(creditBalance).toContain('自動的に差し引かれます');
	});

	it('SCHEDULED_DOWNGRADE_BANNER_LABELS export は存在しない (旧名 export 残存しないことを assert)', async () => {
		// dynamic import で labels module の全 export を取得し、旧 namespace 名がないことを確認
		const labels = await import('../../../src/lib/domain/labels');
		expect(labels).not.toHaveProperty('SCHEDULED_DOWNGRADE_BANNER_LABELS');
		expect(labels).toHaveProperty('IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS');
	});
});

// ============================================================
// LICENSE_PAGE_LABELS alias 共存確認 (PR-2c #2699 で SUBSCRIPTION_PAGE_LABELS に rename + 統合済)
// ============================================================
//
// Phase 7 PR-2c (#2699) で `LICENSE_PAGE_LABELS` (96 key) を `SUBSCRIPTION_PAGE_LABELS` (105 key) に
// rename + 既存 9 key と統合。`LICENSE_PAGE_LABELS` は alias export として共存期間中存続する。
describe('LICENSE_PAGE_LABELS alias と SUBSCRIPTION_PAGE_LABELS 共存 (Phase 7 PR-2c #2699 で rename + 統合済)', () => {
	it('LICENSE_PAGE_LABELS は alias として残存し、SUBSCRIPTION_PAGE_LABELS と同一参照を返す', async () => {
		const labels = await import('../../../src/lib/domain/labels');
		expect(labels).toHaveProperty('LICENSE_PAGE_LABELS');
		expect(labels).toHaveProperty('SUBSCRIPTION_PAGE_LABELS');
		// alias は本体と同一参照
		expect(labels.LICENSE_PAGE_LABELS).toBe(labels.SUBSCRIPTION_PAGE_LABELS);
	});
});
