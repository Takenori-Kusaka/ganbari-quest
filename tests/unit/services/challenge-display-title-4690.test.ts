// tests/unit/services/challenge-display-title-4690.test.ts
//
// #4690 (QM #4809): 週次チャレンジの title は保存値 (漢字固定) を出さず、targetConfig の
// 構造値から年齢帯の文体で解決し直す (src/routes/CLAUDE.md「保存値を出さず構造値から解決」)。
import { describe, expect, it } from 'vitest';
import { formatChallengeTitle } from '../../../src/lib/domain/labels';
import { resolveChallengeDisplayTitle } from '../../../src/lib/server/services/child-challenge-service';

const stored = {
	title: '今週は「うんどう」を3回',
	targetConfig: JSON.stringify({ categoryId: '1', genMode: 'weakness' }),
	targetValue: 3,
};

describe('#4690 resolveChallengeDisplayTitle', () => {
	it('preschool はひらがな (こんしゅう / かい) + ひらがなカテゴリ名', () => {
		const t = resolveChallengeDisplayTitle(stored, 'preschool');
		expect(t).toBe('こんしゅうは「うんどう」を3かい');
		expect(t).not.toMatch(/[一-鿿]/);
	});

	it('保護者画面 (senior) は漢字 + 漢字カテゴリ名 (保存値の「うんどう」混在を解消)', () => {
		expect(resolveChallengeDisplayTitle(stored, 'senior')).toBe('今週は「運動」を3回');
	});

	it('旧行 (categoryId 無し / 壊れた JSON) は保存値を返す', () => {
		expect(resolveChallengeDisplayTitle({ ...stored, targetConfig: '{}' }, 'preschool')).toBe(
			stored.title,
		);
		expect(resolveChallengeDisplayTitle({ ...stored, targetConfig: 'not json' }, 'preschool')).toBe(
			stored.title,
		);
	});

	it('数値 categoryId (legacy 行、genMode あり) も解決できる', () => {
		expect(
			resolveChallengeDisplayTitle(
				{ ...stored, targetConfig: JSON.stringify({ categoryId: 1, genMode: 'weakness' }) },
				'elementary',
			),
		).toBe('今週は「運動」を3回');
	});

	it('formatChallengeTitle の既定 (保存形) は従来どおり漢字', () => {
		expect(formatChallengeTitle('うんどう', 3)).toBe('今週は「うんどう」を3回');
		expect(formatChallengeTitle('うんどう', 3, 'preschool')).toBe(
			'こんしゅうは「うんどう」を3かい',
		);
	});
});

// #4911: setup wizard (preset / custom) 由来のチャレンジは categoryId (進捗集計用) を持つが
// genMode は持たない。旧実装は categoryId の有無だけで再生成していたため、顧客が選んだタイトル
// (「夏休み読書記録」等) が週次自動生成タイトル (「今週は「勉強」を10回」) に上書きされていた。
describe('#4911 setup preset / custom challenge (genMode 無し) は保存 title を保持する', () => {
	it('categoryId はあるが genMode が無い preset 行は保存済み title をそのまま返す', () => {
		const presetChallenge = {
			title: '夏休み読書記録',
			targetConfig: JSON.stringify({ metric: 'count', baseTarget: 10, categoryId: '2' }),
			targetValue: 10,
		};
		expect(resolveChallengeDisplayTitle(presetChallenge, 'senior')).toBe('夏休み読書記録');
		expect(resolveChallengeDisplayTitle(presetChallenge, 'preschool')).toBe('夏休み読書記録');
	});

	it('categoryId が null (全カテゴリ対象 preset) でも保存済み title を返す', () => {
		const presetChallenge = {
			title: '7 日間連続で記録に挑戦',
			targetConfig: JSON.stringify({ metric: 'count', baseTarget: 7 }),
			targetValue: 7,
		};
		expect(resolveChallengeDisplayTitle(presetChallenge, 'senior')).toBe('7 日間連続で記録に挑戦');
	});

	it('genMode ありの週次自動生成行は引き続き構造値から再生成される (回帰確認)', () => {
		expect(resolveChallengeDisplayTitle(stored, 'senior')).toBe('今週は「運動」を3回');
	});
});
