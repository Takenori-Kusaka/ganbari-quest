// tests/unit/domain/seed-kanji-name-kana-4690.test.ts
//
// #4690 (QM #4809): `SEED_KANJI_NAME_KANA` (表示時の読み補完) が seed.ts の
// 「漢字を含む name + nameKana」の全組と一致することを固定する。seed に kana 付きの漢字名を
// 足したら辞書にも足す (既 seed 済 DB の行は追補経路で kana が入らないため、辞書が唯一の救済)。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getActivityDisplayName,
	SEED_KANJI_NAME_KANA,
} from '../../../src/lib/domain/validation/activity';

const SEED = join(__dirname, '../../../src/lib/server/db/seed.ts');

function kanjiNameKanaPairsFromSeed(): Record<string, string> {
	const src = readFileSync(SEED, 'utf8');
	const out: Record<string, string> = {};
	const re = /\{[^{}]*?name:\s*'([^']*[一-鿿][^']*)'[^{}]*?\}/g;
	for (const m of src.matchAll(re)) {
		const name = m[1];
		const kana = m[0].match(/nameKana:\s*'([^']+)'/)?.[1];
		if (name && kana) out[name] = kana;
	}
	return out;
}

describe('#4690 seed 由来の漢字活動名の読み辞書', () => {
	it('SEED_KANJI_NAME_KANA は seed.ts の「漢字 name + nameKana」全組と一致する', () => {
		const fromSeed = kanjiNameKanaPairsFromSeed();
		expect(Object.keys(fromSeed).length).toBeGreaterThan(0);
		expect({ ...SEED_KANJI_NAME_KANA }).toEqual(fromSeed);
	});

	it('nameKana が無い既存行でも preschool には読みが出る (seed 済 DB の救済)', () => {
		expect(getActivityDisplayName({ name: '水やりをする', nameKana: null }, 4)).toBe(
			'みずやりをする',
		);
		// 行に kana があればそちらが優先
		expect(getActivityDisplayName({ name: '水やりをする', nameKana: 'みずやり' }, 4)).toBe(
			'みずやり',
		);
		// 漢字を読む年齢は name のまま
		expect(getActivityDisplayName({ name: '水やりをする', nameKana: null }, 10)).toBe(
			'水やりをする',
		);
		// 辞書に無い名前は従来どおり name
		expect(getActivityDisplayName({ name: 'たいそうした', nameKana: null }, 4)).toBe(
			'たいそうした',
		);
	});
});
