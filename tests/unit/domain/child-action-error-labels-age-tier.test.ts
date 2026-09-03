// tests/unit/domain/child-action-error-labels-age-tier.test.ts (#4716 QM)
//
// docs/DESIGN.md §8: preschool / elementary = ひらがな、junior / senior = 漢字。
// 子供向けの失敗文言が 5 年齢モード共通のひらがなだったため、16〜18 歳にも
// 「うまく おくれなかったよ」を返していた。

import { describe, expect, it } from 'vitest';
import { getChildActionErrorLabels } from '../../../src/lib/domain/labels';

/** ひらがな + 記号のみで構成されているか (漢字を含まない)。 */
function isHiraganaOnly(text: string): boolean {
	return !/[\u4e00-\u9fff]/.test(text);
}

describe('#4716 子供向け失敗文言の年齢モード出し分け', () => {
	it('preschool / elementary は漢字を含まない', () => {
		for (const mode of ['preschool', 'elementary']) {
			const l = getChildActionErrorLabels(mode);
			expect(isHiraganaOnly(l.invalidInput), `${mode}: ${l.invalidInput}`).toBe(true);
			expect(isHiraganaOnly(l.unexpected), `${mode}: ${l.unexpected}`).toBe(true);
			expect(isHiraganaOnly(l.pointsNotNumber), `${mode}: ${l.pointsNotNumber}`).toBe(true);
			expect(isHiraganaOnly(l.pinActivityNotFound), `${mode}: ${l.pinActivityNotFound}`).toBe(true);
			expect(isHiraganaOnly(l.pointsOutOfRange(1, 10))).toBe(true);
			expect(isHiraganaOnly(l.pinLimitExceeded(3))).toBe(true);
		}
	});

	it('junior / senior は漢字表記になる', () => {
		for (const mode of ['junior', 'senior']) {
			const l = getChildActionErrorLabels(mode);
			expect(isHiraganaOnly(l.invalidInput), `${mode} がひらがなのまま: ${l.invalidInput}`).toBe(
				false,
			);
			expect(isHiraganaOnly(l.unexpected), `${mode} がひらがなのまま: ${l.unexpected}`).toBe(false);
			expect(isHiraganaOnly(l.pointsNotNumber)).toBe(false);
			expect(isHiraganaOnly(l.pinActivityNotFound)).toBe(false);
			expect(isHiraganaOnly(l.pointsOutOfRange(1, 10))).toBe(false);
			expect(isHiraganaOnly(l.pinLimitExceeded(3))).toBe(false);
		}
	});

	// adv-4802: 旧 6 key の列挙だと後から足した key が guard 外になる。全 key を走査する
	// (関数値は代表引数で評価)。
	function renderAll(labels: ReturnType<typeof getChildActionErrorLabels>): [string, string][] {
		return Object.entries(labels).map(([key, v]) => [
			key,
			typeof v === 'function' ? String((v as (...a: number[]) => string)(1, 10)) : String(v),
		]);
	}

	it('preschool / elementary は全 key が漢字を含まない', () => {
		for (const mode of ['preschool', 'elementary']) {
			for (const [key, text] of renderAll(getChildActionErrorLabels(mode))) {
				expect(isHiraganaOnly(text), `${mode}.${key}: ${text}`).toBe(true);
			}
		}
	});

	it('junior / senior は全 key が漢字を含む (ひらがな側と同文にならない)', () => {
		const kana = new Map(renderAll(getChildActionErrorLabels('preschool')));
		for (const mode of ['junior', 'senior']) {
			for (const [key, text] of renderAll(getChildActionErrorLabels(mode))) {
				expect(text, `${mode}.${key} がひらがな側と同文`).not.toBe(kana.get(key));
			}
		}
	});

	it('key の集合は年齢モードで一致する (片方だけ増えて未定義になるのを防ぐ)', () => {
		const kanaKeys = Object.keys(getChildActionErrorLabels('preschool')).sort();
		const kanjiKeys = Object.keys(getChildActionErrorLabels('senior')).sort();
		expect(kanjiKeys).toEqual(kanaKeys);
	});

	it('年齢帯を渡せない経路 (undefined / 未知の値) はひらがなに落ちる', () => {
		expect(getChildActionErrorLabels(undefined).invalidInput).toBe(
			getChildActionErrorLabels('preschool').invalidInput,
		);
		expect(getChildActionErrorLabels('unknown-mode').invalidInput).toBe(
			getChildActionErrorLabels('preschool').invalidInput,
		);
	});

	it('baby (親の準備モード) はひらがな側 (ADR-0011: 子供向けゲーミフィケーション非適用)', () => {
		expect(isHiraganaOnly(getChildActionErrorLabels('baby').invalidInput)).toBe(true);
	});
});
