// tests/unit/domain/plan-features.test.ts
// #762: plan-features.ts SSOT 回帰テスト
//
// 目的: プラン機能リストが並行実装に戻っていないか、および各プランの
// 機能数が期待値から逸脱していないかを確認する。文言変更時は期待値を
// 更新すれば通るが、プラン間の差異が崩れると明確に失敗する設計。

import { describe, expect, it } from 'vitest';
import {
	getLicenseHighlights,
	getPricingFeatures,
	getPricingMeta,
	getPricingPagePlans,
	getUnlockedFeatures,
	LICENSE_PAGE_HIGHLIGHTS,
	PREMIUM_UNLOCKED_FEATURES,
	PRICING_PAGE_FEATURES,
	PRICING_PAGE_META,
} from '../../../src/lib/domain/plan-features';

describe('plan-features.ts SSOT', () => {
	describe('PRICING_PAGE_FEATURES', () => {
		it('free プランは 8 項目（#1654 R48 メールサポート補完後）', () => {
			// #1654 R48: footer / tokushoho.html / sla.html がメールサポート全プラン提示済 → SSOT 補完で 7→8
			expect(PRICING_PAGE_FEATURES.free).toHaveLength(8);
		});

		it('standard プランは 9 項目（#1655 R49 家族メンバー招待補完後）', () => {
			// #722: AI による活動提案を family 限定に変更したため 9→8 項目
			// #1655 R49: 家族メンバー招待 4 人まで補完で 8→9 項目
			expect(PRICING_PAGE_FEATURES.standard).toHaveLength(9);
		});

		it('family プランは 8 項目（#1655 R49 家族メンバー招待無制限を明示）', () => {
			// #722: AI 自動提案をファミリー限定機能として追加
			// #1655 R49: 家族メンバー招待: 無制限を明示で 7→8 項目
			expect(PRICING_PAGE_FEATURES.family).toHaveLength(8);
		});

		it('free には「90日間の履歴保持」が含まれる', () => {
			expect(PRICING_PAGE_FEATURES.free).toContain('90日間の履歴保持');
		});

		it('standard には「1年間の履歴保持」が含まれる', () => {
			expect(PRICING_PAGE_FEATURES.standard).toContain('1年間の履歴保持');
		});

		it('family には「無制限の履歴保持」が含まれる', () => {
			expect(PRICING_PAGE_FEATURES.family).toContain('無制限の履歴保持');
		});

		it('family にのみ「きょうだいランキング」が含まれる', () => {
			expect(PRICING_PAGE_FEATURES.family).toContain('きょうだいランキング');
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('きょうだいランキング');
			expect(PRICING_PAGE_FEATURES.free).not.toContain('きょうだいランキング');
		});

		it('family にのみ「ひとことメッセージ（自由テキスト）」が含まれる (#772)', () => {
			expect(PRICING_PAGE_FEATURES.family).toContain('ひとことメッセージ（自由テキスト）');
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('ひとことメッセージ（自由テキスト）');
			expect(PRICING_PAGE_FEATURES.free).not.toContain('ひとことメッセージ（自由テキスト）');
		});

		it('free プランにはトライアル対象の機能（AI提案・特別なごほうび）が含まれない', () => {
			expect(PRICING_PAGE_FEATURES.free).not.toContain('AI による活動提案');
			expect(PRICING_PAGE_FEATURES.free).not.toContain('特別なごほうび設定（即時付与）');
		});

		it('standard に特別なごほうび設定が含まれるが、AI提案は含まない (#722)', () => {
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('AI による活動提案');
			expect(PRICING_PAGE_FEATURES.standard).toContain('特別なごほうび設定（即時付与）');
		});

		it('family にのみ AI 自動提案が含まれる (#722)', () => {
			expect(PRICING_PAGE_FEATURES.family).toContain(
				'✨ AI 自動提案（活動・ごほうび・チェックリスト）',
			);
			expect(PRICING_PAGE_FEATURES.standard).not.toContain(
				'✨ AI 自動提案（活動・ごほうび・チェックリスト）',
			);
			expect(PRICING_PAGE_FEATURES.family).toContain('スタンダードの全機能');
		});

		it('family に月次比較レポート / 週次メールレポートは掲載しない (#792 棚卸し)', () => {
			// 月次比較: plan-gate されていないため除外
			// 週次メールレポート: cron 未稼働のため除外
			expect(PRICING_PAGE_FEATURES.family).not.toContain('月次比較レポート');
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('週次メールレポート');
		});

		it('standard にアバター変更関連は掲載しない (#866 削除済み)', () => {
			// #866: canCustomAvatar を PlanLimits から完全削除。pricing ページでも訴求しない。
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('アバター変更');
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('アバター画像の変更');
		});
	});

	describe('LICENSE_PAGE_HIGHLIGHTS', () => {
		it('standard は 4 項目', () => {
			expect(LICENSE_PAGE_HIGHLIGHTS.standard).toHaveLength(4);
		});

		it('family は 5 項目', () => {
			expect(LICENSE_PAGE_HIGHLIGHTS.family).toHaveLength(5);
		});

		it('family には「スタンダードの全機能」が含まれる', () => {
			expect(LICENSE_PAGE_HIGHLIGHTS.family).toContain('スタンダードの全機能');
		});
	});

	describe('PREMIUM_UNLOCKED_FEATURES', () => {
		it('standard は 4 項目（#722 AI提案をfamilyに移動後）', () => {
			expect(PREMIUM_UNLOCKED_FEATURES.standard).toHaveLength(4);
		});

		it('family は 8 項目（#722 AI自動提案を追加）', () => {
			expect(PREMIUM_UNLOCKED_FEATURES.family).toHaveLength(8);
		});

		it('全項目に icon と text がある', () => {
			for (const feat of PREMIUM_UNLOCKED_FEATURES.standard) {
				expect(feat.icon).not.toBe('');
				expect(feat.text).not.toBe('');
			}
			for (const feat of PREMIUM_UNLOCKED_FEATURES.family) {
				expect(feat.icon).not.toBe('');
				expect(feat.text).not.toBe('');
			}
		});

		it('family のみ「ひとことメッセージ（自由テキスト）」を含む', () => {
			const familyTexts = PREMIUM_UNLOCKED_FEATURES.family.map((f) => f.text);
			const standardTexts = PREMIUM_UNLOCKED_FEATURES.standard.map((f) => f.text);
			expect(familyTexts).toContain('ひとことメッセージ（自由テキスト）');
			expect(standardTexts).not.toContain('ひとことメッセージ（自由テキスト）');
		});

		it('family のみ「きょうだいランキング」を含む', () => {
			const familyTexts = PREMIUM_UNLOCKED_FEATURES.family.map((f) => f.text);
			const standardTexts = PREMIUM_UNLOCKED_FEATURES.standard.map((f) => f.text);
			expect(familyTexts).toContain('きょうだいランキング');
			expect(standardTexts).not.toContain('きょうだいランキング');
		});

		it('standard に plan-gate されていない「月次レポート」は含まない (#792)', () => {
			const standardTexts = PREMIUM_UNLOCKED_FEATURES.standard.map((f) => f.text);
			expect(standardTexts).not.toContain('詳細な月次レポート');
			expect(standardTexts).not.toContain('月次比較レポート');
		});
	});

	describe('Discord サポート文言の排除 (#781)', () => {
		it('全プランの pricing features に Discord の文言が含まれないこと', () => {
			const allFeatures = [
				...PRICING_PAGE_FEATURES.free,
				...PRICING_PAGE_FEATURES.standard,
				...PRICING_PAGE_FEATURES.family,
			];
			for (const feature of allFeatures) {
				expect(feature.toLowerCase()).not.toContain('discord');
			}
		});

		it('全プランの license highlights に Discord の文言が含まれないこと', () => {
			const allHighlights = [
				...LICENSE_PAGE_HIGHLIGHTS.standard,
				...LICENSE_PAGE_HIGHLIGHTS.family,
			];
			for (const highlight of allHighlights) {
				expect(highlight.toLowerCase()).not.toContain('discord');
			}
		});

		it('全プランの unlocked features に Discord の文言が含まれないこと', () => {
			const allTexts = [
				...PREMIUM_UNLOCKED_FEATURES.standard.map((f) => f.text),
				...PREMIUM_UNLOCKED_FEATURES.family.map((f) => f.text),
			];
			for (const text of allTexts) {
				expect(text.toLowerCase()).not.toContain('discord');
			}
		});

		it('サポート表記がメールサポートに統一されていること (#1109 / #1654 R48 で free も補完)', () => {
			const freeFeatures = PRICING_PAGE_FEATURES.free;
			const standardFeatures = PRICING_PAGE_FEATURES.standard;
			const familyFeatures = PRICING_PAGE_FEATURES.family;

			// #1654 R48: free も「メールサポート（標準）」で参加。文言は付帯ありだが label に「メールサポート」を含む
			expect(freeFeatures.some((f) => f.includes('メールサポート'))).toBe(true);
			expect(standardFeatures).toContain('メールサポート');
			expect(familyFeatures).toContain('メールサポート');
		});
	});

	describe('PRICING_PAGE_META (#765)', () => {
		it('3 プラン全てが定義されている', () => {
			expect(PRICING_PAGE_META.free).toBeDefined();
			expect(PRICING_PAGE_META.standard).toBeDefined();
			expect(PRICING_PAGE_META.family).toBeDefined();
		});

		it('プラン名は #749 ブランドガイドライン §7.1 準拠（フリー / スタンダード / ファミリー）', () => {
			expect(PRICING_PAGE_META.free.name).toBe('フリー');
			expect(PRICING_PAGE_META.standard.name).toBe('スタンダード');
			expect(PRICING_PAGE_META.family.name).toBe('ファミリー');
		});

		it('価格表記は半角 ¥ + スラッシュ月額形式（#749 §7.2）', () => {
			expect(PRICING_PAGE_META.free.price).toBe('¥0');
			expect(PRICING_PAGE_META.standard.price).toBe('¥500');
			expect(PRICING_PAGE_META.standard.unit).toBe('/月');
			expect(PRICING_PAGE_META.family.price).toBe('¥780');
			expect(PRICING_PAGE_META.family.unit).toBe('/月');
		});

		it('全角 ￥ / 円 / YEN 表記は含まれない（#749 §7.2）', () => {
			const allText = Object.values(PRICING_PAGE_META)
				.map((m) => `${m.price}${m.unit}${m.yearlyPrice ?? ''}`)
				.join('');
			expect(allText).not.toMatch(/[￥]/);
			expect(allText).not.toMatch(/円/);
			expect(allText).not.toMatch(/YEN/i);
		});

		it('年額表記は standard / family のみで、お得コピー付き（#749 §7.2）', () => {
			expect(PRICING_PAGE_META.free.yearlyPrice).toBeUndefined();
			expect(PRICING_PAGE_META.standard.yearlyPrice).toBe('年額 ¥5,000（2ヶ月分お得）');
			expect(PRICING_PAGE_META.family.yearlyPrice).toBe('年額 ¥7,800（2ヶ月分お得）');
		});

		it('CTA 文言は「無料体験」統一、「トライアル」「お試し」は禁止（#749 §7.3）', () => {
			expect(PRICING_PAGE_META.free.ctaLabel).toBe('無料ではじめる');
			expect(PRICING_PAGE_META.standard.ctaLabel).toBe('7日間 無料体験');
			expect(PRICING_PAGE_META.family.ctaLabel).toBe('7日間 無料体験');

			const allCtas = Object.values(PRICING_PAGE_META)
				.map((m) => m.ctaLabel)
				.join(' ');
			expect(allCtas).not.toMatch(/トライアル/);
			expect(allCtas).not.toMatch(/お試し|おためし/);
		});

		it('おすすめバッジは standard のみに付く（#749 §7.4）', () => {
			expect(PRICING_PAGE_META.free.badge).toBeUndefined();
			expect(PRICING_PAGE_META.standard.badge).toBe('おすすめ');
			expect(PRICING_PAGE_META.family.badge).toBeUndefined();
			expect(PRICING_PAGE_META.free.recommended).toBe(false);
			expect(PRICING_PAGE_META.standard.recommended).toBe(true);
			expect(PRICING_PAGE_META.family.recommended).toBe(false);
		});

		it('CTA href は有料プランのみ ?plan クエリ付き', () => {
			expect(PRICING_PAGE_META.free.ctaHref).toBe('/auth/signup');
			expect(PRICING_PAGE_META.standard.ctaHref).toBe('/auth/signup?plan=standard');
			expect(PRICING_PAGE_META.family.ctaHref).toBe('/auth/signup?plan=family');
		});
	});

	describe('helper functions', () => {
		it('getPricingFeatures は PRICING_PAGE_FEATURES と同一参照を返す', () => {
			expect(getPricingFeatures('free')).toBe(PRICING_PAGE_FEATURES.free);
			expect(getPricingFeatures('standard')).toBe(PRICING_PAGE_FEATURES.standard);
			expect(getPricingFeatures('family')).toBe(PRICING_PAGE_FEATURES.family);
		});

		it('getLicenseHighlights は LICENSE_PAGE_HIGHLIGHTS と同一参照を返す', () => {
			expect(getLicenseHighlights('standard')).toBe(LICENSE_PAGE_HIGHLIGHTS.standard);
			expect(getLicenseHighlights('family')).toBe(LICENSE_PAGE_HIGHLIGHTS.family);
		});

		it('getUnlockedFeatures は PREMIUM_UNLOCKED_FEATURES と同一参照を返す', () => {
			expect(getUnlockedFeatures('standard')).toBe(PREMIUM_UNLOCKED_FEATURES.standard);
			expect(getUnlockedFeatures('family')).toBe(PREMIUM_UNLOCKED_FEATURES.family);
		});

		it('getPricingMeta は PRICING_PAGE_META と同一参照を返す', () => {
			expect(getPricingMeta('free')).toBe(PRICING_PAGE_META.free);
			expect(getPricingMeta('standard')).toBe(PRICING_PAGE_META.standard);
			expect(getPricingMeta('family')).toBe(PRICING_PAGE_META.family);
		});

		it('getPricingPagePlans は free → standard → family 表示順で 3 プランを返す', () => {
			const plans = getPricingPagePlans();
			expect(plans).toHaveLength(3);
			expect(plans.map((p) => p.id)).toEqual(['free', 'standard', 'family']);
		});
	});
});
