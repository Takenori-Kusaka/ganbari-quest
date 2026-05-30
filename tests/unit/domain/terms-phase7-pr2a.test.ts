// tests/unit/domain/terms-phase7-pr2a.test.ts
//
// Phase 7 PR-2a (#2688): terms.ts に新規追加した 3 atom (PLAN_CHANGE_TERMS /
// TOKUSHOHO_TERMS / CHECKOUT_SUCCESS_TERMS) の値検証 + `as const` 型安全検証。
//
// 設計 SSOT:
//   - docs/design/billing-redesign/phase5-atom-ssot-architecture.md §2 原則 3 / §3
//   - docs/design/billing-redesign/phase3-archived-resource-reactivation-ui-design.md
//   - docs/design/billing-redesign/phase3-subscription-confirm-tokushoho-ui-design.md §4.1
//   - docs/design/billing-redesign/phase3-checkout-success-polling-ui-design.md
//   - docs/decisions/0045-terms-ssot-2-layer.md
//   - docs/decisions/0049-retention-physical-delete-extended.md (free / paid variant)

import { describe, expect, it } from 'vitest';
import {
	CHECKOUT_SUCCESS_TERMS,
	PLAN_CHANGE_TERMS,
	TOKUSHOHO_TERMS,
} from '../../../src/lib/domain/terms';

describe('PLAN_CHANGE_TERMS (Phase 5 §2 原則 3、Phase 7 PR-2a #2688)', () => {
	it('動詞 atom (changeVerb / changeNoun) を持つ', () => {
		expect(PLAN_CHANGE_TERMS.changeVerb).toBe('プランを変更');
		expect(PLAN_CHANGE_TERMS.changeNoun).toBe('プラン変更');
	});

	it('ダウン確定状態 (scheduledChange) を持つ (#2574 banner 専用)', () => {
		expect(PLAN_CHANGE_TERMS.scheduledChange).toBe('切り替わります');
	});

	it('archive 行為 (archive / archiveVerb) を持つ', () => {
		expect(PLAN_CHANGE_TERMS.archive).toBe('アーカイブ');
		expect(PLAN_CHANGE_TERMS.archiveVerb).toBe('アーカイブされます');
	});

	it('復活 atom 5 種 (restore / restoreAble / resumeReady alias / paid / free) を持つ', () => {
		expect(PLAN_CHANGE_TERMS.restore).toBe('復活');
		expect(PLAN_CHANGE_TERMS.restoreAble).toBe('すぐに復活できます');
		expect(PLAN_CHANGE_TERMS.resumeReady).toBe('いつでもワンクリックで復活できます');
		expect(PLAN_CHANGE_TERMS.resumeReadyPaid).toBe('いつでも復活できます');
		expect(PLAN_CHANGE_TERMS.resumeReadyFree).toBe('期限内にプラン切替で復活可能です');
	});

	it('保護 atom 4 variant (ADR-0049 retention 整合) を持つ', () => {
		expect(PLAN_CHANGE_TERMS.protected).toBe('保護されています');
		expect(PLAN_CHANGE_TERMS.protectedReason).toBe('保護のため');
		expect(PLAN_CHANGE_TERMS.protectedPaid).toBe('保護されています');
		// 景表法 5 条 1 号整合: free plan 90 日物理削除事実を明示
		expect(PLAN_CHANGE_TERMS.protectedFree).toBe('90 日間アーカイブとして保持されます');
	});

	it('CTA atom (keepCurrent) を持つ (#2574 専用)', () => {
		expect(PLAN_CHANGE_TERMS.keepCurrent).toBe('現プランのまま続ける');
	});

	it('ADR-0012 Anti-engagement 整合: 「失う / 消える / 使えなくなる」文言を含まない', () => {
		const allValues = Object.values(PLAN_CHANGE_TERMS);
		for (const value of allValues) {
			expect(value).not.toMatch(/失う|消える|使えなくなる|ロックされる/);
		}
	});

	it('paid alias と paid 明示 atom が値統一されている (Phase 5 §2 原則 3 alias 設計)', () => {
		expect(PLAN_CHANGE_TERMS.protected).toBe(PLAN_CHANGE_TERMS.protectedPaid);
		// resumeReady alias は冗長表現 vs paid 明示 (Phase 7 段階撤去で paid 統一予定)
		expect(PLAN_CHANGE_TERMS.resumeReady).not.toBe(PLAN_CHANGE_TERMS.resumeReadyPaid);
	});
});

describe('TOKUSHOHO_TERMS (Phase 3 #2573、Phase 7 PR-2a #2688)', () => {
	it('特商法第12条の6 6 ブロック見出しを順序通りに持つ', () => {
		expect(TOKUSHOHO_TERMS.heading1Quantity).toBe('分量');
		expect(TOKUSHOHO_TERMS.heading2Price).toBe('販売価格');
		expect(TOKUSHOHO_TERMS.heading3Payment).toBe('支払時期・方法');
		expect(TOKUSHOHO_TERMS.heading4Delivery).toBe('引渡時期・自動更新');
		expect(TOKUSHOHO_TERMS.heading5Cancel).toBe('申込撤回・解約方法');
		expect(TOKUSHOHO_TERMS.heading6Important).toBe('重要事項');
	});

	it('重要事項補足 atom (subscriptionType / pciNote / noAdditionalFee) を持つ', () => {
		expect(TOKUSHOHO_TERMS.subscriptionType).toBe('月額自動更新のサブスクリプション契約');
		expect(TOKUSHOHO_TERMS.pciNote).toContain('Stripe');
		expect(TOKUSHOHO_TERMS.noAdditionalFee).toBe('表示価格以外の追加料金は一切ありません');
	});

	it('解約方法 atom (cancelMethodFull / cancelAfterPolicy) を持つ', () => {
		expect(TOKUSHOHO_TERMS.cancelMethodFull).toContain('ご家族の見守り画面');
		expect(TOKUSHOHO_TERMS.cancelMethodFull).toContain('Stripe の請求管理ページ');
		expect(TOKUSHOHO_TERMS.cancelAfterPolicy).toContain('日割り計算による返金は行いません');
	});

	it('同意取得 atom (consentLabel / confirmButtonLabel / cancelButtonLabel) を持つ', () => {
		expect(TOKUSHOHO_TERMS.consentLabel).toBe('上記内容を確認し、お申し込みに同意します');
		expect(TOKUSHOHO_TERMS.confirmButtonLabel).toBe('上記内容で申し込む');
		expect(TOKUSHOHO_TERMS.cancelButtonLabel).toBe('やめる');
	});

	it('自動更新明示 atom (第12条の6第1項第2号 定期購入特則) を持つ', () => {
		expect(TOKUSHOHO_TERMS.autoRenewalNotice).toContain('自動更新');
		expect(TOKUSHOHO_TERMS.noProrationRefund).toBe('日割り計算による返金は行いません');
	});
});

