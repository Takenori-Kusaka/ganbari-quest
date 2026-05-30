// tests/unit/domain/terms-phase7-pr2a.test.ts
//
// Phase 7 PR-2a (#2688): terms.ts に新規追加した 3 atom (PLAN_CHANGE_TERMS /
// TOKUSHOHO_TERMS / CHECKOUT_SUCCESS_TERMS) の値検証 + `as const` 型安全検証。
//
// #2689 Fix Round 1 (Adversarial Reviewer 3 軸 BLOCK 解消):
//   旧版は ADR-0045 §3.3 §「terms.ts に compound 追加禁止」を実質的に越境した 16+ 件の
//   compound 句 (cancelMethodFull / cancelAfterPolicy / autoRenewalNotice / preparingBody /
//   processingBody / failedBody / timeoutBody / successBodyTemplate / protectedFree /
//   restoreAble / resumeReady* 等) を atom 化していたが、Fix Round 1 で**単一概念 atom のみ**に
//   絞り込み、compound 句は labels.ts `PLAN_CHANGE_LABELS` / `TOKUSHOHO_LABELS` /
//   `CHECKOUT_SUCCESS_LABELS` (Phase 7 PR-2b で追加予定) に template literal 経由で移動する
//   構造に再編した。本テストは Round 1 後の atom 構造を検証する。
//
// 設計 SSOT:
//   - docs/decisions/0045-terms-ssot-2-layer.md §3.3 (atom / compound 責務分離)
//   - docs/design/billing-redesign/phase5-atom-ssot-architecture.md §2 原則 3 / §3
//   - docs/design/billing-redesign/phase3-archived-resource-reactivation-ui-design.md
//   - docs/design/billing-redesign/phase3-subscription-confirm-tokushoho-ui-design.md §4.1
//   - docs/design/billing-redesign/phase3-checkout-success-polling-ui-design.md
//   - docs/decisions/0049-retention-physical-delete-extended.md (free / paid variant)

import { describe, expect, it } from 'vitest';
import {
	CHECKOUT_SUCCESS_TERMS,
	PLAN_CHANGE_TERMS,
	TOKUSHOHO_TERMS,
} from '../../../src/lib/domain/terms';

describe('PLAN_CHANGE_TERMS (Phase 5 §2 原則 3、Phase 7 PR-2a #2688、Round 1 #2689)', () => {
	it('動詞 atom (changeVerb / changeNoun) を持つ', () => {
		expect(PLAN_CHANGE_TERMS.changeVerb).toBe('プランを変更');
		expect(PLAN_CHANGE_TERMS.changeNoun).toBe('プラン変更');
	});

	it('ダウン確定状態 (scheduledChange) を持つ (#2574 banner 専用、単語 atom)', () => {
		expect(PLAN_CHANGE_TERMS.scheduledChange).toBe('切り替わります');
	});

	it('archive 行為 (archive / archiveVerb) を持つ', () => {
		expect(PLAN_CHANGE_TERMS.archive).toBe('アーカイブ');
		expect(PLAN_CHANGE_TERMS.archiveVerb).toBe('アーカイブされます');
	});

	it('復活 atom (restore) を持つ — 単語 atom のみ', () => {
		expect(PLAN_CHANGE_TERMS.restore).toBe('復活');
	});

	it('Round 1: compound 越境 atom が terms.ts に存在しない (ADR-0045 §3.3 整合)', () => {
		// 旧版で atom 化されていた compound 句は labels.ts compound (Phase 7 PR-2b で追加) に移動済
		const keys = Object.keys(PLAN_CHANGE_TERMS) as string[];
		// 助詞・複数 atom 結合の compound 句が atom 側に残っていないことを assert
		expect(keys).not.toContain('restoreAble');
		expect(keys).not.toContain('resumeReady');
		expect(keys).not.toContain('resumeReadyPaid');
		expect(keys).not.toContain('resumeReadyFree');
		expect(keys).not.toContain('protected');
		expect(keys).not.toContain('protectedReason');
		expect(keys).not.toContain('protectedPaid');
		expect(keys).not.toContain('protectedFree');
		expect(keys).not.toContain('keepCurrent');
	});

	it('ADR-0012 Anti-engagement 整合: 「失う / 消える / 使えなくなる」文言を含まない', () => {
		const allValues = Object.values(PLAN_CHANGE_TERMS);
		for (const value of allValues) {
			expect(value).not.toMatch(/失う|消える|使えなくなる|ロックされる/);
		}
	});
});

