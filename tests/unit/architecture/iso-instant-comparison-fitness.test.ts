// cspell:ignore fromdateiso todate
//   ↑ `fromdateiso8601` / `todate` は jq の組込関数名。是正後の形を検出器が violation にしないこと
//     (YML_NORMALIZED) を assert するため、綴りをそのまま持つ必要がある。
// tests/unit/architecture/iso-instant-comparison-fitness.test.ts (#4624 / #4053 AC1)
//
// # 何を守るか
//
// **ISO8601 の値を文字列のまま `<` / `>` / `<=` / `>=` / `localeCompare` で比較すること**を禁止する。
// 比較は必ず epoch へ正規化してから行う (JS = `scripts/lib/iso-instant.mjs` / jq = `fromdateiso8601`)。
//
// # なぜ機械化するか
//
// ISO8601 の文字列比較は辞書順であって時刻順ではない。`2026-07-26T08:01:03+09:00` と
// `2026-07-25T23:01:03Z` は同一時刻だが文字列としては等しくない。
//
// #4053 の実害: 統合 PR の含有 PR 一覧が `select(.mergedAt >= "$SINCE_ISO")` で絞られており、
// anchor 側が commit の記録 TZ (`+09:00`)、`mergedAt` 側が `Z` 形だったため、**main..develop に
// 21 本ある merged PR が 3 本しか出なかった**。main リリースの監査証跡 (#2950 AC4) と `Closes`
// 集約 (#3423) が同時に壊れた。顧客画面には出ないが、リリース運用が静かに壊れる級。
//
// #4053 の修正は正規化関数 (`toEpochMs` / `isAtOrAfterInstant`) を `collect-integration-prs.mjs`
// の中に置き、「再導入時はこれを使え」という **回帰ロックのつもりで残した**。だが #4624 時点で
// 実測したところ、**同じ欠陥が別の 2 箇所に生きたまま残っていた**:
//
//   - `.github/workflows/integration-attest.yml` — `select(.mergedAt >= \"$SINCE_ISO\")` (#4053 と同一形)
//   - `scripts/check-admin-bypass-evidence.mjs`  — `pr.mergedAt >= sinceIso`
//
// **誰も呼ばない関数を置いておくだけでは回帰ロックにならない** (次に時刻比較を書く人がその file を
// 開く保証がない)。そこで関数は共有 lib へ出し、規律そのものは本 fitness function で強制する。
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** JS 側の走査 root (`.mjs` のみ。`tests/**` は検査対象外 — 負例 fixture を置けるようにする)。 */
const JS_ROOTS = ['scripts', '.claude/hooks'];

/** yml 側の走査 root。 */
const YML_GLOBS = ['.github/workflows/*.yml', '.github/workflows/*.yaml'];

const EXCLUDED_PATH_PARTS = ['node_modules'];

/** 順序比較の演算子。 */
const RELATIONAL = new Set([
	ts.SyntaxKind.LessThanToken,
	ts.SyntaxKind.GreaterThanToken,
	ts.SyntaxKind.LessThanEqualsToken,
	ts.SyntaxKind.GreaterThanEqualsToken,
]);

/**
 * 「ISO8601 文字列を持っている」と名前から読み取れる識別子か。
 *
 * `Date` / `Time` で終わる名前は `Date` オブジェクトのことが多く、Date 同士の `>=` は正しく動く
 * ため対象にしない。**文字列であることが名前から分かるもの**だけに絞る (誤検出を出すと gate ごと
 * 無視されるため)。
 */
function isIsoStringName(name: string): boolean {
	return /(^|[a-z0-9_])(iso)$/i.test(name) || /^iso[A-Z_]/.test(name) || /[a-z0-9](At)$/.test(name);
}

/** ISO8601 の日時に見える文字列リテラルか。 */
function isIsoLiteral(text: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text);
}

/** 比較の片辺が「ISO 文字列」に見えるか (識別子名 / property 名 / 文字列リテラル)。 */
function looksIso(node: ts.Node): boolean {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return isIsoLiteral(node.text);
	}
	if (ts.isIdentifier(node)) return isIsoStringName(node.text);
	if (ts.isPropertyAccessExpression(node)) return isIsoStringName(node.name.text);
	if (ts.isElementAccessExpression(node)) {
		const arg = node.argumentExpression;
		return ts.isStringLiteral(arg) ? isIsoStringName(arg.text) : false;
	}
	return false;
}

type Violation = { file: string; line: number; snippet: string };

function expand(globs: string[]): string[] {
	const out = new Set<string>();
	for (const g of globs) {
		for (const f of globSync(g, { cwd: REPO_ROOT })) {
			const rel = String(f).replace(/\\/g, '/');
			if (!EXCLUDED_PATH_PARTS.some((p) => rel.includes(p))) out.add(rel);
		}
	}
	return [...out].sort();
}

function lineOf(sf: ts.SourceFile, pos: number): number {
	return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function scanJs(): Violation[] {
	const out: Violation[] = [];
	for (const rel of expand(JS_ROOTS.map((r) => `${r}/**/*.mjs`))) {
		const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
		const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
		const visit = (node: ts.Node) => {
			if (ts.isBinaryExpression(node) && RELATIONAL.has(node.operatorToken.kind)) {
				if (looksIso(node.left) || looksIso(node.right)) {
					out.push({ file: rel, line: lineOf(sf, node.getStart(sf)), snippet: node.getText(sf) });
				}
			}
			// `a.localeCompare(b)` — 受け手か引数のどちらかが ISO なら時刻比較の代用に使われている。
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === 'localeCompare' &&
				(looksIso(node.expression.expression) || node.arguments.some((a) => looksIso(a)))
			) {
				out.push({ file: rel, line: lineOf(sf, node.getStart(sf)), snippet: node.getText(sf) });
			}
			ts.forEachChild(node, visit);
		};
		ts.forEachChild(sf, visit);
	}
	return out;
}

