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

	it('数値 categoryId (legacy 行) も解決できる', () => {
		expect(
			resolveChallengeDisplayTitle(
				{ ...stored, targetConfig: JSON.stringify({ categoryId: 1 }) },
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
