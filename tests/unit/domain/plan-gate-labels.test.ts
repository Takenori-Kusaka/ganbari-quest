// tests/unit/domain/plan-gate-labels.test.ts
// PLAN_GATE_LABELS テンプレートのユニットテスト (#1925 Phase 2 C0)
//
// 目的:
//   - 各テンプレートメソッドが既存リテラル文字列と char-by-char 一致することを保証
//   - C1-C15 リテラル置換時に文字変化ゼロを担保（既存の i18n / SEO / a11y 文字列との整合維持）
//
// 既存リテラルの SSOT (各 grep ヒット行):
//   - src/lib/domain/errors.ts (line 22, 65 コメント)
//   - src/lib/server/errors.ts (line 92)
//   - src/lib/server/services/cloud-export-service.ts (line 145)
//   - src/lib/server/api/suggest-plan-gate.ts (line 46)
//   - src/routes/(parent)/admin/checklists/+page.server.ts (line 209)
//   - src/routes/(parent)/admin/messages/+page.server.ts (line 72)
//   - src/routes/(parent)/admin/reports/+page.server.ts (line 141)
//   - src/routes/(parent)/admin/rewards/+page.server.ts (line 28)
//   - src/routes/(parent)/admin/settings/+page.server.ts (line 278)
//   - src/routes/api/v1/admin/viewer-tokens/+server.ts (line 23)
//   - src/routes/api/v1/export/+server.ts (line 32)

import { describe, expect, it } from 'vitest';
import { PLAN_GATE_LABELS } from '../../../src/lib/domain/labels';

describe('PLAN_GATE_LABELS.standardOrAboveFor', () => {
	it('AI 活動提案 (errors.ts) の既存メッセージと char-by-char 一致する', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveFor('AI 活動提案')).toBe(
			'AI 活動提案はスタンダードプラン以上でご利用いただけます',
		);
	});

	it('クラウドエクスポート (cloud-export-service.ts) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveFor('クラウドエクスポート')).toBe(
			'クラウドエクスポートはスタンダードプラン以上でご利用いただけます',
		);
	});

	it('週次メールレポート (admin/reports) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveFor('週次メールレポート')).toBe(
			'週次メールレポートはスタンダードプラン以上でご利用いただけます',
		);
	});

	it('特別なごほうび設定 (admin/rewards) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveFor('特別なごほうび設定')).toBe(
			'特別なごほうび設定はスタンダードプラン以上でご利用いただけます',
		);
	});

	it('エクスポート機能 (api/v1/export) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveFor('エクスポート機能')).toBe(
			'エクスポート機能はスタンダードプラン以上でご利用いただけます',
		);
	});
});

describe('PLAN_GATE_LABELS.familyOnlyFor', () => {
	it('AI チェックリスト提案 (admin/checklists) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.familyOnlyFor('AI チェックリスト提案')).toBe(
			'AI チェックリスト提案はプレミアムプランでご利用いただけます',
		);
	});

	it('動的 featureLabel (suggest-plan-gate.ts) の既存メッセージと一致する', () => {
		// suggest-plan-gate.ts は ${featureLabel}はプレミアムプランでご利用いただけます 形式
		expect(PLAN_GATE_LABELS.familyOnlyFor('AI 提案')).toBe(
			'AI 提案はプレミアムプランでご利用いただけます',
		);
	});
});

describe('PLAN_GATE_LABELS.familyLimitedFor', () => {
	it('自由テキストメッセージ (admin/messages) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.familyLimitedFor('自由テキストメッセージ')).toBe(
			'自由テキストメッセージはプレミアムプラン限定です',
		);
	});
});

describe('PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade', () => {
	it('server/errors.ts の既存メッセージと char-by-char 一致する', () => {
		expect(PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade).toBe(
			'この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。',
		);
	});
});

describe('PLAN_GATE_LABELS.familyLimitedWithUpgradeFor', () => {
	it('きょうだいランキング (admin/settings) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.familyLimitedWithUpgradeFor('きょうだいランキング')).toBe(
			'きょうだいランキングはプレミアムプラン限定です。アップグレードすると利用できます。',
		);
	});
});

describe('PLAN_GATE_LABELS.viewerTokenFamilyOnly', () => {
	it('viewer-tokens (api/v1/admin/viewer-tokens) の既存メッセージと一致する', () => {
		expect(PLAN_GATE_LABELS.viewerTokenFamilyOnly).toBe('プレミアムプラン限定の機能です');
	});
});

describe('PLAN_GATE_LABELS — atom 連動性', () => {
	it('テンプレートはハードコードではなく PLAN_FULL_TERMS atom を介して組み立てられる', () => {
		// terms.ts (PLAN_FULL_TERMS.standard) を変更したときに本テストが落ちることで
		// labels.ts 側との同期ずれを検出できることを確認する。
		const sample = PLAN_GATE_LABELS.standardOrAboveFor('テスト機能');
		expect(sample).toContain('スタンダードプラン');
		expect(sample).toContain('テスト機能は');
		expect(sample).toContain('以上でご利用いただけます');
	});

	it('familyOnlyFor と familyLimitedFor は意味が異なる別文言を返す', () => {
		// suggest-plan-gate / admin/checklists 系 (familyOnlyFor: 「で」) と
		// admin/messages 系 (familyLimitedFor: 「限定」) は文字列上区別される
		const onlyFor = PLAN_GATE_LABELS.familyOnlyFor('機能');
		const limitedFor = PLAN_GATE_LABELS.familyLimitedFor('機能');
		expect(onlyFor).not.toBe(limitedFor);
		expect(onlyFor).toContain('プレミアムプランでご利用いただけます');
		expect(limitedFor).toContain('プレミアムプラン限定です');
	});
});