/** epoch 正規化を経ていることが読み取れる語 (これがあれば違反ではない)。 */
const YML_NORMALIZED = /fromdateiso8601|todate|_EPOCH|\+%s|Date\.parse|getTime\(\)/;

/** yml 内の ISO っぽいトークン (jq の `.mergedAt` / shell の `$SINCE_ISO` / `"…T…"`)。 */
const YML_ISO_TOKEN =
	/\.[A-Za-z_][A-Za-z0-9_]*(At|[Ii]so)\b|\$\{?[A-Za-z_]*ISO\b|\d{4}-\d{2}-\d{2}T/;

function scanYml(): Violation[] {
	const out: Violation[] = [];
	for (const rel of expand(YML_GLOBS)) {
		const lines = readFileSync(resolve(REPO_ROOT, rel), 'utf8').split('\n');
		lines.forEach((raw, i) => {
			// yml のブロックスカラー (`key: >` / `key: |`) と comment 行は比較ではない。
			if (/^\s*#/.test(raw)) return;
			const line = raw.replace(/\s#.*$/, '');
			if (/:\s*[>|][-+]?\s*$/.test(line)) return;
			if (!YML_ISO_TOKEN.test(line)) return;
			if (YML_NORMALIZED.test(line)) return;
			// ISO トークンの近傍 (前後 40 字) に順序比較があるものだけを violation とする。
			for (const m of line.matchAll(/>=|<=|(?<![-=<>])[<>](?![-=])/g)) {
				const at = m.index ?? 0;
				const near = line.slice(Math.max(0, at - 40), at + 40);
				if (YML_ISO_TOKEN.test(near)) {
					out.push({ file: rel, line: i + 1, snippet: line.trim() });
					return;
				}
			}
		});
	}
	return out;
}

const FIX_GUIDE = [
	'ISO8601 を文字列のまま順序比較しています (#4053 / #4624)。',
	'`+09:00` 形と `Z` 形は同一時刻でも辞書順が一致しないため、この比較は静かに誤った件数を返します。',
	'',
	'  JS  : scripts/lib/iso-instant.mjs の isAtOrAfterInstant / compareIsoInstant / toEpochMs を使う',
	'  jq  : 両辺を epoch に落とす — select((.mergedAt | fromdateiso8601) >= $SINCE_EPOCH)',
	'  sh  : SINCE_EPOCH=$(date -u -d "$SINCE_ISO" +%s)',
	'',
].join('\n');

describe('#4624 ISO8601 は文字列のまま比較しない (epoch 正規化を通す)', () => {
	it('scripts/**/*.mjs と .claude/hooks/**/*.mjs に ISO 文字列の順序比較が無い', () => {
		const violations = scanJs();
		expect(
			violations.map((v) => `${v.file}:${v.line}  ${v.snippet}`),
			FIX_GUIDE,
		).toEqual([]);
	}, 60_000);

	it('.github/workflows/*.yml に ISO 文字列の順序比較が無い (jq / shell)', () => {
		const violations = scanYml();
		expect(
			violations.map((v) => `${v.file}:${v.line}  ${v.snippet}`),
			FIX_GUIDE,
		).toEqual([]);
	}, 60_000);

	it('検査が空振りしていない (走査対象 file がある / 既知の違反形を検出できる)', () => {
		// 走査対象が 0 件だと上の 2 test が vacuous pass になる。件数を先に固定する。
		expect(expand(JS_ROOTS.map((r) => `${r}/**/*.mjs`)).length).toBeGreaterThan(20);
		expect(expand(YML_GLOBS).length).toBeGreaterThan(5);

		// #4053 の実物 (`pr.mergedAt >= sinceIso`) を合成して、検出器が反応することを直接確かめる。
		const sf = ts.createSourceFile(
			'probe.mjs',
			'const hit = all.filter((pr) => pr.mergedAt >= sinceIso);\n',
			ts.ScriptTarget.ESNext,
			true,
			ts.ScriptKind.JS,
		);
		let detected = false;
		const visit = (node: ts.Node) => {
			if (ts.isBinaryExpression(node) && RELATIONAL.has(node.operatorToken.kind)) {
				if (looksIso(node.left) || looksIso(node.right)) detected = true;
			}
			ts.forEachChild(node, visit);
		};
		ts.forEachChild(sf, visit);
		expect(detected, 'JS 側の検出器が #4053 の実物を検出できていない').toBe(true);

		// yml 側も同様 (#4053 が実際に使っていた jq 式)。
		const ymlLine = '            --jq "[.[] | select(.mergedAt >= \\"$SINCE_ISO\\")]"';
		expect(YML_ISO_TOKEN.test(ymlLine)).toBe(true);
		expect(YML_NORMALIZED.test(ymlLine)).toBe(false);

		// 是正後の形は violation にならない (誤検出で gate ごと無視されるのを防ぐ)。
		const fixedYml =
			'            --jq "[.[] | select((.mergedAt | fromdateiso8601) >= $SINCE_EPOCH)]"';
		expect(YML_NORMALIZED.test(fixedYml)).toBe(true);
	});
});
