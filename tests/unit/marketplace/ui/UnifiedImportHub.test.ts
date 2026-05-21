/**
 * UnifiedImportHub 単体テスト — Issue #2370 / EPIC #2362 P4
 *
 * Registry-driven な動的 type 列挙が機能していること、ラベルが集約されていることを検証。
 * 実 Svelte component の DOM レンダリングは Storybook / E2E で扱う。
 */

import { describe, expect, it } from 'vitest';
import { UNIFIED_EMPTY_STATE_LABELS, UNIFIED_IMPORT_HUB_LABELS } from '$lib/domain/labels';
import {
	MARKETPLACE_TYPE_CODES,
	type MarketplaceTypeCode,
	marketplaceRegistry,
} from '$lib/marketplace';

describe('UnifiedImportHub labels (Issue #2370)', () => {
	it('UNIFIED_IMPORT_HUB_LABELS が必須キーを全て持つ', () => {
		expect(UNIFIED_IMPORT_HUB_LABELS.heading).toBeTruthy();
		expect(UNIFIED_IMPORT_HUB_LABELS.description).toBeTruthy();
		expect(UNIFIED_IMPORT_HUB_LABELS.marketplaceHeading).toBeTruthy();
		expect(UNIFIED_IMPORT_HUB_LABELS.fileHeading).toBeTruthy();
		expect(UNIFIED_IMPORT_HUB_LABELS.fileImportBtn).toBeTruthy();
		expect(UNIFIED_IMPORT_HUB_LABELS.typeTabAriaLabel).toBeTruthy();
	});

	it('5 type 全てに対して typeHint が定義されている (Registry SSOT 整合)', () => {
		// MARKETPLACE_TYPE_CODES (5 値) に対応する hint がラベル SSOT に存在する
		const codeToKey: Record<MarketplaceTypeCode, keyof typeof UNIFIED_IMPORT_HUB_LABELS> = {
			'activity-pack': 'typeHintActivityPack',
			'reward-set': 'typeHintRewardSet',
			checklist: 'typeHintChecklist',
			'rule-preset': 'typeHintRulePreset',
			'challenge-set': 'typeHintChallengeSet',
		};
		for (const code of MARKETPLACE_TYPE_CODES) {
			const key = codeToKey[code];
			expect(UNIFIED_IMPORT_HUB_LABELS[key]).toBeTruthy();
		}
	});

	it('resultSuccess / resultAllDuplicates は名称を埋め込む', () => {
		expect(UNIFIED_IMPORT_HUB_LABELS.resultSuccess('ようちえん', 3, 0)).toContain('ようちえん');
		expect(UNIFIED_IMPORT_HUB_LABELS.resultSuccess('ようちえん', 3, 0)).toContain('3');
		expect(UNIFIED_IMPORT_HUB_LABELS.resultSuccess('ようちえん', 3, 2)).toContain('スキップ 2');
		expect(UNIFIED_IMPORT_HUB_LABELS.resultAllDuplicates('A')).toContain('A');
	});

	it('itemCountSuffix / targetAgeRange のフォーマット', () => {
		expect(UNIFIED_IMPORT_HUB_LABELS.itemCountSuffix(5)).toContain('5');
		expect(UNIFIED_IMPORT_HUB_LABELS.targetAgeRange(3, 6)).toContain('3');
		expect(UNIFIED_IMPORT_HUB_LABELS.targetAgeRange(3, 6)).toContain('6');
	});
});

describe('UnifiedEmptyState labels (Issue #2370)', () => {
	it('UNIFIED_EMPTY_STATE_LABELS が必須キーを全て持つ', () => {
		expect(UNIFIED_EMPTY_STATE_LABELS.icon).toBeTruthy();
		expect(UNIFIED_EMPTY_STATE_LABELS.addBtn).toBeTruthy();
		expect(UNIFIED_EMPTY_STATE_LABELS.importBtn).toBeTruthy();
		expect(UNIFIED_EMPTY_STATE_LABELS.filteredText).toBeTruthy();
	});

	it('noItems はリソース名を埋め込む', () => {
		expect(UNIFIED_EMPTY_STATE_LABELS.noItems('活動')).toContain('活動');
		expect(UNIFIED_EMPTY_STATE_LABELS.noItems('ごほうび')).toContain('ごほうび');
		expect(UNIFIED_EMPTY_STATE_LABELS.noItems('チェックリスト')).toContain('チェックリスト');
		expect(UNIFIED_EMPTY_STATE_LABELS.noItems('ルール')).toContain('ルール');
		expect(UNIFIED_EMPTY_STATE_LABELS.noItems('チャレンジ')).toContain('チャレンジ');
	});
});

describe('UnifiedImportHub Registry integration (Issue #2370)', () => {
	it('marketplaceRegistry.list() で全 5 type が列挙できる', () => {
		const descriptors = marketplaceRegistry.list();
		expect(descriptors.length).toBe(5);
		const codes = descriptors.map((d) => d.typeCode);
		for (const expected of MARKETPLACE_TYPE_CODES) {
			expect(codes).toContain(expected);
		}
	});

	it('単一 type モードで get() しても displayLabel が取得できる (Hub UI のタブ表示用)', () => {
		const activity = marketplaceRegistry.get('activity-pack');
		expect(activity.displayLabel).toBe('活動セット');
		const reward = marketplaceRegistry.get('reward-set');
		expect(reward.displayLabel).toBe('ごほうびセット');
		const checklist = marketplaceRegistry.get('checklist');
		expect(checklist.displayLabel).toBe('チェックリスト');
		const rule = marketplaceRegistry.get('rule-preset');
		expect(rule.displayLabel).toBe('ルールセット');
		const challenge = marketplaceRegistry.get('challenge-set');
		expect(challenge.displayLabel).toBe('チャレンジ集');
	});

	it('requiresChildId が type ごとに正しく設定されている', () => {
		expect(marketplaceRegistry.get('activity-pack').requiresChildId).toBe(false);
		expect(marketplaceRegistry.get('reward-set').requiresChildId).toBe(true);
		expect(marketplaceRegistry.get('checklist').requiresChildId).toBe(true);
		expect(marketplaceRegistry.get('rule-preset').requiresChildId).toBe(false);
		expect(marketplaceRegistry.get('challenge-set').requiresChildId).toBe(false);
	});
});
