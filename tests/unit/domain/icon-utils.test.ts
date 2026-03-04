// tests/unit/domain/icon-utils.test.ts
import { describe, expect, it } from 'vitest';
import { joinIcon, splitIcon } from '../../../src/lib/domain/icon-utils';

describe('splitIcon', () => {
	it('単一絵文字を正しくパースする', () => {
		expect(splitIcon('🤸')).toEqual({ main: '🤸', sub: null });
	});

	it('2つの絵文字を分割する', () => {
		expect(splitIcon('🛁🧹')).toEqual({ main: '🛁', sub: '🧹' });
	});

	it('ZWJ結合絵文字を1つとして扱う', () => {
		expect(splitIcon('👨‍👩‍👧')).toEqual({ main: '👨‍👩‍👧', sub: null });
	});

	it('バリエーションセレクタ付き絵文字を正しく扱う', () => {
		expect(splitIcon('✏️')).toEqual({ main: '✏️', sub: null });
	});

	it('空文字列を安全に扱う', () => {
		expect(splitIcon('')).toEqual({ main: '', sub: null });
	});

	it('3つ以上の絵文字は最初の2つだけ使う', () => {
		const result = splitIcon('🛁🧹✨');
		expect(result.main).toBe('🛁');
		expect(result.sub).toBe('🧹');
	});

	it('ZWJ結合絵文字 + 通常絵文字の複合', () => {
		expect(splitIcon('👨‍👩‍👧🎉')).toEqual({ main: '👨‍👩‍👧', sub: '🎉' });
	});
});

describe('joinIcon', () => {
	it('メインのみの場合はそのまま返す', () => {
		expect(joinIcon('🤸', null)).toBe('🤸');
	});

	it('メインとサブを結合する', () => {
		expect(joinIcon('🛁', '🧹')).toBe('🛁🧹');
	});
});
