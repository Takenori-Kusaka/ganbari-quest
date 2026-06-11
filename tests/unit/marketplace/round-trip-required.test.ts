/**
 * Marketplace 5 type round-trip 必須化テスト — Issue #2374 (EPIC #2362 P4 / AN-5 #2180 補強 7)
 *
 * 全 5 type (activity-pack / reward-set / checklist / rule-preset / challenge-set) で
 * 「seed payload → JSON serialize → JSON deserialize → schema parse → 値同等性 assert」
 * の round-trip 完整性を必須化する。
 *
 * Round-trip 保証の意義 (ADR-0052 / EPIC #2362 ④):
 *  - Export endpoint から取り出した JSON を Import endpoint に流し戻しても情報欠落なし
 *  - 新 type 追加時 schema が export/import 互換を破壊しないことを CI で hard-fail 検証
 *  - 既存 #2372 (in-memory round-trip 単体テスト) と相補的に「seed → schema → seed' 一致」を
 *    Registry 統合後の Strategy 群でも安全性 net として張る
 *
 * 関連:
 *  - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
 *  - Issue #2374 (Registry 完整性 CI + Round-trip E2E 必須化)
 *  - EPIC #2362 ④ (Export → Import 消失問題の構造的解決)
 *  - tests/unit/marketplace/schemas/*.test.ts (個別 schema 単体テスト)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
	type ActivityPackPayload,
	ActivityPackPayloadSchema,
	type ChallengeSetPayload,
	ChallengeSetPayloadSchema,
	type ChecklistPayload,
	ChecklistPayloadSchema,
	MarketplacePayloadSchemaMap,
	type MarketplaceTypeId,
	type RewardSetPayload,
	RewardSetPayloadSchema,
	type RulePresetPayload,
	RulePresetPayloadSchema,
} from '$lib/marketplace/schemas';
import { MARKETPLACE_TYPE_CODES } from '$lib/marketplace/types';

/**
 * #2389 Copilot AC2 [must]: 5 type 横断テストの `as any` 排除用 typed helper。
 *
 * `MarketplacePayloadSchemaMap[T]` は T に応じた Valibot schema を返す mapped type
 * (`MarketplacePayloadSchemaMap` の対応するキー型)。本 helper を経由することで
 * `v.safeParse(schema as any, input)` の `as any` を不要にし、TypeScript strict
 * 整合を回復する。
 *
 * @example
 *   const result = safeParseWithMap('activity-pack', rawPayload);
 *   if (result.success) {
 *     // result.output は ActivityPackPayload として narrow される
 *   }
 */
