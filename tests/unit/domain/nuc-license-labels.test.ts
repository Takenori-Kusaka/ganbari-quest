// EPIC #2327 / #2329: NUC_LICENSE_LABELS + NUC_EDITION_TERMS の文字列保全検証
// ADR-0051 (NUC-SaaS Bifurcation) / ADR-0045 (terms.ts 2 階層化) 整合。
//
// 検証観点:
// - NUC_EDITION_TERMS atom が業界 prior art (Mattermost / Bitwarden / GitLab CE)
//   と整合する 4 用語 (selfHosted / fullAccess / unlimited / editionEmoji) を提供
// - NUC_LICENSE_LABELS compound が atom 参照で正しく組み立てられる
// - 関数形 (usageChildrenUnit / usageActivitiesValue) が期待値を返す

import { describe, expect, it } from 'vitest';
import { NUC_LICENSE_LABELS } from '../../../src/lib/domain/labels';
import { NUC_EDITION_TERMS } from '../../../src/lib/domain/terms';

describe('EPIC #2327 / #2329 NUC_EDITION_TERMS atom 値', () => {
	it('selfHosted: セルフホスト版 (Mattermost Team Edition 整合)', () => {
		expect(NUC_EDITION_TERMS.selfHosted).toBe('セルフホスト版');
	});

	it('fullAccess: 全機能利用可能 (NUC 最大特典)', () => {
		expect(NUC_EDITION_TERMS.fullAccess).toBe('全機能利用可能');
	});

	it('unlimited: 無制限 (利用状況 dl の値)', () => {
		expect(NUC_EDITION_TERMS.unlimited).toBe('無制限');
	});

	it('editionEmoji: 🏠 (家庭内 self-host の視覚 anchor)', () => {
		expect(NUC_EDITION_TERMS.editionEmoji).toBe('🏠');
	});
});

describe('EPIC #2327 / #2329 NUC_LICENSE_LABELS compound 値', () => {
	it('editionTitle: emoji + selfHosted の組み立て', () => {
		expect(NUC_LICENSE_LABELS.editionTitle).toBe('🏠 セルフホスト版');
	});

	it('editionDesc: fullAccess atom 経由で組み立てられる', () => {
		expect(NUC_LICENSE_LABELS.editionDesc).toContain('全機能利用可能');
		expect(NUC_LICENSE_LABELS.editionDesc).toContain('セルフホストされている');
	});

	it('usageTitle: ご家族の利用状況', () => {
		expect(NUC_LICENSE_LABELS.usageTitle).toBe('ご家族の利用状況');
	});

	it('usageChildrenUnit: 数値 + " 人" の format', () => {
		expect(NUC_LICENSE_LABELS.usageChildrenUnit(2)).toBe('2 人');
		expect(NUC_LICENSE_LABELS.usageChildrenUnit(0)).toBe('0 人');
	});

	it('usageActivitiesValue: 数値 + " 件 (無制限)" の format', () => {
		expect(NUC_LICENSE_LABELS.usageActivitiesValue(9)).toBe('9 件 (無制限)');
		expect(NUC_LICENSE_LABELS.usageActivitiesValue(0)).toBe('0 件 (無制限)');
	});

	it('usageRetentionValue: 無制限 atom 値そのまま', () => {
		expect(NUC_LICENSE_LABELS.usageRetentionValue).toBe('無制限');
		// atom 1 行修正で伝播することを SSOT 経由で検証 (ADR-0045)
		expect(NUC_LICENSE_LABELS.usageRetentionValue).toBe(NUC_EDITION_TERMS.unlimited);
	});

	it('サポート link ラベル', () => {
		expect(NUC_LICENSE_LABELS.supportTitle).toBe('サポート');
		expect(NUC_LICENSE_LABELS.contactLabel).toBe('お問い合わせ');
		expect(NUC_LICENSE_LABELS.docsLabel).toBe('ドキュメント');
	});
});

describe('EPIC #2327 NUC_LICENSE_LABELS と 削除セクション (#2329 AC3)', () => {
	it('NUC で削除されるセクションのキーワード (ライセンスキー / プラン管理 / trial / 支払い履歴) が含まれない', () => {
		// 各 label 値の連結文字列から検証。string のみ反復（関数は除外）。
		const allValues = Object.values(NUC_LICENSE_LABELS)
			.filter((v) => typeof v === 'string')
			.join('\n');

		expect(allValues).not.toContain('ライセンスキー');
		expect(allValues).not.toContain('プラン管理');
		expect(allValues).not.toContain('支払い履歴');
		expect(allValues).not.toContain('トライアル');
		expect(allValues).not.toContain('決済機能は現在準備中です');
	});
});
