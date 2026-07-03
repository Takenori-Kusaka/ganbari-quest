/**
 * tests/unit/scripts/check-pr-file-overlap.test.ts (#3369)
 *
 * scripts/check-pr-file-overlap.mjs の純粋関数を unit test する。
 *
 * 第10回 back-merge PR #3368 (main→develop、develop⊇main で changed files 0 件) で
 * `並行 PR ファイル重複チェック` が落ちた。0-file 早期 return が JSON モードでも
 * human-readable 文字列を stdout に流し、後段 `require('/tmp/overlap.json')` が
 * SyntaxError で落ちた (back-merge のたびに赤 check 化)。
 *
 * 本テストは renderOutput / computeOverlaps が:
 *   - 0-file JSON モードで valid JSON ({ overlaps: [] }) を返す (回帰防止の核)
 *   - 0-file text モードで human-readable message を返す
 *   - overlap 有/無を正しく算出・整形する
 * を検証する。
 */

import { describe, expect, it } from 'vitest';

import { computeOverlaps, renderOutput } from '../../../scripts/check-pr-file-overlap.mjs';

describe('renderOutput (#3369 back-merge 0-file 回帰防止)', () => {
	it('0-changed-file + JSON モード → valid JSON で overlaps:[] を返す (SyntaxError 回帰防止)', () => {
		const out = renderOutput({
			prNumber: '3368',
			currentFiles: [],
			overlaps: [],
			openPrsCount: 0,
			outputMode: 'json',
		});
		// require('/tmp/overlap.json') 相当: 必ず JSON.parse 可能であること
		const parsed = JSON.parse(out);
		expect(parsed.prNumber).toBe(3368);
		expect(parsed.currentFileCount).toBe(0);
		expect(parsed.overlaps).toEqual([]);
		// consumer (pr-info.yml) は (j.overlaps || []).length を読む → 配列であること
		expect(Array.isArray(parsed.overlaps)).toBe(true);
	});

	it('0-changed-file + text モード → human-readable message を返す', () => {
		const out = renderOutput({
			prNumber: '3368',
			currentFiles: [],
			overlaps: [],
			openPrsCount: 0,
			outputMode: 'text',
		});
		expect(out).toContain('has no changed files');
		// text モードの message は JSON ではない (text 経路では parse されないため許容)
		expect(() => JSON.parse(out)).toThrow();
	});

	it('overlap あり + JSON モード → overlaps に共有ファイルを含む valid JSON', () => {
		const overlaps = [
			{ number: 100, title: 'other', author: 'x', isDraft: false, sharedFiles: ['a.ts'] },
		];
		const out = renderOutput({
			prNumber: '200',
			currentFiles: ['a.ts', 'b.ts'],
			overlaps,
			openPrsCount: 1,
			outputMode: 'json',
		});
		const parsed = JSON.parse(out);
		expect(parsed.currentFileCount).toBe(2);
		expect(parsed.overlaps[0].sharedFiles).toEqual(['a.ts']);
	});

	it('overlap なし + text モード → no overlap message', () => {
		const out = renderOutput({
			prNumber: '200',
			currentFiles: ['a.ts'],
			overlaps: [],
			openPrsCount: 3,
			outputMode: 'text',
		});
		expect(out).toContain('no overlap with 3 other open PRs');
	});
});

describe('computeOverlaps (#3369)', () => {
	it('共有ファイルを持つ PR のみ overlap として返す', () => {
		const current = ['a.ts', 'b.ts'];
		const others = [
			{ number: 1, title: 'p1', author: { login: 'u1' }, isDraft: false, files: ['a.ts', 'c.ts'] },
			{ number: 2, title: 'p2', author: { login: 'u2' }, isDraft: true, files: ['x.ts'] },
		];
		const overlaps = computeOverlaps(current, others);
		expect(overlaps).toHaveLength(1);
		const [first] = overlaps;
		if (!first) throw new Error('expected one overlap');
		expect(first.number).toBe(1);
		expect(first.sharedFiles).toEqual(['a.ts']);
		expect(first.author).toBe('u1');
	});

	it('現 PR が 0-file なら overlap は空 (back-merge)', () => {
		const overlaps = computeOverlaps([], [{ number: 1, title: 'p1', files: ['a.ts'] }]);
		expect(overlaps).toEqual([]);
	});

	it('author.login 欠落時は "unknown" にフォールバック', () => {
		const overlaps = computeOverlaps(['a.ts'], [{ number: 1, title: 'p1', files: ['a.ts'] }]);
		const [first] = overlaps;
		if (!first) throw new Error('expected one overlap');
		expect(first.author).toBe('unknown');
	});
});
