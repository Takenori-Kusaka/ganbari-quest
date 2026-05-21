/**
 * Marketplace export-schema 単体テスト — Issue #2372 (EPIC #2362 P4).
 *
 * v2 envelope build / parse / v1 migration / checksum 不一致時の error path を網羅。
 */

import { describe, expect, it } from 'vitest';
import { computeChecksum } from '$lib/marketplace/checksum';
import {
	buildExportEnvelopeV2,
	EXPORT_SCHEMA_VERSION,
	migrateV1ActivityPackToV2,
	parseAnyExportEnvelope,
	parseExportEnvelopeV2,
} from '$lib/marketplace/export-schema';

const SAMPLE_ACTIVITY_PAYLOAD = {
	activities: [
		{
			name: 'ランニング',
			categoryCode: 'undou',
			icon: '🏃',
			basePoints: 10,
			ageMin: 6,
			ageMax: 12,
			gradeLevel: null,
		},
	],
};

const SAMPLE_REWARD_PAYLOAD = {
	rewards: [
		{
			title: 'アイス',
			points: 100,
			icon: '🍦',
			category: 'other',
		},
	],
};

const SAMPLE_CHECKLIST_PAYLOAD = {
	timing: 'morning',
	items: [
		{ label: '歯みがき', icon: '🪥', order: 1 },
		{ label: '着替え', icon: '👕', order: 2 },
	],
};

const SAMPLE_RULE_PRESET_PAYLOAD = {
	ruleType: 'bonus',
	rules: [
		{
			title: '宿題ボーナス',
			description: '宿題を 5 日連続で頑張ったら +30P',
			icon: '✏️',
			pointBonus: 30,
		},
	],
};

const SAMPLE_CHALLENGE_SET_PAYLOAD = {
	challenges: [
		{
			title: 'ひな祭り',
			description: '春を感じる行事を楽しもう',
			monthDay: '03-03',
			durationDays: 7,
			categoryId: 3 as const,
			baseTarget: 10,
			rewardPoints: 50,
			icon: '🎎',
		},
	],
};

describe('buildExportEnvelopeV2', () => {
	it('schemaVersion / typeCode / payload / exportedAt / checksum が揃った envelope を返す', () => {
		const env = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD);
		expect(env.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
		expect(env.typeCode).toBe('activity-pack');
		expect(env.payload).toBeDefined();
		expect(env.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(env.checksum).toMatch(/^[0-9a-f]{64}$/);
	});

	it('5 type 全てを envelope 化できる', () => {
		const e1 = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD);
		const e2 = buildExportEnvelopeV2('reward-set', SAMPLE_REWARD_PAYLOAD);
		const e3 = buildExportEnvelopeV2('checklist', SAMPLE_CHECKLIST_PAYLOAD);
		const e4 = buildExportEnvelopeV2('rule-preset', SAMPLE_RULE_PRESET_PAYLOAD);
		const e5 = buildExportEnvelopeV2('challenge-set', SAMPLE_CHALLENGE_SET_PAYLOAD);
		expect(e1.typeCode).toBe('activity-pack');
		expect(e2.typeCode).toBe('reward-set');
		expect(e3.typeCode).toBe('checklist');
		expect(e4.typeCode).toBe('rule-preset');
		expect(e5.typeCode).toBe('challenge-set');
	});

	it('指定 exportedAt が反映される', () => {
		const fixed = '2026-05-21T12:00:00.000Z';
		const env = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD, fixed);
		expect(env.exportedAt).toBe(fixed);
	});

	it('payload が schema を満たさないと throw', () => {
		expect(() => buildExportEnvelopeV2('activity-pack', { activities: [] })).toThrow();
		expect(() => buildExportEnvelopeV2('reward-set', { wrong: true })).toThrow();
	});

	it('checksum は payload に対する SHA-256 と一致する', () => {
		const env = buildExportEnvelopeV2('reward-set', SAMPLE_REWARD_PAYLOAD);
		expect(env.checksum).toBe(computeChecksum(env.payload));
	});
});

