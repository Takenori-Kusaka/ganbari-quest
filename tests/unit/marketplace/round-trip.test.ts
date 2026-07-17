/**
 * Marketplace export ⇔ import round-trip 単体テスト — Issue #2372 (EPIC #2362 P4).
 *
 * PO 指摘 ④ (export → import で復元できない type 存在) を直接解決するための
 * 5 type 横断 round-trip 保証テスト。
 *
 * 検証する round-trip 経路:
 *
 *   payload
 *     → dispatchExport(typeCode, payload)            (export 経路)
 *     → JSON.stringify
 *     → JSON.parse                                    (storage / transport 経由を擬似)
 *     → parseExportEnvelopeV2                         (import 経路 envelope 検証)
 *     → marketplaceRegistry.get(typeCode).strategy.parse(envelope.payload)  (Strategy.parse)
 *     === 元 payload (型・内容完全一致)
 *
 * これにより：
 *  - schema v2 envelope が round-trip 後も deterministic に再構成可能
 *  - checksum が改竄なしで PASS
 *  - 5 type 全 Strategy が export 後の payload を parse() で受理可能
 * を CI で保証する。
 */

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { dispatchExport, dispatchExportToJson } from '$lib/marketplace/export-dispatcher';
import { parseAnyExportEnvelope, parseExportEnvelopeV2 } from '$lib/marketplace/export-schema';
import { MarketplacePayloadSchemaMap, type MarketplaceTypeId } from '$lib/marketplace/schemas';

// #3847 (EPIC #3151): 下記の「round-trip 不変条件」(import(export(x)) == x) 本体は
// example-based から property-based (fast-check) に **格上げ** 済 (`export-import-roundtrip-property.test.ts`)。
// 本ファイルは property では表現しにくい orthogonal な lock (checksum 改竄検知 / 別 entry point /
// v1 互換 / deterministic checksum / wire format canary snapshot) を example-based で保持する。

/**
 * Strategy 本体は DB 依存 import を引き連れるためテストで直接読み込まず、
 * Strategy.parse() と同等の振る舞いをする payload schema (`MarketplacePayloadSchemaMap`)
 * を SSOT に round-trip 検証する。
 * 各 Strategy の parse() は内部で同じ schema を呼んでいるため、本テストは
 * 「Strategy.parse() が round-trip envelope の payload を受理する」と等価。
 */
function parseViaSchema(typeCode: MarketplaceTypeId, payload: unknown): unknown {
	return v.parse(MarketplacePayloadSchemaMap[typeCode], payload);
}

// ── 5 type sample payload (各 Strategy.parse() が受理する形) ─────

const SAMPLE_ACTIVITY_PACK = {
	activities: [
		{
			name: 'ランニング',
			categoryCode: 'undou' as const,
			icon: '🏃',
			basePoints: 10,
			ageMin: 6,
			ageMax: 12,
			gradeLevel: null,
		},
		{
			name: '読書',
			categoryCode: 'benkyou' as const,
			icon: '📚',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
			triggerHint: '寝る前',
		},
	],
};

const SAMPLE_REWARD_SET = {
	rewards: [
		{ title: 'アイス', points: 100, icon: '🍦', category: 'other' as const },
		{
			title: '映画',
			points: 500,
			icon: '🎬',
			category: 'social' as const,
			description: '家族で映画館へ',
		},
	],
};

const SAMPLE_CHECKLIST = {
	timing: 'morning' as const,
	items: [
		{ label: '歯みがき', icon: '🪥', order: 1 },
		{ label: '着替え', icon: '👕', order: 2 },
		{ label: '朝ごはん', icon: '🍚', order: 3 },
	],
};

const SAMPLE_RULE_PRESET = {
	ruleType: 'bonus' as const,
	rules: [
		{
			title: '宿題ボーナス',
			description: '宿題を 5 日連続で頑張ったら +30P',
			icon: '✏️',
			pointBonus: 30,
		},
	],
};

const SAMPLE_CHALLENGE_SET = {
	challenges: [
		{
			title: 'ひな祭り',
			description: '春の行事を楽しむ',
			monthDay: '03-03',
			durationDays: 7,
			categoryId: 3 as const,
			baseTarget: 10,
			rewardPoints: 50,
			icon: '🎎',
		},
	],
};

const SAMPLES: Array<{ typeCode: MarketplaceTypeId; payload: unknown }> = [
	{ typeCode: 'activity-pack', payload: SAMPLE_ACTIVITY_PACK },
	{ typeCode: 'reward-set', payload: SAMPLE_REWARD_SET },
	{ typeCode: 'checklist', payload: SAMPLE_CHECKLIST },
	{ typeCode: 'rule-preset', payload: SAMPLE_RULE_PRESET },
	{ typeCode: 'challenge-set', payload: SAMPLE_CHALLENGE_SET },
];

