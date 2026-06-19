// tests/unit/marketplace/export-import-roundtrip-invariants.test.ts
// #3143: export/import 4 type の round-trip 不変条件を網羅する単体テスト (予防的)。
//
// export/import クラスタ (#3079/#3083/#3085) が 2 サイクル連続で round-trip blocker を出した
// 構造的問題への予防策。「アプリが許容する全データ状態 ⊆ export/import が往復できる状態」という
// 不変条件を、重量 e2e を待たず develop 軽量レーン (unit) で機械的に表明する。
//
// 本ファイルが固定する根本クラス:
//   ② 値域整合 (#3132): domain validation 上限 ⊆ export schema 上限 / schema 境界の自己整合。
//   ③ 文字種整合 (#3104): 日本語/絵文字を含む name/title/icon が schema + JSON 往復を通る。
// ④ completeness 整合 (#3136/#3106) は dangling avatarUrl = import-service-avatar-remap.test.ts、
//   reward 値域単体 = reward-set-roundtrip-domain.test.ts で既に固定済 (本ファイルは重複しない)。
//
// property-based (fast-check) は未導入 (ADR-0014 OSS 先調査: Pre-PMF で新規 dep は過剰)。Issue #3143 の
// 「過剰なら代表 + 境界の example-based で可」に従い example-based で表明する。

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { ActivityPackItemSchema } from '$lib/marketplace/schemas/activity-pack-schema';
import { ChallengeSetItemSchema } from '$lib/marketplace/schemas/challenge-set-schema';
import { ChecklistItemSchema } from '$lib/marketplace/schemas/checklist-schema';
import { RewardSetItemSchema } from '$lib/marketplace/schemas/reward-set-schema';

// --- 各 type の代表 valid item (日本語 + 絵文字を含む = 文字種往復も兼ねる) ---
const activityItem = (over: Record<string, unknown> = {}) => ({
	name: 'からだをうごかす🏃',
	categoryCode: 'undou',
	icon: '🏃',
	basePoints: 10,
	ageMin: null,
	ageMax: null,
	gradeLevel: null,
	...over,
});
const checklistItem = (over: Record<string, unknown> = {}) => ({
	label: 'はみがき🪥をする',
	icon: '🪥',
	order: 0,
	...over,
});
const challengeItem = (over: Record<string, unknown> = {}) => ({
	title: 'ひなまつりチャレンジ🎎',
	description: '3日間つづけてがんばろう✨',
	monthDay: '03-03',
	durationDays: 3,
	categoryId: 1,
	baseTarget: 10,
	rewardPoints: 100,
	icon: '🎎',
	...over,
});
const rewardItem = (over: Record<string, unknown> = {}) => ({
	title: 'ゲームのじかん🎮',
	points: 50,
	icon: '🎮',
	category: 'other',
	...over,
});

const ok = (schema: Parameters<typeof v.safeParse>[0], data: unknown) =>
	v.safeParse(schema, data).success;