function safeParseWithMap<T extends MarketplaceTypeId>(
	typeId: T,
	input: unknown,
): v.SafeParseResult<(typeof MarketplacePayloadSchemaMap)[T]> {
	return v.safeParse(MarketplacePayloadSchemaMap[typeId], input);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../');

interface SeedCase {
	typeId: MarketplaceTypeId;
	seedFile: string;
	expectedItemKey: 'activities' | 'rewards' | 'items' | 'rules' | 'challenges';
}

/**
 * 5 type それぞれの代表 seed (production marketplace JSON) を round-trip 対象に固定。
 * 新 type 追加時はこの SEED_CASES を更新する。
 */
const SEED_CASES: readonly SeedCase[] = [
	{
		typeId: 'activity-pack',
		seedFile: 'src/lib/data/marketplace/activity-packs/kinder-starter.json',
		expectedItemKey: 'activities',
	},
	{
		typeId: 'reward-set',
		seedFile: 'src/lib/data/marketplace/reward-sets/elementary-rewards.json',
		expectedItemKey: 'rewards',
	},
	{
		typeId: 'checklist',
		seedFile: 'src/lib/data/marketplace/checklists/event-pool.json',
		expectedItemKey: 'items',
	},
	{
		typeId: 'rule-preset',
		seedFile: 'src/lib/data/marketplace/rule-presets/streak-bonus.json',
		expectedItemKey: 'rules',
	},
	{
		// #2896: challenge-set は marketplace 陳列から外し production preset を廃止したが、
		// 型 / schema / Registry 登録は残置 (互換)。round-trip 完整性は廃止 preset を移管した
		// test fixture で継続検証し、全 5 type の schema 互換 net を維持する。
		typeId: 'challenge-set',
		seedFile: 'tests/fixtures/marketplace/challenge-sets/japan-annual-events.json',
		expectedItemKey: 'challenges',
	},
] as const;

function loadSeedPayload(seedFile: string): unknown {
	const full = path.join(REPO_ROOT, seedFile);
	const json = JSON.parse(fs.readFileSync(full, 'utf8'));
	expect(json).toHaveProperty('payload');
	return json.payload;
}

describe('Marketplace 5 type round-trip 必須化 (#2374)', () => {
	it('SEED_CASES が MARKETPLACE_TYPE_CODES 全件をカバーする', () => {
		// Registry SSOT との同期を CI で hard-fail 化 (新 type 追加時の漏れ検知)
		const seededTypes = SEED_CASES.map((c) => c.typeId).sort();
		const expectedTypes = [...MARKETPLACE_TYPE_CODES].sort();
		expect(seededTypes).toEqual(expectedTypes);
	});

	for (const seedCase of SEED_CASES) {
		describe(`${seedCase.typeId} round-trip`, () => {
			it('seed → safeParse 成功 + 値同等性 (1 回目)', () => {
				const rawPayload = loadSeedPayload(seedCase.seedFile);
				const result = safeParseWithMap(seedCase.typeId, rawPayload);
				if (!result.success) {
					console.error(JSON.stringify(result.issues, null, 2));
				}
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.output).toHaveProperty(seedCase.expectedItemKey);
				}
			});

			it('JSON serialize → deserialize → safeParse でも値同等性 (export → import 同型)', () => {
				const rawPayload = loadSeedPayload(seedCase.seedFile);

				// 1. 1 回目 parse (import 経路の事前 validation 相当)
				const first = safeParseWithMap(seedCase.typeId, rawPayload);
				expect(first.success).toBe(true);
				if (!first.success) return;

				// 2. JSON 経由 round-trip (export endpoint が JSON.stringify → 受信側が JSON.parse する経路相当)
				const json = JSON.stringify(first.output);
				const restored = JSON.parse(json);

				// 3. 2 回目 parse (import 経路の receive validation 相当)
				const second = safeParseWithMap(seedCase.typeId, restored);
				expect(second.success).toBe(true);
				if (!second.success) return;

				// 4. 値同等性 (情報欠落 0 件): JSON.stringify は key 順を保つ前提で deep equal
				expect(second.output).toEqual(first.output);
			});

			it('items 配列が minLength: 1 を満たし非空', () => {
				const rawPayload = loadSeedPayload(seedCase.seedFile);
				const result = safeParseWithMap(seedCase.typeId, rawPayload);
				expect(result.success).toBe(true);
				if (result.success) {
					const items = (result.output as Record<string, unknown>)[seedCase.expectedItemKey];
					expect(Array.isArray(items)).toBe(true);
					expect((items as unknown[]).length).toBeGreaterThan(0);
				}
			});
		});
	}

	describe('cross-type strict 型契約 (型レベル round-trip)', () => {
		// 各 SEED_CASES 要素を typeId 単位で取り出すヘルパ (noUncheckedIndexedAccess 対応)
		function findSeed(typeId: MarketplaceTypeId): SeedCase {
			const found = SEED_CASES.find((c) => c.typeId === typeId);
			if (!found) throw new Error(`SEED_CASES missing entry for ${typeId}`);
			return found;
		}

		it('activity-pack: v.InferOutput が ActivityPackPayload と一致', () => {
			const seed = loadSeedPayload(findSeed('activity-pack').seedFile);
			const parsed = v.parse(ActivityPackPayloadSchema, seed);
			const _typeCheck: ActivityPackPayload = parsed;
			expect(_typeCheck.activities.length).toBeGreaterThan(0);
		});

		it('reward-set: v.InferOutput が RewardSetPayload と一致', () => {
			const seed = loadSeedPayload(findSeed('reward-set').seedFile);
			const parsed = v.parse(RewardSetPayloadSchema, seed);
			const _typeCheck: RewardSetPayload = parsed;
			expect(_typeCheck.rewards.length).toBeGreaterThan(0);
		});

		it('checklist: v.InferOutput が ChecklistPayload と一致', () => {
			const seed = loadSeedPayload(findSeed('checklist').seedFile);
			const parsed = v.parse(ChecklistPayloadSchema, seed);
			const _typeCheck: ChecklistPayload = parsed;
			expect(_typeCheck.items.length).toBeGreaterThan(0);
		});

		it('rule-preset: v.InferOutput が RulePresetPayload と一致', () => {
			const seed = loadSeedPayload(findSeed('rule-preset').seedFile);
			const parsed = v.parse(RulePresetPayloadSchema, seed);
			const _typeCheck: RulePresetPayload = parsed;
			expect(_typeCheck.rules.length).toBeGreaterThan(0);
		});

		it('challenge-set: v.InferOutput が ChallengeSetPayload と一致', () => {
			const seed = loadSeedPayload(findSeed('challenge-set').seedFile);
			const parsed = v.parse(ChallengeSetPayloadSchema, seed);
			const _typeCheck: ChallengeSetPayload = parsed;
			expect(_typeCheck.challenges.length).toBeGreaterThan(0);
		});
	});
});
