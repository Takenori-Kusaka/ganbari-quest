// tests/unit/domain/labels-phase7-pr2b.test.ts
//
// Phase 7 PR-2b (#2697): labels.ts に新規追加した 5 compound の値検証 + atom 経由
// template literal 参照確認 + 補強 PR #2684 (代替案 D) 命名変更整合性検証。
//
// 検証対象 compound (Phase 5 子 5 #2656 §4 + Phase 4 #2621 §3.1 + 補強 PR #2684):
//   1. SUBSCRIPTION_PAGE_LABELS         — /admin/subscription プランページ (Phase 3 #2567)
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
	LP_PRICING_LABELS,
	PHASE4_REACTIVATION_FLOW_LABELS,
	SUBSCRIPTION_PAGE_LABELS,
} from '../../../src/lib/domain/labels';
import {
	CANCEL_TERMS,
	CTA_TERMS,
	PLAN_CHANGE_TERMS,
	PLAN_FULL_TERMS,
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

	// #4501: `trialActive` は参照ゼロの dead label だった (実際に画面へ出るのは
	// `trialActiveTitle`)。同じ概念の label が 2 つあると、片方だけ直して食い違う
	// (実際 trialActive=premium / trialActiveTitle=standard と割れていた)。dead な方を
	// 撤去し、**生きている方**に同じ不変条件を移す (検査対象を失わせない)。
	it('trial active 中の表示は PLAN_FULL_TERMS.premium 経由 (atom 直書きなし)', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.trialActiveTitle).toContain(PLAN_FULL_TERMS.premium);
		expect(SUBSCRIPTION_PAGE_LABELS.trialActiveTitle).toBe(
			`${PLAN_FULL_TERMS.premium} トライアル中`,
		);
	});

	it('アップグレード CTA は PLAN_FULL_TERMS.premium 経由 (Kinde what happens when clicked 原則)', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.upgradeCta).toContain(PLAN_FULL_TERMS.premium);
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

// ============================================================

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

	// #4510: faqPurchaseSteps は **配線ゼロのまま配信されていた dead payload** で、Step3 は
	// 「カード情報を入力すると無料体験が始まります（カード登録不要）」という自己矛盾かつ
	// 実装と逆 (Checkout は即時課金) の文言だった。配線された瞬間に虚偽表示になるため
	// group ごと削除した。**復活したら落ちる**形に置き換える (assertion の弱体化ではなく、
	// 誤った文言を守っていた検査の反転 — ADR-0006)。
	it('faqPurchaseSteps は削除されている (未配線 + 実装と逆の文言だった)', () => {
		for (const key of [
			'faqPurchaseStepsQ',
			'faqPurchaseStepsAIntro',
			'faqPurchaseStepsStep1',
			'faqPurchaseStepsStep2',
			'faqPurchaseStepsStep3',
		]) {
			expect(LP_PRICING_LABELS, `${key} が復活しています`).not.toHaveProperty(key);
		}
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
		expect(SUBSCRIPTION_PAGE_LABELS.trialActiveTitle).toBe(
			`${PLAN_FULL_TERMS.premium} トライアル中`,
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
// #4502: UPGRADE_FLOW_LABELS / IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS は削除済み。
// #4166 で proration 表示と確認 UI を Stripe Customer Portal に委譲したため、自社確認 UI
// 向けに書かれたこれらの文言は「作らないと決めた画面のテキスト」になった。
// **旧 export が復活したら落ちる**形で pin する (作らない決定が静かに戻らないようにする)。
describe('#4502 Portal 委譲で不採用になった文言 namespace が復活していない', () => {
	it('UPGRADE_FLOW_LABELS / IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS / 旧名 が export されていない', async () => {
		const labels = await import('../../../src/lib/domain/labels');
		expect(labels).not.toHaveProperty('UPGRADE_FLOW_LABELS');
		expect(labels).not.toHaveProperty('IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS');
		expect(labels).not.toHaveProperty('SCHEDULED_DOWNGRADE_BANNER_LABELS');
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
