// #1947: LP_PRICING_LABELS / LP_PRICING_PHASEB_LABELS / LP_PRICING_EXTRA_LABELS
//        atom 直書き撤廃の文字列保全検証 (Phase 3 D7)
//
// terms.ts (PLAN_TERMS / PRICE_TERMS / TRIAL_TERMS / FREE_TERMS) 経由で
// 組み立てた compound 文字列が、リファクタ前と完全一致することを保証する。
// LP（site/pricing.html / site/index.html）の見た目変更ゼロを CI で担保する。

import { describe, expect, it } from 'vitest';
import {
	LP_PRICING_EXTRA_LABELS,
	LP_PRICING_LABELS,
	LP_PRICING_PHASEB_LABELS,
} from '../../../src/lib/domain/labels';

describe('#1947 LP_PRICING_LABELS — atom 直書き撤廃後の文字列同一性保証', () => {
	it('metaDescription: terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_LABELS.metaDescription).toBe(
			'がんばりクエストの料金プラン。基本無料で始められます。スタンダード月額500円（税込）、プレミアム月額780円（税込）。すべての有料プランに7日間の無料体験付き。',
		);
	});

	it('Hero 関連 atom: terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_LABELS.heroLeadHighlight).toBe('基本無料');
		expect(LP_PRICING_LABELS.heroSubtextSuffix).toBe('付き（クレジットカード登録不要）');
		// #1904 (PERS-CRT-5): 「いつでも解約 OK」→「いつでも解約できます（契約期間の縛りなし）」
		// CANCEL_TERMS.anytimeOk atom 値変更で全ての参照箇所に伝播。
		expect(LP_PRICING_LABELS.heroPriceBand).toBe(
			'基本無料 ・ 月 ¥500（税込）から ・ 有料は 7 日間無料体験 ・ いつでも解約できます（契約期間の縛りなし）',
		);
	});

	it('planFree 関連 atom: terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_LABELS.planFreePrice).toBe('¥0');
		// #1913 (UIUX-E-7): planFreePriceSub の「ずっと無料」を「永久無料」(FREE_PLAN_TERMS.forever) に統一。
		// AC8 = 「ずっと無料」が 0 件、訴求バッジ語と説明 sub の整合に対応した期待値更新。
		expect(LP_PRICING_LABELS.planFreePriceSub).toBe('永久無料 ・ クレカ登録不要');
	});

	it('planStandard 関連 atom: terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_LABELS.planStandardName).toBe('スタンダード');
		expect(LP_PRICING_LABELS.planStandardPrice).toBe('¥500');
	});

	it('planFamily 関連 atom: terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_LABELS.planFamilyName).toBe('プレミアム');
		expect(LP_PRICING_LABELS.planFamilyPrice).toBe('¥780');
	});
});

describe('#1947 LP_PRICING_EXTRA_LABELS — atom 直書き撤廃後の文字列同一性保証', () => {
	it('プラン名 atom (k28-k30): terms.ts 参照後も文字列値が一致', () => {
		// k28 「フリー」は UI 表記揺れのため直書き維持（PLAN_TERMS.free='無料' とは異なる）
		expect(LP_PRICING_EXTRA_LABELS.k28).toBe('フリー');
		expect(LP_PRICING_EXTRA_LABELS.k29).toBe('スタンダード');
		expect(LP_PRICING_EXTRA_LABELS.k30).toBe('プレミアム');
	});

	it('スタンダードの全機能 (k19): terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_EXTRA_LABELS.k19).toBe('スタンダードの全機能');
	});
});

describe('#1947 LP_PRICING_PHASEB_LABELS — atom 直書き撤廃後の文字列同一性保証', () => {
	it('プラン名 atom (k27-k29): terms.ts 参照後も文字列値が一致', () => {
		// k27 「フリー」は UI 表記揺れのため直書き維持
		expect(LP_PRICING_PHASEB_LABELS.k27).toBe('フリー');
		expect(LP_PRICING_PHASEB_LABELS.k28).toBe('スタンダード');
		expect(LP_PRICING_PHASEB_LABELS.k29).toBe('プレミアム');
	});

	it('スタンダードの全機能 (k18): terms.ts 参照後も文字列値が一致', () => {
		expect(LP_PRICING_PHASEB_LABELS.k18).toBe('スタンダードの全機能');
	});
});
