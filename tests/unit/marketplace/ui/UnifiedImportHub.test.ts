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
import {
	MARKETPLACE_TYPE_CODES_CLIENT,
	MARKETPLACE_TYPE_METAS_CLIENT,
	type MarketplaceTypeCodeClient,
} from '$lib/marketplace/client-types';

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
		// MARKETPLACE_TYPE_CODES_CLIENT (5 値) に対応する hint がラベル SSOT に存在する
		const codeToKey: Record<MarketplaceTypeCodeClient, keyof typeof UNIFIED_IMPORT_HUB_LABELS> = {
			'activity-pack': 'typeHintActivityPack',
			'reward-set': 'typeHintRewardSet',
			checklist: 'typeHintChecklist',
			'rule-preset': 'typeHintRulePreset',
			'challenge-set': 'typeHintChallengeSet',
		};
		for (const code of MARKETPLACE_TYPE_CODES_CLIENT) {
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

describe('UnifiedImportHub client-types ↔ Registry SSOT 整合 (Issue #2370)', () => {
	it('MARKETPLACE_TYPE_CODES_CLIENT が server 側 MARKETPLACE_TYPE_CODES と完全一致', () => {
		expect([...MARKETPLACE_TYPE_CODES_CLIENT]).toEqual([...MARKETPLACE_TYPE_CODES]);
	});

	it('MARKETPLACE_TYPE_METAS_CLIENT の各 type が Registry 上の Descriptor と同じ displayLabel / requiresChildId を持つ', () => {
		for (const meta of MARKETPLACE_TYPE_METAS_CLIENT) {
			const desc = marketplaceRegistry.get(meta.typeCode as MarketplaceTypeCode);
			expect(desc.displayLabel, `displayLabel mismatch for ${meta.typeCode}`).toBe(
				meta.displayLabel,
			);
			expect(desc.requiresChildId, `requiresChildId mismatch for ${meta.typeCode}`).toBe(
				meta.requiresChildId,
			);
		}
	});

	it('client typeCode 型は server typeCode 型と互換 (型レベル assertion 代用)', () => {
		// 型互換性を実行時に確認: 全 client code が server code と等しい型
		const clientCode: MarketplaceTypeCodeClient = 'activity-pack';
		const serverCode: MarketplaceTypeCode = clientCode;
		expect(serverCode).toBe('activity-pack');
	});

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
		// #2899: MARKETPLACE_TYPE_LABELS['rule-preset'] と一致 (DESIGN.md §6 命名規則)
		expect(rule.displayLabel).toBe('とくべつルール');
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