describe('parseExportEnvelopeV2', () => {
	it('build → parse で同一 envelope が復元される (round-trip via JSON)', () => {
		const built = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD);
		const json = JSON.stringify(built);
		const parsed = parseExportEnvelopeV2(JSON.parse(json));
		expect(parsed).toEqual(built);
	});

	it('checksum 改竄を検出して throw', () => {
		const built = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD);
		const tampered = { ...built, checksum: 'a'.repeat(64) };
		expect(() => parseExportEnvelopeV2(tampered)).toThrow(/checksum mismatch/);
	});

	it('payload 改竄を検出して throw', () => {
		const built = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD);
		const tamperedPayload = JSON.parse(JSON.stringify(built));
		tamperedPayload.payload.activities[0].name = 'TAMPERED';
		expect(() => parseExportEnvelopeV2(tamperedPayload)).toThrow(/checksum mismatch/);
	});

	it('schemaVersion 不正で throw', () => {
		const env = {
			schemaVersion: 99,
			typeCode: 'activity-pack',
			payload: SAMPLE_ACTIVITY_PAYLOAD,
			exportedAt: new Date().toISOString(),
			checksum: 'a'.repeat(64),
		};
		expect(() => parseExportEnvelopeV2(env)).toThrow();
	});

	it('typeCode 不正で throw', () => {
		const env = {
			schemaVersion: EXPORT_SCHEMA_VERSION,
			typeCode: 'unknown-type',
			payload: SAMPLE_ACTIVITY_PAYLOAD,
			exportedAt: new Date().toISOString(),
			checksum: 'a'.repeat(64),
		};
		expect(() => parseExportEnvelopeV2(env)).toThrow();
	});

	it('checksum 長さ不正で throw', () => {
		const built = buildExportEnvelopeV2('activity-pack', SAMPLE_ACTIVITY_PAYLOAD);
		const broken = { ...built, checksum: 'short' };
		expect(() => parseExportEnvelopeV2(broken)).toThrow();
	});
});

describe('migrateV1ActivityPackToV2', () => {
	const V1_INPUT = {
		formatVersion: '1.0' as const,
		packId: 'user-export',
		packName: 'エクスポートされた活動',
		description: '1 件の活動',
		icon: '📤',
		targetAgeMin: 0,
		targetAgeMax: 15,
		tags: ['エクスポート'],
		activities: SAMPLE_ACTIVITY_PAYLOAD.activities,
	};

	it('v1 input から typeCode=activity-pack の v2 envelope を返す', () => {
		const env = migrateV1ActivityPackToV2(V1_INPUT);
		expect(env.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
		expect(env.typeCode).toBe('activity-pack');
		expect(env.payload).toEqual(SAMPLE_ACTIVITY_PAYLOAD);
	});

	it('migration 後の envelope は parse で再検証可能', () => {
		const env = migrateV1ActivityPackToV2(V1_INPUT);
		const restored = parseExportEnvelopeV2(env);
		expect(restored.typeCode).toBe('activity-pack');
	});

	it('v1 でない入力で throw', () => {
		expect(() => migrateV1ActivityPackToV2({ foo: 'bar' })).toThrow(/valid v1/);
	});
});

describe('parseAnyExportEnvelope', () => {
	it('v2 envelope はそのまま parse', () => {
		const built = buildExportEnvelopeV2('reward-set', SAMPLE_REWARD_PAYLOAD);
		const parsed = parseAnyExportEnvelope(JSON.parse(JSON.stringify(built)));
		expect(parsed.typeCode).toBe('reward-set');
	});

	it('v1 activity-pack は migration して parse', () => {
		const v1 = {
			formatVersion: '1.0' as const,
			activities: SAMPLE_ACTIVITY_PAYLOAD.activities,
		};
		const env = parseAnyExportEnvelope(v1);
		expect(env.typeCode).toBe('activity-pack');
		expect(env.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
	});

	it('未知の形式で throw', () => {
		expect(() => parseAnyExportEnvelope({})).toThrow(/unknown envelope format/);
		expect(() => parseAnyExportEnvelope(null)).toThrow();
		expect(() => parseAnyExportEnvelope('string')).toThrow();
	});
});
