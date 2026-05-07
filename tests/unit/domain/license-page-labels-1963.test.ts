// #1963: LICENSE_PAGE_LABELS atom 直書き撤廃の文字列保全検証
// Phase 7 H6 — terms.ts (PLAN_TERMS / PLAN_FULL_TERMS / PRICE_TERMS / TRIAL_TERMS) 経由で
// 組み立てた compound 文字列が、リファクタ前と完全一致することを保証する。

import { describe, expect, it } from 'vitest';
import { LICENSE_PAGE_LABELS } from '../../../src/lib/domain/labels';

describe('#1963 LICENSE_PAGE_LABELS — atom 直書き撤廃後の文字列同一性保証', () => {
	it('プランラベル: terms.ts 参照後も文字列値が一致', () => {
		expect(LICENSE_PAGE_LABELS.planLabelMonthly).toBe('スタンダード月額（¥500/月）');
		expect(LICENSE_PAGE_LABELS.planLabelYearly).toBe('スタンダード年額（¥5,000/年）');
		expect(LICENSE_PAGE_LABELS.planLabelFamilyMonthly).toBe('ファミリー月額（¥780/月）');
		expect(LICENSE_PAGE_LABELS.planLabelFamilyYearly).toBe('ファミリー年額（¥7,800/年）');
		expect(LICENSE_PAGE_LABELS.planLabelFree).toBe('無料プラン');
	});

	it('無料トライアル: terms.ts 参照後も文字列値が一致', () => {
		expect(LICENSE_PAGE_LABELS.trialActiveTitle).toBe('スタンダードプラン トライアル中');
		expect(LICENSE_PAGE_LABELS.trialStartTitle).toBe('7日間 無料でお試し');
		expect(LICENSE_PAGE_LABELS.trialStartDesc).toBe('スタンダードプランの全機能を体験できます');
	});

	it('スタンダードプラン詳細: terms.ts 参照後も文字列値が一致', () => {
		expect(LICENSE_PAGE_LABELS.standardPlanName).toBe('スタンダード');
		expect(LICENSE_PAGE_LABELS.standardPriceMonthly).toBe('¥500');
	});

	it('ファミリープラン詳細: terms.ts 参照後も文字列値が一致', () => {
		expect(LICENSE_PAGE_LABELS.familyPlanName).toBe('ファミリー');
		expect(LICENSE_PAGE_LABELS.familyPriceMonthly).toBe('¥780');
	});

	it('checkoutButton: tier 分岐後も文字列値が一致', () => {
		expect(LICENSE_PAGE_LABELS.checkoutButton('family', false)).toBe('ファミリープランで始める');
		expect(LICENSE_PAGE_LABELS.checkoutButton('standard', false)).toBe(
			'スタンダードプランで始める',
		);
		expect(LICENSE_PAGE_LABELS.checkoutButton('family', true)).toBe('処理中...');
	});

	it('demoCheckoutButton: tier 分岐後も文字列値が一致', () => {
		expect(LICENSE_PAGE_LABELS.demoCheckoutButton('family')).toBe('ファミリープランで始める');
		expect(LICENSE_PAGE_LABELS.demoCheckoutButton('standard')).toBe('スタンダードプランで始める');
	});
});
