// tests/unit/marketplace/export-import-roundtrip-property.test.ts
// #3847 (EPIC #3151): export/import round-trip 不変条件の property-based (fast-check) 化。
//
// 背景 (root class): #3104 (日本語/絵文字の往復破損) と #3132 (値域ドリフト) の 2 サイクル連続
// blocker は、round-trip test が「代表 5 sample の example-based」だったため境界値 / Unicode を
// 探索できず、5-Whys item 5 (test が境界/Unicode を探索しない) に帰着した。本 test は
// `round-trip.test.ts` の example-based な round-trip 不変条件を property-based に **格上げ** し、
// fast-check の generator (`marketplace-arbitraries.ts`、値域 SSOT 定数から導出) で境界 / Unicode を
// 機械探索する。shrinking により最小反例が得られるため、再ドリフト時に原因 payload が特定できる。
//
// 検証する right-inverse (import は export の右逆): 5 type 全てで
//   import(export(x)) == x
//   すなわち parseViaSchema(parseExportEnvelopeV2(JSON 往復(dispatchExport(x))).payload) === x
// を、SSOT 値域から導出した任意 payload x について表明する。

import * as fc from 'fast-check';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { countIconGraphemes } from '$lib/domain/validation/activity';
import { dispatchExport } from '$lib/marketplace/export-dispatcher';
import { parseExportEnvelopeV2 } from '$lib/marketplace/export-schema';
import { MarketplacePayloadSchemaMap, type MarketplaceTypeId } from '$lib/marketplace/schemas';
import { ICON_EMOJI, PAYLOAD_ARBITRARIES } from './marketplace-arbitraries';

/**
 * Strategy.parse() と等価な payload schema (`MarketplacePayloadSchemaMap`) 経由で parse する。
 * 各 Strategy の parse() は内部で同一 schema を呼ぶため、本呼び出しは「Strategy が round-trip
 * envelope の payload を受理する」と等価 (round-trip.test.ts と同一方針)。
 */
function parseViaSchema(typeCode: MarketplaceTypeId, payload: unknown): unknown {
	return v.parse(MarketplacePayloadSchemaMap[typeCode], payload);
}

// 型ごとの numRuns。全 5 type 合計で T1 gate (< 30s) に十分収まる (実測は PR body に記載)。
// icon の grapheme 判定 (Intl.Segmenter) が per-item コストの大半のため、item 数の多い型は
// numRuns を控えめにする。
const NUM_RUNS: Record<MarketplaceTypeId, number> = {
	'activity-pack': 120,
	'reward-set': 120,
	checklist: 120,
	'rule-preset': 120,
	'challenge-set': 100,
};

describe('#3847 generator validity (SSOT 境界を逸脱しない self-check)', () => {
	it('ICON_EMOJI は全て 1 grapheme (単体で isValid*Icon を満たす)', () => {
		for (const e of ICON_EMOJI) {
			expect(countIconGraphemes(e), `icon ${JSON.stringify(e)} は 1 grapheme のはず`).toBe(1);
		}
	});

	it('ICON_EMOJI 2 個連結は必ず 2 grapheme (isValid*Icon 上限 2 を満たし合流しない)', () => {
		for (const a of ICON_EMOJI) {
			for (const b of ICON_EMOJI) {
				expect(countIconGraphemes(a + b), `${JSON.stringify(a + b)} は 2 grapheme のはず`).toBe(2);
			}
		}
	});
});

describe('#3847 export → import round-trip property (fast-check、5 type right-inverse)', () => {
	for (const typeCode of Object.keys(PAYLOAD_ARBITRARIES) as MarketplaceTypeId[]) {
		it(`${typeCode}: import(export(x)) == x を SSOT 値域から導出した任意 payload で表明`, () => {
			fc.assert(
				fc.property(PAYLOAD_ARBITRARIES[typeCode], (payload) => {
					// export: dispatchExport は内部で schema parse するため env.payload = parse(x)。
					// generator は canonical payload のみ生成するので parse は identity → env.payload == x。
					const env = dispatchExport({ typeCode, payload });
					expect(env.payload).toEqual(payload);

					// storage / transport を擬似する JSON 往復。
					const restored = parseExportEnvelopeV2(JSON.parse(JSON.stringify(env)));

					// import(export(x)) == x (right-inverse)。checksum は parseExportEnvelopeV2 内で
					// verify 済 (mismatch なら throw) のため、往復後も改竄なし。
					expect(restored.checksum).toBe(env.checksum);
					expect(restored.payload).toEqual(payload);
					// Strategy.parse 互換 schema 経由でも復元値が x と一致 (apply まで到達可能)。
					expect(parseViaSchema(typeCode, restored.payload)).toEqual(payload);
				}),
				{ numRuns: NUM_RUNS[typeCode] },
			);
		});
	}
});
