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

describe('export → import round-trip 保証 (5 type 全網羅)', () => {
	for (const { typeCode, payload } of SAMPLES) {
		describe(`typeCode = ${typeCode}`, () => {
			it('dispatchExport → JSON.stringify → JSON.parse → parseExportEnvelopeV2 が成功する', () => {
				const env = dispatchExport({ typeCode, payload });
				const json = JSON.stringify(env);
				const reparsed = parseExportEnvelopeV2(JSON.parse(json));
				expect(reparsed.typeCode).toBe(typeCode);
				expect(reparsed.schemaVersion).toBe(2);
				expect(reparsed.payload).toEqual(env.payload);
				expect(reparsed.checksum).toBe(env.checksum);
			});

			it('envelope.payload は Strategy 互換の schema.parse() で受理される', () => {
				const env = dispatchExport({ typeCode, payload });
				expect(() => parseViaSchema(typeCode, env.payload)).not.toThrow();
			});

			it('round-trip 後の payload を schema.parse() に渡しても元 payload と等価', () => {
				// payload → envelope → JSON → reparsed → schema.parse → reparsed payload
				const env = dispatchExport({ typeCode, payload });
				const reparsed = parseExportEnvelopeV2(JSON.parse(JSON.stringify(env)));
				const finalParsed = parseViaSchema(typeCode, reparsed.payload);
				// schema 経由 parse の結果が元 payload と equal (deep)
				expect(finalParsed).toEqual(env.payload);
			});

			it('checksum 改竄を round-trip で検出', () => {
				const env = dispatchExport({ typeCode, payload });
				const tampered = JSON.parse(JSON.stringify(env));
				tampered.checksum = 'b'.repeat(64);
				expect(() => parseExportEnvelopeV2(tampered)).toThrow(/checksum mismatch/);
			});

			it('dispatchExportToJson 経由でも round-trip 成立', () => {
				const json = dispatchExportToJson({ typeCode, payload });
				const reparsed = parseExportEnvelopeV2(JSON.parse(json));
				expect(reparsed.typeCode).toBe(typeCode);
			});

			it('parseAnyExportEnvelope (version 不明 entry) でも v2 として受理', () => {
				const env = dispatchExport({ typeCode, payload });
				const reparsed = parseAnyExportEnvelope(JSON.parse(JSON.stringify(env)));
				expect(reparsed.typeCode).toBe(typeCode);
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
