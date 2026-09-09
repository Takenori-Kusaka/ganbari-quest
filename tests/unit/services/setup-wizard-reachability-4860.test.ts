// tests/unit/services/setup-wizard-reachability-4860.test.ts
//
// #4860 must-B の回帰固定。
//
// セットアップウィザードは 9 step (children → questionnaire → packs → activities-defaults →
// rewards → rules → challenges → first-adventure → complete) あるが、**step 2 以降が
// 原理的に開けなかった**。
//
// 実測 (まっさらな DB、local モード):
//   POST /setup/children?/next → 302 / → 302 /elementary/home → 302 /switch
//   step 1 の action は `redirect(302, '/setup/questionnaire')` を返しているのに、そこへ着けない。
//
// 機序:
//   - `isSetupRequired` は「子供が 1 人でも居れば false」(setup-service.ts)
//   - `hooks.server.ts` は「`isSetupRequired` が false なら /setup を全部ブロック」
//   → step 1 で子供を登録した瞬間に、残り 8 step が閉まる。
//
// 「完了」を子供の人数で測っていたのが誤り。ウィザードを**歩き始めたか / 歩き終えたか**で持つ。
//
// 固定する不変条件:
//   [R1] 子供 0 人 = セットアップ必須 → ブロックしない (ウィザードへ入れる)
//   [R2] 子供 1 人 + 歩いている最中 → ブロックしない (step 2 以降が開く = 本欠陥の是正)
//   [R3] 子供 1 人 + 歩き終えた → ブロックする (完了後の再突入を防ぐ従来の意図)
//   [R4] 子供 1 人 + 印なし (既存テナント) → ブロックする (既存挙動を変えない)

import { describe, expect, it } from 'vitest';
import { shouldBlockSetupAccess } from '../../../src/lib/server/services/setup-service';

describe('[R1][R2][R3][R4] /setup へのアクセス可否', () => {
	it('子供 0 人 (セットアップ必須) は通す', () => {
		expect(
			shouldBlockSetupAccess({ setupRequired: true, wizardInProgress: false }),
			'セットアップが必要なのに /setup を塞いでいる',
		).toBe(false);
		// 印の有無に関わらず通る
		expect(shouldBlockSetupAccess({ setupRequired: true, wizardInProgress: true })).toBe(false);
	});

	it('step 1 を終えて歩いている最中は通す (step 2〜9 が開く)', () => {
		expect(
			shouldBlockSetupAccess({ setupRequired: false, wizardInProgress: true }),
			'子供を 1 人登録した瞬間に残り 8 step が閉まる — 本 PR が直した欠陥そのもの',
		).toBe(false);
	});

	it('歩き終えたらブロックする (完了後の再突入を防ぐ従来の意図)', () => {
		expect(shouldBlockSetupAccess({ setupRequired: false, wizardInProgress: false })).toBe(true);
	});

	it('既存テナント (子供が居て印なし) の挙動は変えない', () => {
		// 印を持たない = ウィザードを歩いていない → 従来どおりブロック
		expect(shouldBlockSetupAccess({ setupRequired: false, wizardInProgress: false })).toBe(true);
	});
});

describe('真理値表が 4 通りすべて定義されている', () => {
	it('setupRequired × wizardInProgress の 4 組で例外なく真偽値を返す', () => {
		const results = [true, false].flatMap((setupRequired) =>
			[true, false].map((wizardInProgress) => ({
				setupRequired,
				wizardInProgress,
				blocked: shouldBlockSetupAccess({ setupRequired, wizardInProgress }),
			})),
		);
		expect(results).toHaveLength(4);
		for (const r of results) {
			expect(typeof r.blocked, JSON.stringify(r)).toBe('boolean');
		}
		// ブロックするのは「必須でない かつ 歩いていない」の 1 通りだけ
		expect(results.filter((r) => r.blocked)).toEqual([
			{ setupRequired: false, wizardInProgress: false, blocked: true },
		]);
	});
});
