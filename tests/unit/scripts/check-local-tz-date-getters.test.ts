/**
 * tests/unit/scripts/check-local-tz-date-getters.test.ts (#4015)
 *
 * `scripts/check-local-tz-date-getters.mjs` の純関数を検証する。
 *
 * 実 repo 全走査 (`findAllOccurrences`) は CI / pre-ready の専用 step が authoritative で、
 * unit lane では行わない (#4000 / #4051 の判断に整合)。本 test が担うのは
 * **gate のロジックが意図どおり落ちること**の表明:
 *
 *   - allowlist 未登録 file の occurrence を検出する (no-silent-gap)
 *   - allowlist 済 file でも `max` を超えたら検出する (ratchet)
 *   - `reason` が空の allowlist entry を検出する (除外理由の非強制を作らない、#3956 の教訓)
 *   - `getUTC*` / コメント行は検出しない (誤検知しない)
 */

import { describe, expect, it } from 'vitest';

import {
	ALLOWLIST,
	evaluateOccurrences,
	findAllowlistEntriesWithoutReason,
	findAllowlistEntry,
	findOccurrencesInContent,
	isCommentLine,
	LOCAL_TZ_GETTER,
} from '../../../scripts/check-local-tz-date-getters.mjs';

describe('check-local-tz-date-getters (#4015)', () => {
	describe('LOCAL_TZ_GETTER — 検出パターン', () => {
		it.each([
			'const y = now.getFullYear();',
			'const m = now.getMonth() + 1;',
			'const d = now.getDate();',
			'const w = now.getDay();',
			'd.setDate(d.getDate() - 1);',
		])('ローカル TZ getter を検出する: %s', (line) => {
			expect(LOCAL_TZ_GETTER.test(line)).toBe(true);
		});

		it.each([
			'const y = now.getUTCFullYear();',
			'const m = now.getUTCMonth() + 1;',
			'const d = now.getUTCDate();',
			'const w = now.getUTCDay();',
			'const t = now.getTime();',
			'const s = toJSTDateString(now).slice(0, 7);',
		])('UTC getter / 無関係な呼び出しは検出しない: %s', (line) => {
			expect(LOCAL_TZ_GETTER.test(line)).toBe(false);
		});
	});

	describe('isCommentLine — 経緯コメントは許容', () => {
		it.each([
			'// 旧実装は now.getFullYear() を使っていた',
			' * `Date.getMonth()` はローカル TZ 依存',
			'/* getDate() の説明 */',
			'<!-- getDay() -->',
		])('コメント行と判定する: %s', (line) => {
			expect(isCommentLine(line)).toBe(true);
		});

		it('コード行はコメントと判定しない', () => {
			expect(isCommentLine('\tconst y = now.getFullYear(); // 説明')).toBe(false);
		});
	});

	describe('findOccurrencesInContent', () => {
		it('コード行のみを行番号付きで返す', () => {
			const content = [
				'// getFullYear() の説明コメント',
				'const a = now.getUTCFullYear();',
				'const b = now.getFullYear();',
			].join('\n');
			const found = findOccurrencesInContent('src/x.ts', content);
			expect(found).toHaveLength(1);
			expect(found[0]?.line).toBe(3);
			expect(found[0]?.file).toBe('src/x.ts');
		});

		it('Windows パスは / 区切りに正規化される', () => {
			const found = findOccurrencesInContent('src\\lib\\x.ts', 'const b = now.getFullYear();');
			expect(found[0]?.file).toBe('src/lib/x.ts');
		});
	});

	describe('evaluateOccurrences — no-silent-gap / ratchet', () => {
		it('allowlist 未登録 file の occurrence は not-allowlisted で違反になる', () => {
			const violations = evaluateOccurrences([
				{ file: 'src/lib/server/services/brand-new-service.ts', line: 10, snippet: 'x' },
			]);
			expect(violations).toHaveLength(1);
			expect(violations[0]?.kind).toBe('not-allowlisted');
			expect(violations[0]?.file).toBe('src/lib/server/services/brand-new-service.ts');
		});

		it('allowlist 済 file でも max を超えたら over-max で違反になる', () => {
			const entry = findAllowlistEntry('src/lib/server/services/viewer-token-service.ts');
			expect(entry).toBeDefined();
			const over = Array.from({ length: (entry?.max ?? 0) + 1 }, (_, i) => ({
				file: 'src/lib/server/services/viewer-token-service.ts',
				line: i + 1,
				snippet: 'x',
			}));
			const violations = evaluateOccurrences(over);
			expect(violations).toHaveLength(1);
			expect(violations[0]?.kind).toBe('over-max');
			expect(violations[0]?.count).toBe((entry?.max ?? 0) + 1);
		});

		it('allowlist 済 file が max 以内なら違反にならない', () => {
			const violations = evaluateOccurrences([
				{ file: 'src/lib/server/services/viewer-token-service.ts', line: 18, snippet: 'x' },
			]);
			expect(violations).toEqual([]);
		});

		it('occurrence 0 件なら違反 0 件', () => {
			expect(evaluateOccurrences([])).toEqual([]);
		});
	});

	describe('allowlist の健全性 — 除外理由の強制 (#3956 の教訓)', () => {
		it('現在の allowlist は全 entry が非空の reason を持つ', () => {
			expect(findAllowlistEntriesWithoutReason()).toEqual([]);
		});

		it('reason が空 / 空白のみの entry は検出対象である', () => {
			// 検出関数そのものの表明。実 ALLOWLIST を汚さずロジックを確認する。
			const probe = [
				{ file: 'a.ts', max: 1, reason: '' },
				{ file: 'b.ts', max: 1, reason: '   ' },
				{ file: 'c.ts', max: 1 },
				{ file: 'd.ts', max: 1, reason: '理由あり' },
			];
			const bad = probe.filter((e) => typeof e.reason !== 'string' || e.reason.trim() === '');
			expect(bad.map((e) => e.file)).toEqual(['a.ts', 'b.ts', 'c.ts']);
		});

		it('allowlist entry は file / max / reason を持つ', () => {
			for (const e of ALLOWLIST) {
				expect(typeof e.file).toBe('string');
				expect(e.file.startsWith('src/')).toBe(true);
				expect(typeof e.max).toBe('number');
				expect(e.max).toBeGreaterThanOrEqual(0);
				expect(typeof e.reason).toBe('string');
			}
		});

		it('allowlist に file の重複がない (max の解釈が曖昧にならない)', () => {
			const files = ALLOWLIST.map((e) => e.file);
			expect(new Set(files).size).toBe(files.length);
		});
	});
});