describe('CHECKOUT_SUCCESS_TERMS (Phase 3 #2572、Phase 7 PR-2a #2688)', () => {
	it('variant A: success 文言 atom (successHeading / successBodyTemplate / goHomeButton)', () => {
		expect(CHECKOUT_SUCCESS_TERMS.successHeading).toBe('ご利用ありがとうございます');
		expect(CHECKOUT_SUCCESS_TERMS.successBodyTemplate).toContain('お申し込みが完了しました');
		expect(CHECKOUT_SUCCESS_TERMS.goHomeButton).toBe('ホームへ移動');
	});

	it('variant B: preparing 文言 atom (preparingHeading / preparingBody / preparingFootnote)', () => {
		expect(CHECKOUT_SUCCESS_TERMS.preparingHeading).toBe('準備中');
		expect(CHECKOUT_SUCCESS_TERMS.preparingBody).toContain('お支払いを確認しています');
		expect(CHECKOUT_SUCCESS_TERMS.preparingFootnote).toContain('処理は継続されます');
	});

	it('variant C: processing 文言 atom (processingHeading / processingBody / goHomeBackButton)', () => {
		expect(CHECKOUT_SUCCESS_TERMS.processingHeading).toBe('お支払いの確認をしています');
		expect(CHECKOUT_SUCCESS_TERMS.processingBody).toContain('コンビニ');
		expect(CHECKOUT_SUCCESS_TERMS.goHomeBackButton).toBe('ホームへ戻る');
	});

	it('variant D: failed 文言 atom (failedHeading / failedBody / backToPlanButton)', () => {
		expect(CHECKOUT_SUCCESS_TERMS.failedHeading).toBe('お支払いが完了していません');
		expect(CHECKOUT_SUCCESS_TERMS.failedBody).toContain('決済処理が完了しませんでした');
		expect(CHECKOUT_SUCCESS_TERMS.backToPlanButton).toBe('プランページに戻る');
	});

	it('variant E: timeout 文言 atom (timeoutHeading / timeoutBody / timeoutContactNote / reloadButton)', () => {
		expect(CHECKOUT_SUCCESS_TERMS.timeoutHeading).toBe('処理に時間がかかっています');
		expect(CHECKOUT_SUCCESS_TERMS.timeoutBody).toContain('再読込');
		expect(CHECKOUT_SUCCESS_TERMS.timeoutContactNote).toContain('お問い合わせください');
		expect(CHECKOUT_SUCCESS_TERMS.reloadButton).toBe('再読込');
	});

	it('successBodyTemplate は plan 名を含まない (ADR-0045 atom 単一用語、PLAN_FULL_TERMS は compound 側で結合)', () => {
		// compound 側で `${PLAN_FULL_TERMS[planKey]}${CHECKOUT_SUCCESS_TERMS.successBodyTemplate}` の
		// template literal 組立 (Phase 7 PR-2b で実装)
		expect(CHECKOUT_SUCCESS_TERMS.successBodyTemplate).not.toContain('プラン');
		expect(CHECKOUT_SUCCESS_TERMS.successBodyTemplate).not.toContain('スタンダード');
		expect(CHECKOUT_SUCCESS_TERMS.successBodyTemplate).not.toContain('ファミリー');
		expect(CHECKOUT_SUCCESS_TERMS.successBodyTemplate).not.toContain('プレミアム');
	});
});

describe('3 atom の as const 型安全 (ADR-0045 §3.3)', () => {
	it('PLAN_CHANGE_TERMS は readonly object (型レベル assert、compile-time)', () => {
		// `as const` により readonly 化されている (compile-time でのみ検証可能)
		// runtime では Object.isFrozen は false (as const は型レベルのみ)、本テストは
		// 型注釈の存在を確認する代替
		const _typeCheck: { readonly changeVerb: 'プランを変更' } = PLAN_CHANGE_TERMS;
		expect(_typeCheck.changeVerb).toBe('プランを変更');
	});

	it('TOKUSHOHO_TERMS は readonly object', () => {
		const _typeCheck: { readonly heading1Quantity: '分量' } = TOKUSHOHO_TERMS;
		expect(_typeCheck.heading1Quantity).toBe('分量');
	});

	it('CHECKOUT_SUCCESS_TERMS は readonly object', () => {
		const _typeCheck: { readonly successHeading: 'ご利用ありがとうございます' } =
			CHECKOUT_SUCCESS_TERMS;
		expect(_typeCheck.successHeading).toBe('ご利用ありがとうございます');
	});
});
