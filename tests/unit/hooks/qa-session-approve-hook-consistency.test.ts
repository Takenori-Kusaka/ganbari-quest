/**
 * tests/unit/hooks/qa-session-approve-hook-consistency.test.ts (#4027 受け入れ条件 5)
 *
 * **2 つの hook の検出条件が相互に矛盾していないこと**を、同じ fixture 集合で機械検証する。
 *
 * # 何を守るか
 * QM の approve 操作 1 つに対して、以下 2 hook が別々の前提で判定を下している:
 *   - `scripts/claude-hook-prevent-qa-account-pr.mjs` (ADR-0022 L1): lab アカウントの PR 作成を止める
 *   - `.claude/hooks/gate-approve.mjs` (ADR-0056): approve / merge を evidence 検証の後ろに置く
 *
 * 片方が「正規の approve 経路」として扱う文字列を、もう片方が「PR 作成」として拒否していても、
 * **どちらの hook も自分の unit test は通る**。矛盾は QM が実際に approve しようとした瞬間まで
 * 検出されなかった (#4027 = PR #4005 で発生)。
 *
 * そこで fixture の出所を **`docs/sessions/qa-session.md` に実際に書かれている approve / merge
 * コマンド** に固定し、同じ集合を両 hook に通して次を同時に assert する:
 *   1. account guard で BLOCK されない (approve が止まらない)
 *   2. gate-approve で捕捉される (evidence gate が素通しされない)
 *   3. PR 番号が抽出できる (gate が「番号不明」で BLOCK しない)
 *
 * SSOT (doc) / hook どちらが drift しても本 test が落ちる。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractPrNumber, isApproveAction } from '../../../.claude/hooks/gate-approve.mjs';
import { containsGhPrCreate } from '../../../scripts/claude-hook-prevent-qa-account-pr.mjs';

const QA_SESSION_PATH = resolve(process.cwd(), 'docs/sessions/qa-session.md');
const APPROVE_SECTION_HEADING = '#### 全手順 Pass → approve & merge';
const FIXTURE_PR_NUMBER = 4027;

/**
 * qa-session.md の approve & merge セクション直下にある bash ブロックを取り出す。
 */
function readApproveCodeBlock(): string {
	const md = readFileSync(QA_SESSION_PATH, 'utf8');
	const headingIndex = md.indexOf(APPROVE_SECTION_HEADING);
	if (headingIndex < 0) {
		throw new Error(
			`qa-session.md に "${APPROVE_SECTION_HEADING}" が見つかりません (見出しを変えたら本 test も更新すること)`,
		);
	}
	const after = md.slice(headingIndex);
	const block = after.match(/```bash\n([\s\S]*?)```/);
	if (!block) {
		throw new Error('approve & merge セクション直下に bash コードブロックがありません');
	}
	return block[1];
}

/**
 * bash ブロックを「1 コマンド = 1 要素」に切る (heredoc 本文で切らない)。
 */
function splitStatements(block: string): string[] {
	const statements: string[] = [];
	let current = '';
	let heredocDelimiter: string | null = null;
	for (const line of block.split('\n')) {
		current = current === '' ? line : `${current}\n${line}`;
		if (heredocDelimiter !== null) {
			if (line.trim() === heredocDelimiter) heredocDelimiter = null;
			continue;
		}
		const heredocStart = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
		if (heredocStart) {
			heredocDelimiter = heredocStart[1];
			continue;
		}
		const opens = (current.match(/\(/g) ?? []).length;
		const closes = (current.match(/\)/g) ?? []).length;
		if (opens === closes) {
			if (current.trim() !== '') statements.push(current);
			current = '';
		}
	}
	if (current.trim() !== '') statements.push(current);
	return statements;
}

/** approve / merge そのものを実行するコマンドか (fixture の分類用、hook の実装は参照しない)。 */
function isApproveOrMergeStatement(statement: string): boolean {
	return (
		/\/pulls\/\d+\/reviews\b/.test(statement) || /\bgh\s+pr\s+(?:merge|review)\b/.test(statement)
	);
}

const statements = splitStatements(readApproveCodeBlock()).map((s) =>
	s.replaceAll('<num>', String(FIXTURE_PR_NUMBER)),
);
const approveStatements = statements.filter(isApproveOrMergeStatement);

describe('qa-session.md の approve / merge コマンドを両 hook に通す (#4027)', () => {
	it('fixture 抽出が空振りしていない (doc からコマンドを取れている)', () => {
		// 抽出が壊れて 0 件になると以降の it.each が vacuous pass になるため、件数を先に固定する。
		expect(statements.length).toBeGreaterThanOrEqual(4);
		expect(approveStatements.length).toBeGreaterThanOrEqual(2);
	});

	it.each(
		statements.map((s) => [s.split('\n')[0].slice(0, 90), s] as const),
	)('account guard で BLOCK されない: %s', (_label, statement) => {
		expect(containsGhPrCreate(statement)).toBe(false);
	});

	it.each(
		approveStatements.map((s) => [s.split('\n')[0].slice(0, 90), s] as const),
	)('gate-approve が approve 操作として捕捉する: %s', (_label, statement) => {
		expect(isApproveAction(statement)).toBe(true);
		expect(extractPrNumber(statement)).toBe(FIXTURE_PR_NUMBER);
	});
});

describe('矛盾解消が guard を弱めていないこと (ADR-0006 / ADR-0022)', () => {
	it('lab アカウントによる PR 作成 (pulls コレクション POST) は引き続き account guard が捕捉する', () => {
		expect(
			containsGhPrCreate(
				'gh api repos/Takenori-Kusaka/ganbari-quest/pulls -X POST -f head=feat/x -f base=develop',
			),
		).toBe(true);
	});

	it('PR 作成コマンドは gate-approve の approve 判定には入らない (責務が混ざっていない)', () => {
		expect(isApproveAction('gh api repos/Takenori-Kusaka/ganbari-quest/pulls -X POST')).toBe(false);
	});
});
