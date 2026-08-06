/**
 * tests/unit/github/pr-body-template-integrity.test.ts (#4022)
 *
 * PR body の「供給元テンプレート」が、その body を検査する gate 自身と矛盾しないことを固定する。
 *
 * 背景: `.github/PULL_REQUEST_TEMPLATE.md` をそのまま貼ると `check-pr-body.mjs` が必ず落ちる
 * 状態が 2 種類あった。
 *   1. 禁止語 (`TODO` / `予定`) を素の本文行に含む → `forbidden-terms` が立つ
 *   2. `pre-ready 全 Step PASS` を Ready チェックリスト項目に持つ → 未チェックだと
 *      `unchecked-ready-checklist` が立つが、そのチェックを外すには pre-ready の実測が要る
 *      という自己参照 deadlock (#4021 で実測)
 *
 * 判定入力は **fixture 文字列ではなく実ファイル**。fixture に対して 0 件を確認するだけの
 * テストは、実 template が将来行を戻しても緑のままになり、守りたい対象を守らない。
 * 加えて body 生成経路は `.github/` の 1 本ではなく skill 側 4 template + back-merge 生成器の
 * 計 7 入力あるため、全経路に同じ assertion をかける。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderBackMergePrBody } from '../../../scripts/back-merge-pr-body.mjs';
import { scanForbiddenTerms, stripMarkdownComments } from '../../../scripts/check-pr-body.mjs';

const repoRoot = resolve(__dirname, '../../..');

/** PR body の供給元となる実テンプレートファイル (#4022 AC11: 1-5 番目の入力)。 */
const TEMPLATE_FILES = [
	'.github/PULL_REQUEST_TEMPLATE.md',
	'.claude/skills/dev-open-pr/templates/pr-body-default.md',
	'.claude/skills/dev-open-pr/templates/pr-body-critical-fix.md',
	'.claude/skills/dev-open-pr/templates/pr-body-lp.md',
	'.claude/skills/dev-open-pr/templates/pr-body-refactor-ssot.md',
] as const;

/**
 * #4305 で `.github/PULL_REQUEST_TEMPLATE.md` は 102 行 → 30 行以下に削減され、
 * `## Ready for Review チェックリスト` セクション自体が撤去された (A 削除)。
 * 撤去済みテンプレートには自己参照 deadlock の入力（未チェック checkbox）が存在し得ないため、
 * 「Ready セクションが無いテンプレート」を deadlock 検査の対象から分離する。
 * `.claude/skills/dev-open-pr/templates/*.md` は #4305 の直接対象外で現行の Ready セクションを
 * 維持しているため、従来どおり deadlock 検査を続ける。
 */
const READY_SECTION_TEMPLATE_FILES = TEMPLATE_FILES.filter(
	(f) => f !== '.github/PULL_REQUEST_TEMPLATE.md',
);

const READY_SECTION_HEADING = '## Ready for Review チェックリスト';

function readTemplate(relPath: string): string {
	return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

/** `## Ready for Review チェックリスト` セクション本文を切り出す (次の `## ` まで)。 */
function extractReadySection(body: string): string {
	const startIdx = body.indexOf(READY_SECTION_HEADING);
	if (startIdx === -1) return '';
	const remaining = body.slice(startIdx + READY_SECTION_HEADING.length);
	const nextSectionIdx = remaining.search(/^## /m);
	return nextSectionIdx === -1 ? remaining : remaining.slice(0, nextSectionIdx);
}

/** Ready セクション内の「未チェックかつ pre-ready に言及する」項目行を返す。 */
function findPreReadyUncheckedItems(body: string): string[] {
	return extractReadySection(body)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => /^- \[ \]/.test(l) && l.includes('pre-ready'));
}

describe('PR body テンプレートは forbidden-terms gate と矛盾しない (#4022 AC1/AC3/AC4)', () => {
	it.each(TEMPLATE_FILES)('%s の禁止語が 0 件', (relPath) => {
		const violations = scanForbiddenTerms(stripMarkdownComments(readTemplate(relPath)));
		expect(
			violations.map((v) => `L${v.lineNo} 「${v.term}」: ${v.line}`),
			`${relPath} を貼っただけで check-pr-body が落ちる状態になっている`,
		).toEqual([]);
	});

	it('HTML コメント内の禁止語は許容する (AC4 境界 — 既存コメントを壊さない)', () => {
		// gate 本体が `<!-- -->` を除外する仕様なので、テンプレ側の解説コメントは対象外。
		const withComment = '<!-- CI 全緑は別途検証される -->\n本文には禁止語なし\n';
		expect(scanForbiddenTerms(stripMarkdownComments(withComment))).toEqual([]);
	});

	it('検査が本当に効いている (禁止語を混ぜたら検出される)', () => {
		const mutated = `${readTemplate('.github/PULL_REQUEST_TEMPLATE.md')}\n- [ ] 残りは TODO\n`;
		expect(scanForbiddenTerms(stripMarkdownComments(mutated)).length).toBeGreaterThan(0);
	});
});

describe('Ready チェックリストに pre-ready 自己参照項目が無い (#4022 AC6/AC8/AC10/AC11)', () => {
	it.each(READY_SECTION_TEMPLATE_FILES)(
		'%s の Ready セクションに pre-ready 未チェック項目が 0 件',
		(relPath) => {
			const body = readTemplate(relPath);
			expect(extractReadySection(body), `${relPath} に Ready セクションが無い`).not.toBe('');
			expect(
				findPreReadyUncheckedItems(body),
				`${relPath}: この項目は check-pr-body → pre-ready → check-pr-body の自己参照 deadlock を作る`,
			).toEqual([]);
		},
	);

	it('`.github/PULL_REQUEST_TEMPLATE.md` は Ready セクション自体を持たない (#4305 で撤去)', () => {
		// #4305: 「Ready for Review チェックリスト」は自己申告 checkbox のみで構成され A 削除された。
		// セクションが存在しない = 自己参照 deadlock の入力が構造的に発生し得ないことを固定する。
		const body = readTemplate('.github/PULL_REQUEST_TEMPLATE.md');
		expect(extractReadySection(body)).toBe('');
	});

	it.each([
		false,
		true,
	])('back-merge 生成器 (isConflict=%s) の Ready セクションにも同項目が無い (AC11 6-7 番目の入力)', (isConflict) => {
		const body = renderBackMergePrBody({
			hotfixPr: 1234,
			hotfixHead: 'fix/1234-example',
			mergeSha: 'abcdef1234567890',
			branch: 'develop',
			isConflict,
		});
		expect(findPreReadyUncheckedItems(body)).toEqual([]);
	});

	it('検査が本当に効いている (項目を戻したら検出される)', () => {
		const mutated = [
			READY_SECTION_HEADING,
			'',
			'- [ ] **`npm run pre-ready -- --pr <num>` 全 Step PASS** をローカル確認した',
			'',
			'## 次のセクション',
		].join('\n');
		expect(findPreReadyUncheckedItems(mutated)).toHaveLength(1);
	});
});
