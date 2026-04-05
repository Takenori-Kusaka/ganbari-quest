import { describe, expect, it } from 'vitest';
import { formatChildName, formatChildNames, type NameContext } from '$lib/domain/child-display';

describe('formatChildName', () => {
	it('label: 名前をそのまま返す', () => {
		expect(formatChildName('ゆうき')).toBe('ゆうき');
		expect(formatChildName('ゆうき', 'label')).toBe('ゆうき');
	});

	it('possessive: 「〜の」を付ける', () => {
		expect(formatChildName('ゆうき', 'possessive')).toBe('ゆうきの');
	});

	it('vocative: 「〜、」を付ける', () => {
		expect(formatChildName('ゆうき', 'vocative')).toBe('ゆうき、');
	});

	it('subject: 「〜が」を付ける', () => {
		expect(formatChildName('ゆうき', 'subject')).toBe('ゆうきが');
	});

	it('null/undefined/空文字は空文字を返す', () => {
		expect(formatChildName(null)).toBe('');
		expect(formatChildName(undefined)).toBe('');
		expect(formatChildName('')).toBe('');
	});

	it('null/undefined でも context に関わらず空文字', () => {
		const contexts: NameContext[] = ['possessive', 'vocative', 'subject', 'label'];
		for (const ctx of contexts) {
			expect(formatChildName(null, ctx)).toBe('');
			expect(formatChildName(undefined, ctx)).toBe('');
			expect(formatChildName('', ctx)).toBe('');
		}
	});
});

describe('formatChildNames', () => {
	it('複数名を読点で結合し context を適用', () => {
		expect(formatChildNames(['ゆうき', 'はな'], 'possessive')).toBe('ゆうき、はなの');
		expect(formatChildNames(['ゆうき', 'はな'], 'subject')).toBe('ゆうき、はなが');
	});

	it('1名のみ', () => {
		expect(formatChildNames(['ゆうき'], 'possessive')).toBe('ゆうきの');
		expect(formatChildNames(['ゆうき'], 'label')).toBe('ゆうき');
	});

	it('空配列は空文字', () => {
		expect(formatChildNames([])).toBe('');
		expect(formatChildNames([], 'possessive')).toBe('');
	});

	it('空文字を含む配列はフィルタされる', () => {
		expect(formatChildNames(['ゆうき', '', 'はな'], 'possessive')).toBe('ゆうき、はなの');
		expect(formatChildNames(['', ''], 'possessive')).toBe('');
	});
});
