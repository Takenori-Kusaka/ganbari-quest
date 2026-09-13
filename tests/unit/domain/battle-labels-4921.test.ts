// tests/unit/domain/battle-labels-4921.test.ts (#4921)
//
// バトル画面 (`(character)/battle`) の文言が年齢帯 variant を持たず、junior/senior
// (13-18 歳) でもひらがな固定だった問題の回帰テスト (docs/DESIGN.md §8)。
// `tests/unit/domain/age-tier-tone-4690.test.ts` と同じ規律: 「今の値が正しいか」では
// なく **禁止パターンの不在** を assert する。

import { describe, expect, it } from 'vitest';
import { getStatLabels, STAT_LABELS } from '../../../src/lib/domain/battle-types';
import { getBattleLabels } from '../../../src/lib/domain/labels';

/** CJK 統合漢字。ひらがな / カタカナ / 記号 / 絵文字は含まない。 */
const KANJI = /[一-鿿]/;

const HIRAGANA_MODES = ['baby', 'preschool', 'elementary'] as const;
const KANJI_MODES = ['junior', 'senior'] as const;

/** 文言セットから表示文字列だけを集める（関数は代表引数で 1 回評価する）。 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
	if (depth > 3) return;
	if (typeof value === 'string') {
		out.push(value);
		return;
	}
	if (typeof value === 'function') {
		try {
			const result = (value as (...args: unknown[]) => unknown)('てき', 10, false);
			if (typeof result === 'string') out.push(result);
		} catch {
			// 引数の形が違う関数は対象外
		}
		return;
	}
	if (value && typeof value === 'object') {
		for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
	}
}

function stringsOf(value: unknown): string[] {
	const out: string[] = [];
	collectStrings(value, out);
	return out;
}

describe('#4921: バトル画面の文言が年齢帯 variant を持つ (docs/DESIGN.md §8)', () => {
	it('junior / senior は FEATURES_LABELS.battle が漢字を含む', () => {
		for (const uiMode of KANJI_MODES) {
			const texts = stringsOf(getBattleLabels(uiMode)).join('\n');
			expect(texts, `${uiMode} に漢字が含まれていない`).toMatch(KANJI);
		}
	});

	it('junior / senior は幼児向けひらがな文言が残っていない', () => {
		const FORBIDDEN_IN_KANJI_MODE = [
			'きょうの バトル',
			'よみこめませんでした',
			'バトルちゅう',
			'きみのステータス',
			'バトル かいし',
			'きょうの バトルは おわったよ',
			'かった！',
			'まけちゃった',
			'なぐさめ',
			'つぎは かてるよ',
			'たおれた',
			'かいしんの いちげき',
			'こうげき！',
		];
		for (const uiMode of KANJI_MODES) {
			const texts = stringsOf(getBattleLabels(uiMode)).join('\n');
			for (const word of FORBIDDEN_IN_KANJI_MODE) {
				expect(texts, `${uiMode} に「${word}」が残っている`).not.toContain(word);
			}
		}
	});

	it('baby / preschool / elementary は従来どおりひらがなのまま（漢字変種が漏れていない）', () => {
		for (const uiMode of HIRAGANA_MODES) {
			const texts = stringsOf(getBattleLabels(uiMode)).join('\n');
			expect(texts, uiMode).toContain('きょうの バトル');
			expect(texts, uiMode).toContain('バトル かいし');
			for (const value of ['今日のバトル', 'バトル開始', '負けてしまった']) {
				expect(texts, `${uiMode} に漢字変種「${value}」が漏れている`).not.toContain(value);
			}
		}
	});

	it('junior / senior の resultWin / rewardWin 等の関数値も漢字体になる', () => {
		for (const uiMode of KANJI_MODES) {
			const t = getBattleLabels(uiMode);
			expect(t.resultLose).toBe('😢 負けてしまった…');
			expect(t.logAttack('てき', 10, true)).toContain('会心の一撃');
			expect(t.logAttack('てき', 10, true)).toContain('の攻撃！');
			expect(t.logDefeated('てき')).toBe('てきは倒れた…');
		}
	});
});

describe('#4921: RPGステータス名 (STAT_LABELS) が年齢帯 variant を持つ', () => {
	it('junior / senior は漢字表記になる', () => {
		for (const uiMode of KANJI_MODES) {
			const labels = getStatLabels(uiMode);
			expect(labels.hp).toBe('体力');
			expect(labels.atk).toBe('攻撃');
			expect(labels.def).toBe('防御');
			expect(labels.spd).toBe('素早さ');
			expect(labels.rec).toBe('回復');
		}
	});

	it('baby / preschool / elementary はひらがなのまま', () => {
		for (const uiMode of HIRAGANA_MODES) {
			const labels = getStatLabels(uiMode);
			expect(labels).toEqual(STAT_LABELS);
		}
	});
});
