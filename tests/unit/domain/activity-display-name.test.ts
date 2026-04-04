import { describe, expect, it } from 'vitest';
import { getActivityDisplayName, KANJI_AGE_THRESHOLD } from '$lib/domain/validation/activity';

describe('getActivityDisplayName', () => {
	const activity = {
		name: 'おかたづけした',
		nameKana: 'おかたづけした',
		nameKanji: 'お片付けをした',
	};

	it('KANJI_AGE_THRESHOLD は 6 であること', () => {
		expect(KANJI_AGE_THRESHOLD).toBe(6);
	});

	it('6歳以上かつ nameKanji がある場合、漢字表記を返す', () => {
		expect(getActivityDisplayName(activity, 6)).toBe('お片付けをした');
		expect(getActivityDisplayName(activity, 10)).toBe('お片付けをした');
	});

	it('6歳未満かつ nameKana がある場合、ひらがな表記を返す', () => {
		expect(getActivityDisplayName(activity, 5)).toBe('おかたづけした');
		expect(getActivityDisplayName(activity, 3)).toBe('おかたづけした');
	});

	it('nameKana/nameKanji が null の場合、name をフォールバック', () => {
		const noKana = { name: 'テスト活動', nameKana: null, nameKanji: null };
		expect(getActivityDisplayName(noKana, 3)).toBe('テスト活動');
		expect(getActivityDisplayName(noKana, 10)).toBe('テスト活動');
	});

	it('6歳以上でも nameKanji が null なら name を返す', () => {
		const onlyKana = { name: 'デフォルト', nameKana: 'でふぉると', nameKanji: null };
		expect(getActivityDisplayName(onlyKana, 8)).toBe('デフォルト');
	});

	it('6歳未満でも nameKana が null なら name を返す', () => {
		const onlyKanji = { name: 'デフォルト', nameKana: null, nameKanji: '漢字名' };
		expect(getActivityDisplayName(onlyKanji, 4)).toBe('デフォルト');
	});

	it('境界値: 5歳はひらがな、6歳は漢字', () => {
		expect(getActivityDisplayName(activity, 5)).toBe('おかたづけした');
		expect(getActivityDisplayName(activity, 6)).toBe('お片付けをした');
	});

	it('nameKana/nameKanji が undefined の場合も name をフォールバック', () => {
		const minimal = { name: 'ミニマル' };
		expect(getActivityDisplayName(minimal, 3)).toBe('ミニマル');
		expect(getActivityDisplayName(minimal, 10)).toBe('ミニマル');
	});
});
