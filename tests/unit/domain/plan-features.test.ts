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
	getUnlockedFeatures,
	LICENSE_PAGE_HIGHLIGHTS,
	PREMIUM_UNLOCKED_FEATURES,
	PRICING_PAGE_FEATURES,
} from '../../../src/lib/domain/plan-features';

describe('plan-features.ts SSOT', () => {
	describe('PRICING_PAGE_FEATURES', () => {
		it('free プランは 7 項目', () => {
			expect(PRICING_PAGE_FEATURES.free).toHaveLength(7);
		});

		it('standard プランは 9 項目（#792 棚卸し後）', () => {
			// #792: 月次比較 / 5つのチカラの成長グラフ / 週次メールレポート を削除し
			// 特別なごほうび設定 / クラウドバックアップの訴求を明確化した結果 9 項目
			expect(PRICING_PAGE_FEATURES.standard).toHaveLength(9);
		});

		it('family プランは 6 項目（#792 棚卸し後）', () => {
			// #792: 「AI による活動提案」を削除（standard 全機能に内包されるため重複）
			// クラウドバックアップ 10 世代保管を追加
			expect(PRICING_PAGE_FEATURES.family).toHaveLength(6);
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

		it('standard に AI 提案と特別なごほうび設定が含まれる (#792)', () => {
			expect(PRICING_PAGE_FEATURES.standard).toContain('AI による活動提案');
			expect(PRICING_PAGE_FEATURES.standard).toContain('特別なごほうび設定（即時付与）');
		});

		it('family に AI による活動提案は直接掲載しない (#792 重複排除)', () => {
			// family は「スタンダードの全機能」を含むため、AI を別途掲載しない
			expect(PRICING_PAGE_FEATURES.family).not.toContain('AI による活動提案');
			expect(PRICING_PAGE_FEATURES.family).toContain('スタンダードの全機能');
		});

		it('family に月次比較レポート / 週次メールレポートは掲載しない (#792 棚卸し)', () => {
			// 月次比較: plan-gate されていないため除外
			// 週次メールレポート: cron 未稼働のため除外
			expect(PRICING_PAGE_FEATURES.family).not.toContain('月次比較レポート');
			expect(PRICING_PAGE_FEATURES.standard).not.toContain('週次メールレポート');
		});

		it('standard に canCustomAvatar 関連（アバター変更）は掲載しない (#866 デッドコンフィグ)', () => {
			// #866: canCustomAvatar は PLAN_LIMITS に存在するが参照ゼロ
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
		it('standard は 5 項目', () => {
			expect(PREMIUM_UNLOCKED_FEATURES.standard).toHaveLength(5);
		});

		it('family は 7 項目', () => {
			expect(PREMIUM_UNLOCKED_FEATURES.family).toHaveLength(7);
		});

		it('全項目に icon と text がある', () => {
			for (const feat of PREMIUM_UNLOCKED_FEATURES.standard) {
				expect(feat.icon).toBeTruthy();
				expect(feat.text).toBeTruthy();
			}
			for (const feat of PREMIUM_UNLOCKED_FEATURES.family) {
				expect(feat.icon).toBeTruthy();
				expect(feat.text).toBeTruthy();
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
	});
});
