// tests/unit/architecture/schema-range-ssot.test.ts
// #3151 slice1 (ADR-0066): export/import 値域ドリフト根絶の fitness function。
//
// root class (#3104→#3132 の 2 サイクル連続 blocker): domain validation (Zod) と
// wire schema (Valibot) が別ファイル・別ライブラリで値域を二重定義し、
// 「アプリが許容する値域 ⊆ export/import が往復できる値域 (domain⊆wire)」という
// 不変条件がどこにも機械表明されていなかった。
//
// 本テストの表明:
//   (1) no-silent-gap: marketplace 全 type が「値域 SSOT 適用済 (COVERED)」か
//       「explicit TODO (RANGE_SSOT_TODO、#3151 残 phase で消化)」のいずれかに分類される。
//       新 type 追加時に本分類へ登録しなければ CI で fail する (silent skip 禁止、
//       admin-resource-model-registry の NON_CANONICAL 方式と同型)。
//   (2) activity-pack (COVERED): domain Zod (createActivitySchema) と wire Valibot
//       (ActivityPackItemSchema) が値域 SSOT 定数 (`$lib/domain/validation/activity.ts`)
//       の同一境界で受理/拒否する (boundary probe による behavior-level の同値表明)。
//       実 validator を oracle として呼ぶため、どちらか一方が SSOT 定数を離れて
//       literal を直書き (再ドリフト) すると必ず fail する (#3153 oracle 方式の拡張)。
//
// 他 4 type の SSOT 化は #3151 Phase 2 (Issue コメントの残 phase 分割案) で消化する。

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
	ACTIVITY_AGE_MAX,
	ACTIVITY_AGE_MIN,
	ACTIVITY_BASE_POINTS_MAX,
	ACTIVITY_BASE_POINTS_MIN,
	ACTIVITY_DESCRIPTION_MAX,
	ACTIVITY_ICON_MAX_GRAPHEMES,
	ACTIVITY_NAME_MAX,
	ACTIVITY_TRIGGER_HINT_MAX,
	createActivitySchema,
} from '$lib/domain/validation/activity';
import { ActivityPackItemSchema } from '$lib/marketplace/schemas/activity-pack-schema';
import { MARKETPLACE_TYPE_CODES, type MarketplaceTypeCode } from '$lib/marketplace/types';

// ── (1) no-silent-gap 分類 ──────────────────────────────────────────

/** 値域 SSOT (domain 定数を domain/wire 両 schema が参照) 適用済の type */
const COVERED_TYPES: readonly MarketplaceTypeCode[] = ['activity-pack'];

/**
 * 値域 SSOT 未適用の type (explicit TODO)。#3151 Phase 2 で 1 type ずつ SSOT 化し、
 * COVERED_TYPES へ移す。理由なしにこのリストへ追加してはならない (新 type は原則 COVERED で作る)。
 */
const RANGE_SSOT_TODO: Partial<Record<MarketplaceTypeCode, string>> = {
	'reward-set':
		'points 値域は reward-set-roundtrip-domain.test.ts が domain oracle 済。定数 SSOT 化は #3151 Phase 2',
	checklist: 'label/icon/order の定数 SSOT 化は #3151 Phase 2',
	'challenge-set': 'durationDays/baseTarget/rewardPoints の定数 SSOT 化は #3151 Phase 2',
	'rule-preset': 'round-trip 網羅自体が未整備 (#3143 追加 finding (a))。#3151 Phase 2/4 で消化',
};

// ── (2) boundary probe 用の valid base item ────────────────────────

/** domain (createActivitySchema) 用 valid base */
const domainItem = (over: Record<string, unknown> = {}) => ({
	name: 'からだをうごかす',
	categoryId: 1,
	icon: '🏃',
	basePoints: 10,
	ageMin: null,
	ageMax: null,
	...over,
});

/** wire (ActivityPackItemSchema) 用 valid base */
const wireItem = (over: Record<string, unknown> = {}) => ({
	name: 'からだをうごかす',
	categoryCode: 'undou',
	icon: '🏃',
	basePoints: 10,
	ageMin: null,
	ageMax: null,
	gradeLevel: null,
	...over,
});

const domainOk = (data: unknown) => createActivitySchema.safeParse(data).success;
const wireOk = (data: unknown) => v.safeParse(ActivityPackItemSchema, data).success;