describe('TOKUSHOHO_TERMS (Phase 3 #2573、Phase 7 PR-2a #2688、Round 1 #2689)', () => {
	it('特商法第12条の6 6 ブロック見出しを順序通りに持つ (法令で表示順序が定められた単一名詞句)', () => {
		expect(TOKUSHOHO_TERMS.heading1Quantity).toBe('分量');
		expect(TOKUSHOHO_TERMS.heading2Price).toBe('販売価格');
		expect(TOKUSHOHO_TERMS.heading3Payment).toBe('支払時期・方法');
		expect(TOKUSHOHO_TERMS.heading4Delivery).toBe('引渡時期・自動更新');
		expect(TOKUSHOHO_TERMS.heading5Cancel).toBe('申込撤回・解約方法');
		expect(TOKUSHOHO_TERMS.heading6Important).toBe('重要事項');
	});

	it('cancelButtonLabel atom (短い動詞句) を持つ', () => {
		expect(TOKUSHOHO_TERMS.cancelButtonLabel).toBe('やめる');
	});

	it('Round 1: 法令文 compound が terms.ts に存在しない (ADR-0045 §3.3 整合)', () => {
		// 旧版で atom 化されていた法令文 (cancelMethodFull / autoRenewalNotice / pciNote 等) は
		// labels.ts `TOKUSHOHO_LABELS` compound (Phase 7 PR-2b で追加) に移動済。
		// 法令改正時の影響範囲を可視化するため、compound 側で他 atom (CANCEL_TERMS /
		// STRIPE_PORTAL_TERMS / ADMIN_VIEW_TERMS / PRICE_TERMS) と結合する責務を持たせる。
		const keys = Object.keys(TOKUSHOHO_TERMS) as string[];
		expect(keys).not.toContain('subscriptionType');
		expect(keys).not.toContain('pciNote');
		expect(keys).not.toContain('noAdditionalFee');
		expect(keys).not.toContain('cancelMethodFull');
		expect(keys).not.toContain('cancelAfterPolicy');
		expect(keys).not.toContain('consentLabel');
		expect(keys).not.toContain('confirmButtonLabel');
		expect(keys).not.toContain('autoRenewalNotice');
		expect(keys).not.toContain('noProrationRefund');
	});
});

describe('CHECKOUT_SUCCESS_TERMS (Phase 3 #2572、Phase 7 PR-2a #2688、Round 1 #2689)', () => {
	it('variant A: success 見出し / ボタン atom (見出し + ボタンラベルのみ)', () => {
		expect(CHECKOUT_SUCCESS_TERMS.successHeading).toBe('ご利用ありがとうございます');
		expect(CHECKOUT_SUCCESS_TERMS.goHomeButton).toBe('ホームへ移動');
	});

	it('variant B: preparing 見出し atom', () => {
		expect(CHECKOUT_SUCCESS_TERMS.preparingHeading).toBe('準備中');
	});

	it('variant C: processing 見出し / ボタン atom', () => {
		expect(CHECKOUT_SUCCESS_TERMS.processingHeading).toBe('お支払いの確認をしています');
		expect(CHECKOUT_SUCCESS_TERMS.goHomeBackButton).toBe('ホームへ戻る');
	});

	it('variant D: failed 見出し / ボタン atom', () => {
		expect(CHECKOUT_SUCCESS_TERMS.failedHeading).toBe('お支払いが完了していません');
		expect(CHECKOUT_SUCCESS_TERMS.backToPlanButton).toBe('プランページに戻る');
	});

	it('variant E: timeout 見出し / ボタン atom', () => {
		expect(CHECKOUT_SUCCESS_TERMS.timeoutHeading).toBe('処理に時間がかかっています');
		expect(CHECKOUT_SUCCESS_TERMS.reloadButton).toBe('再読込');
	});

	it('Round 1: 5 variant 本文 compound が terms.ts に存在しない (Adversarial UX 軸整合)', () => {
		// 旧版で atom 化されていた 5 variant 本文 (`successBodyTemplate` / `preparingBody` /
		// `processingBody` / `failedBody` / `timeoutBody` / `preparingFootnote` /
		// `timeoutContactNote`) は labels.ts `CHECKOUT_SUCCESS_LABELS` compound (Phase 7 PR-2b で
		// 追加) に移動済。保護者の決済完了ストレス局面 (preparing / failed / timeout) でのコピー
		// ライティング A/B 最適化余地を atom 単位で結束しない設計に再編 (Adversarial UX 軸 §2)。
		const keys = Object.keys(CHECKOUT_SUCCESS_TERMS) as string[];
		expect(keys).not.toContain('successBodyTemplate');
		expect(keys).not.toContain('preparingBody');
		expect(keys).not.toContain('preparingFootnote');
		expect(keys).not.toContain('processingBody');
		expect(keys).not.toContain('failedBody');
		expect(keys).not.toContain('timeoutBody');
		expect(keys).not.toContain('timeoutContactNote');
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