describe('#3143 export/import round-trip 不変条件 (4 type)', () => {
	describe('① 代表データが各 type の schema を通る', () => {
		it('activity-pack / checklist / challenge-set / reward-set の代表 item が valid', () => {
			expect(ok(ActivityPackItemSchema, activityItem())).toBe(true);
			expect(ok(ChecklistItemSchema, checklistItem())).toBe(true);
			expect(ok(ChallengeSetItemSchema, challengeItem())).toBe(true);
			expect(ok(RewardSetItemSchema, rewardItem())).toBe(true);
		});
	});

	describe('② 値域整合: schema 数値上限の境界 (上限値 受理 / 上限+1 拒否)', () => {
		it('activity-pack basePoints 上限 10000 受理 / 10001 拒否', () => {
			expect(ok(ActivityPackItemSchema, activityItem({ basePoints: 10000 }))).toBe(true);
			expect(ok(ActivityPackItemSchema, activityItem({ basePoints: 10001 }))).toBe(false);
		});
		it('activity-pack の domain 上限 (basePoints 100) は export schema を必ず通る (domain ⊆ schema)', () => {
			// domain validation (activity.ts: basePoints.max(100)) が許容する最大値が export schema を通る。
			expect(ok(ActivityPackItemSchema, activityItem({ basePoints: 100 }))).toBe(true);
		});
		it('checklist order は 0 以上整数 (負値拒否)', () => {
			expect(ok(ChecklistItemSchema, checklistItem({ order: 0 }))).toBe(true);
			expect(ok(ChecklistItemSchema, checklistItem({ order: -1 }))).toBe(false);
		});
		it('challenge-set durationDays 90 / baseTarget 1000 / rewardPoints 10000 上限境界', () => {
			expect(ok(ChallengeSetItemSchema, challengeItem({ durationDays: 90 }))).toBe(true);
			expect(ok(ChallengeSetItemSchema, challengeItem({ durationDays: 91 }))).toBe(false);
			expect(ok(ChallengeSetItemSchema, challengeItem({ baseTarget: 1000 }))).toBe(true);
			expect(ok(ChallengeSetItemSchema, challengeItem({ baseTarget: 1001 }))).toBe(false);
			expect(ok(ChallengeSetItemSchema, challengeItem({ rewardPoints: 10000 }))).toBe(true);
			expect(ok(ChallengeSetItemSchema, challengeItem({ rewardPoints: 10001 }))).toBe(false);
		});
		it('reward-set points 上限 10000 受理 / 10001 拒否 (詳細 domain⊆schema は reward-set-roundtrip-domain.test.ts)', () => {
			expect(ok(RewardSetItemSchema, rewardItem({ points: 10000 }))).toBe(true);
			expect(ok(RewardSetItemSchema, rewardItem({ points: 10001 }))).toBe(false);
		});
	});

	describe('③ 文字種整合: 日本語 + 絵文字を含む文字列が schema + JSON 往復を通る (#3104 root class)', () => {
		const cases: Array<[string, Parameters<typeof v.safeParse>[0], () => unknown]> = [
			['activity-pack', ActivityPackItemSchema, () => activityItem({ name: '日本語🎌テスト活動' })],
			['checklist', ChecklistItemSchema, () => checklistItem({ label: '日本語🧹そうじする' })],
			[
				'challenge-set',
				ChallengeSetItemSchema,
				() => challengeItem({ title: '七夕🎋ちょうせん', description: '願いごと✍️をかこう' }),
			],
			['reward-set', RewardSetItemSchema, () => rewardItem({ title: 'おかし🍪パーティー' })],
		];
		for (const [name, schema, make] of cases) {
			it(`${name}: 非 ASCII (日本語/絵文字) item が valid + JSON.stringify→parse で同値`, () => {
				const item = make();
				expect(ok(schema, item)).toBe(true);
				// JSON シリアライズ往復で非 ASCII が壊れない (export = JSON body の round-trip 整合)
				const roundTripped = JSON.parse(JSON.stringify(item));
				expect(roundTripped).toEqual(item);
				expect(ok(schema, roundTripped)).toBe(true);
			});
		}
	});

	describe('③b emoji icon (ZWJ 連結含む) が icon maxLength を通る', () => {
		it('家族 ZWJ emoji 👨‍👩‍👧‍👦 (11 UTF-16 code units) が 4 type の icon を通る', () => {
			const zwj = '👨‍👩‍👧‍👦';
			expect(ok(ActivityPackItemSchema, activityItem({ icon: zwj }))).toBe(true);
			expect(ok(ChecklistItemSchema, checklistItem({ icon: zwj }))).toBe(true);
			expect(ok(ChallengeSetItemSchema, challengeItem({ icon: zwj }))).toBe(true);
			expect(ok(RewardSetItemSchema, rewardItem({ icon: zwj }))).toBe(true);
		});
	});
});