/** domain / wire 両 schema が同一 field 値で受理/拒否一致することを表明する */
function expectBothSchemas(field: string, value: unknown, expected: boolean) {
	expect(domainOk(domainItem({ [field]: value })), `domain ${field}=${value}`).toBe(expected);
	expect(wireOk(wireItem({ [field]: value })), `wire ${field}=${value}`).toBe(expected);
}

describe('#3151 値域 SSOT fitness (domain⊆wire、ADR-0066)', () => {
	describe('(1) no-silent-gap: 全 marketplace type が COVERED / TODO に分類済', () => {
		it('MARKETPLACE_TYPE_CODES の全 type が分類されている (未分類 = fail)', () => {
			for (const code of MARKETPLACE_TYPE_CODES) {
				const classified = COVERED_TYPES.includes(code) || code in RANGE_SSOT_TODO;
				expect(
					classified,
					`type "${code}" が値域 SSOT fitness の分類外です。新 type は値域定数を domain 層 SSOT に置き ` +
						'COVERED_TYPES に登録するか、暫定なら RANGE_SSOT_TODO に理由付きで pin してください (silent skip 禁止)',
				).toBe(true);
			}
		});
		it('COVERED と TODO の二重分類がない', () => {
			for (const code of COVERED_TYPES) {
				expect(code in RANGE_SSOT_TODO, `type "${code}" が COVERED と TODO に二重分類`).toBe(false);
			}
		});
	});

	describe('(2) activity-pack: domain と wire が SSOT 境界で一致 (boundary probe)', () => {
		it('basePoints: SSOT max 受理 / max+1 拒否 / min 受理 / min-1 拒否 が両 schema で一致', () => {
			// #3132 root class の regression lock: 旧 wire maxValue(10000) は domain max(100) の 100 倍ドリフトだった
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MAX, true);
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MAX + 1, false);
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MIN, true);
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MIN - 1, false);
		});

		it('ageMin/ageMax: SSOT max (20) 受理 / max+1 拒否 / min-1 拒否 が両 schema で一致', () => {
			// #3151 是正の regression lock: 旧 wire maxValue(18) は domain max(20) が許す行の往復を破っていた
			for (const field of ['ageMin', 'ageMax']) {
				expectBothSchemas(field, ACTIVITY_AGE_MAX, true);
				expectBothSchemas(field, ACTIVITY_AGE_MAX + 1, false);
				expectBothSchemas(field, ACTIVITY_AGE_MIN, true);
				expectBothSchemas(field, ACTIVITY_AGE_MIN - 1, false);
			}
		});

		it('name: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothSchemas('name', 'あ'.repeat(ACTIVITY_NAME_MAX), true);
			expectBothSchemas('name', 'あ'.repeat(ACTIVITY_NAME_MAX + 1), false);
		});

		it('triggerHint: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			// #3151 是正: 旧 wire maxLength(200) は domain max(30) との二重定義ドリフトだった
			expectBothSchemas('triggerHint', 'あ'.repeat(ACTIVITY_TRIGGER_HINT_MAX), true);
			expectBothSchemas('triggerHint', 'あ'.repeat(ACTIVITY_TRIGGER_HINT_MAX + 1), false);
		});

		it('description: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			// #3151 是正: 旧 wire maxLength(500) は domain max(200) との二重定義ドリフトだった
			expectBothSchemas('description', 'あ'.repeat(ACTIVITY_DESCRIPTION_MAX), true);
			expectBothSchemas('description', 'あ'.repeat(ACTIVITY_DESCRIPTION_MAX + 1), false);
		});

		it('icon: ZWJ 連結絵文字 2 個 (2 grapheme / 22 UTF-16 units) 受理 / 3 grapheme 拒否 が両 schema で一致', () => {
			// #3151 是正: 旧 wire maxLength(20) (UTF-16 units) は domain の 2 grapheme 許容 (家族絵文字 2 個
			// = 22 units) を弾き domain⊆wire を破っていた。isValidActivityIcon 共有 oracle で表現方式ごと統一。
			const zwjFamily = '👨‍👩‍👧‍👦';
			expect(ACTIVITY_ICON_MAX_GRAPHEMES).toBe(2);
			expectBothSchemas('icon', zwjFamily.repeat(ACTIVITY_ICON_MAX_GRAPHEMES), true);
			expectBothSchemas('icon', zwjFamily.repeat(ACTIVITY_ICON_MAX_GRAPHEMES + 1), false);
			expectBothSchemas('icon', '', false);
		});
	});
});