describe('export → import round-trip 保証 (5 type 全網羅、orthogonal lock)', () => {
	// NOTE(#3847): round-trip 不変条件 (dispatchExport → JSON 往復 → parseExportEnvelopeV2 →
	// schema.parse == 元 payload) 本体は property-based に格上げ済 (export-import-roundtrip-property.test.ts)。
	// 本 describe は checksum 改竄検知 / 別 entry point / v1 互換など property では表現しにくい lock のみ残す。
	for (const { typeCode, payload } of SAMPLES) {
		describe(`typeCode = ${typeCode}`, () => {
			it('checksum 改竄を round-trip で検出', () => {
				const env = dispatchExport({ typeCode, payload });
				const tampered = JSON.parse(JSON.stringify(env));
				tampered.checksum = 'b'.repeat(64);
				expect(() => parseExportEnvelopeV2(tampered)).toThrow(/checksum mismatch/);
			});

			it('dispatchExportToJson 経由でも round-trip 成立', () => {
				const json = dispatchExportToJson({ typeCode, payload });
				const restored = parseExportEnvelopeV2(JSON.parse(json));
				expect(restored.typeCode).toBe(typeCode);
			});

			it('parseAnyExportEnvelope (version 不明 entry) でも v2 として受理', () => {
				const env = dispatchExport({ typeCode, payload });
				const restored = parseAnyExportEnvelope(JSON.parse(JSON.stringify(env)));
				expect(restored.typeCode).toBe(typeCode);
			});
		});
	}
});

describe('v1 activity-pack → v2 round-trip', () => {
	it('旧 /api/v1/activities/export の出力を schema.parse() まで通せる (後方互換)', () => {
		const v1 = {
			formatVersion: '1.0' as const,
			packId: 'user-export',
			packName: 'エクスポートされた活動',
			description: '1 件',
			icon: '📤',
			activities: SAMPLE_ACTIVITY_PACK.activities,
		};
		const env = parseAnyExportEnvelope(v1);
		expect(env.typeCode).toBe('activity-pack');

		const parsed = parseViaSchema('activity-pack', env.payload);
		expect(parsed).toEqual({ activities: SAMPLE_ACTIVITY_PACK.activities });
	});
});

describe('deterministic checksum 保証', () => {
	it('同一 payload を 2 回 export しても (exportedAt を固定すれば) 完全一致', () => {
		const fixed = '2026-05-21T00:00:00.000Z';
		const e1 = dispatchExport({
			typeCode: 'activity-pack',
			payload: SAMPLE_ACTIVITY_PACK,
			exportedAt: fixed,
		});
		const e2 = dispatchExport({
			typeCode: 'activity-pack',
			payload: SAMPLE_ACTIVITY_PACK,
			exportedAt: fixed,
		});
		expect(e1.checksum).toBe(e2.checksum);
		expect(JSON.stringify(e1)).toBe(JSON.stringify(e2));
	});

	it('payload 内部 object key の物理的並び順が違っても同一 checksum', () => {
		const reordered = {
			activities: [
				{
					gradeLevel: null,
					ageMax: 12,
					ageMin: 6,
					basePoints: 10,
					icon: '🏃',
					categoryCode: 'undou' as const,
					name: 'ランニング',
				},
			],
		};
		const fixed = '2026-05-21T00:00:00.000Z';
		const e1 = dispatchExport({
			typeCode: 'activity-pack',
			payload: { activities: [SAMPLE_ACTIVITY_PACK.activities[0]] },
			exportedAt: fixed,
		});
		const e2 = dispatchExport({
			typeCode: 'activity-pack',
			payload: reordered,
			exportedAt: fixed,
		});
		expect(e1.checksum).toBe(e2.checksum);
	});
});

// #3847 AC3: wire format canary。代表 export 1 枚を snapshot で固定し、envelope 構造 /
// checksum アルゴリズム / key 順序 の silent な wire format 変更を検出する (過剰な approval
// framework は作らず 1 snapshot のみ)。exportedAt を固定して deterministic にする。
describe('wire format canary snapshot (#3847)', () => {
	it('activity-pack の代表 export envelope が既知の wire format と一致する', () => {
		const canary = {
			activities: [
				{
					name: 'ランニング🏃',
					categoryCode: 'undou' as const,
					icon: '🏃',
					basePoints: 10,
					ageMin: 6,
					ageMax: 12,
					gradeLevel: null,
					triggerHint: '朝いちばん',
				},
			],
		};
		const json = dispatchExportToJson({
			typeCode: 'activity-pack',
			payload: canary,
			exportedAt: '2026-05-21T00:00:00.000Z',
		});
		expect(JSON.parse(json)).toMatchSnapshot();
	});
});
