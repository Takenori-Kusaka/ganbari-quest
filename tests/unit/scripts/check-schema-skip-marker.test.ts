/**
 * tests/unit/scripts/check-schema-skip-marker.test.ts (#4348)
 *
 * schema 系 gate 2 本の **skip marker 判定**の unit test。
 *
 * この 2 本は marker を `PR_BODY.includes('[skip-...]')` で見ており、
 * marker 文字列が本文のどこか (HTML コメント / 引用 / 否定文 / gate 自身のエラー出力の貼り付け /
 * コードブロック内の手順説明) にあるだけで **gate がまるごと skip** されていた。
 * #4348 の対象一覧には無かったが、`.includes` を大文字 `PR_BODY` に対して行うため
 * fitness function の検出器 (`pr-body-partial-match-guard.test.ts`) からも見えていなかった。
 *
 * skip は「宣言」であって「言及」ではない。判定は行単位で、他の PR body gate と同じ規律
 * (`scripts/lib/ci/pr-body-sections.mjs` の `hasDeclarationLine`) に揃える。
 */

import { describe, expect, it } from 'vitest';
import {
	hasSkipMarker as hasTestCheckSkipMarker,
	SKIP_MARKER as TEST_CHECK_MARKER,
} from '../../../scripts/check-schema-change-tests.mjs';
import {
	hasSkipMarker as hasMigrationSkipMarker,
	SKIP_MARKER as MIGRATION_MARKER,
} from '../../../scripts/check-schema-migration-completeness.mjs';

const CASES = [
	{ name: 'check-schema-change-tests', marker: TEST_CHECK_MARKER, has: hasTestCheckSkipMarker },
	{
		name: 'check-schema-migration-completeness',
		marker: MIGRATION_MARKER,
		has: hasMigrationSkipMarker,
	},
] as const;

for (const { name, marker, has } of CASES) {
	describe(`${name}: skip marker は宣言としてのみ成立する (#4348)`, () => {
		it('本文に単独で書かれた marker は skip する (既存挙動)', () => {
			expect(has(`純フォーマット変更のみ。${marker}`)).toBe(true);
		});

		it('marker が無ければ skip しない', () => {
			expect(has('schema.ts に列を追加しました。')).toBe(false);
			expect(has('')).toBe(false);
		});

		it('HTML コメント内の marker では skip しない (顧客にも監査にも見えない)', () => {
			expect(has(`<!-- skip したいときは ${marker} と書く -->`)).toBe(false);
		});

		it('コードブロック / インラインコード内の marker では skip しない (手順の引用)', () => {
			expect(has(['```', `PR 本文に ${marker} を含める`, '```'].join('\n'))).toBe(false);
			expect(has(`skip 方法は \`${marker}\` です`)).toBe(false);
		});

		it('引用行 / 否定文 / 未チェック checkbox の marker では skip しない', () => {
			expect(has(`> ${marker} を書けば skip されます`)).toBe(false);
			expect(has(`本 PR は ${marker} ではありません`)).toBe(false);
			expect(has(`- [ ] ${marker}`)).toBe(false);
			expect(has(`- [x] ${marker}`)).toBe(true);
		});

		it('gate 自身の案内文をそのまま貼っても skip しない (出力の貼り戻しで検査が消えない)', () => {
			// 実際の案内文 (`check-schema-migration-completeness.mjs`) と同じ形。
			expect(
				has(
					`  純フォーマット変更など意図的に skip する場合は PR 本文に "${marker}" を含めてください。`,
				),
			).toBe(false);
		});
	});
}
