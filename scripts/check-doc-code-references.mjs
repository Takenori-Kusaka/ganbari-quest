#!/usr/bin/env node
/**
 * scripts/check-doc-code-references.mjs
 *
 * Issue #2215 / Re-Issue #2240 (Split A): ドキュメント内に書かれている実装コードパス
 * (`src/...`, `site/...`, `tests/...`, `scripts/...`, `infra/...`, `.github/...`) が
 * 現在のファイルシステム上に存在しているかを突合し、デッドリンクを検知する。
 *
 * # 背景 (Epic 2 #2215 / Epic 3 #2218)
 * Frontmatter の「最終更新日」では「ドキュメントが古いか」は判定できない。実装側の
 * ファイル移動・削除 (#1683 LP SSOT 化 / #2097 demo Lambda 統合 等) に追従できず
 * 設計書だけが旧パスを指し続ける現象が累積し、Claude エージェントを含む読み手が
 * 「存在しないコード」を前提に作業して時間を浪費するインシデントが多発した。
 *
 * 本スクリプトは「ドキュメントに書かれている実装パスが実在するか」を機械的に検証し、
 * baseline で既存違反を pin した上で **新規違反 1 件で CI fail** する (baseline モデル)。
 * `--fix` で陳腐化警告を冒頭に挿入する補助機能も持つ。
 *
 * # OSS 先調査 (ADR-0014)
 * `markdown-link-check` (npm, ~110k downloads/week): URL/相対リンク (`[text](path)`) のみ。
 *   本スクリプトが対象とする「bare path 表記 (`src/lib/foo.ts` を inline code で言及)」は
 *   対象外。
 * `markdownlint` (~3M downloads/week): markdown 文法のみ。実装コードパスの実在性検証なし。
 * `remark-validate-links` (~150k downloads/week): markdown link 形式の検証のみ。bare path
 *   未対応。
 * いずれも「inline code 内に bare path で書かれた `src/...` の実在検証」は守備範囲外。
 * よって本リポジトリ固有用途の小規模独自実装 (~200 行) として維持する。
 *
 * # 改善点 (vs 元 #2226 実装)
 * 1. **skip 判定の marker 化** (line 33 fragile fullmatch → stable marker):
 *    元実装は「`> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。`」
 *    の文字列完全一致だった。warning 本文を 1 文字でも変えると判定が壊れる。本実装では
 *    `<!-- doc-status: deprecated -->` HTML コメントを stable marker とし、warning 本文の
 *    細部変更に追従可能にする (warning 文末尾に Issue 番号や日付追記しても判定維持)。
 *    後方互換のため旧 fullmatch も継続サポート。
 *
 * 2. **fenced code block の除外**:
 *    `` ```bash ... ``` `` の中で `cd src/lib && ls` のように記述されたパスは、
 *    「コード例」であり「実装の参照」ではない場合がある。fenced code block 内の path は
 *    skip する (markdown AST を使わず、行頭 ``` の出現で toggle するシンプル実装)。
 *
 * 3. **inline code (バッククォート) と bare path の区別**:
 *    元実装は単純 split で両方拾っていた。両方拾うこと自体は本機構の目的に適うが、
 *    エラーメッセージで「inline code (`src/...`)」「bare path」を区別表示し、修正者が
 *    どちらの記法かを判断できるようにする。
 *
 * 4. **baseline モデル** (`scripts/doc-code-references-baseline.json`):
 *    `scripts/check-lp-inline-style.mjs` 同型。既存違反のファイル別件数を pin し、
 *    新規違反 1 件で exit 1 する。意図的増減時のみ `--update-baseline` で更新。
 *    Pre-PMF (ADR-0010) 段階で既存違反の全件 fix を強制せず、新規追加を防ぐ防衛ライン
 *    として機能する。Split C (ADR + design への一括 Deprecated 警告挿入) を skip しても
 *    CI gate が成立する設計。
 *
 * # CLI
 *   node scripts/check-doc-code-references.mjs                    # baseline 検証 (exit 1 on new violations)
 *   node scripts/check-doc-code-references.mjs --json             # JSON 出力
 *   node scripts/check-doc-code-references.mjs --update-baseline  # baseline 更新 (意図的差分時のみ)
 *   node scripts/check-doc-code-references.mjs --fix              # Deprecated 警告挿入 (新規違反に対して、補助機能)
 *
 * # 関連 Issue / PR
 *   #2215 Epic 2 鮮度チェック / #2218 Epic 3 陳腐化整理 / #2240 Re-Issue (3 PR 分割)
 *   #2226 (CLOSED) 旧巨大 PR の close 候補
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.resolve(REPO_ROOT, 'scripts/doc-code-references-baseline.json');

const CODEBASE_PREFIXES = ['src/', 'site/', 'tests/', 'scripts/', 'infra/', '.github/'];

/**
 * Deprecated 判定の stable marker (#2240 改善 1)。
 * 旧 fullmatch も継続サポートして後方互換を保つ。
 */
const DEPRECATED_MARKERS = [
	'<!-- doc-status: deprecated -->',
	'status: deprecated',
	'> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。',
];

const DEPRECATED_WARNING_HTML = '<!-- doc-status: deprecated -->';
const DEPRECATED_WARNING_BODY =
	'> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。\n>\n> 自動検知: `scripts/check-doc-code-references.mjs` が実装側に存在しないパスへの参照を検出。\n> 内容を最新の実装に追従させるか、本ファイルを削除/移動してください。';

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => {
			const [k, v] = a.replace(/^--/, '').split('=');
			return [k, v ?? 'true'];
		}),
);

const FIX = args.fix === 'true';
const JSON_OUTPUT = args.json === 'true';
const UPDATE_BASELINE = args['update-baseline'] === 'true';

/**
 * 再帰的にディレクトリを走査し ext で終わるファイルを収集。
 */
function getFiles(dir, ext, fileList = []) {
	if (!fs.existsSync(dir)) return fileList;
	const files = fs.readdirSync(dir);
	for (const file of files) {
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) {
			getFiles(filePath, ext, fileList);
		} else if (filePath.endsWith(ext)) {
			fileList.push(filePath);
		}
	}
	return fileList;
}

/**
 * fenced code block の内側行を skip した内容を返す (改善 2)。
 * ```` ``` ```` (3 連続 backtick) の出現で toggle するシンプル実装。
 * markdown AST (remark) は依存追加コストに見合わないため未採用。
 */
function stripFencedCodeBlocks(content) {
	const lines = content.split(/\r?\n/);
	let inFence = false;
	const out = [];
	for (const line of lines) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence) out.push(line);
	}
	return out.join('\n');
}

/**
 * 単一パス文字列を normalize (`#anchor`, `::method`, `:linenum`, 末尾句読点を除去)。
 */
function normalizePath(raw) {
	let p = raw.split('#')[0];
	p = p.split('::')[0];
	p = p.replace(/:\d+(-\d+)?$/, '');
	p = p.replace(/[.,:;!?）)」]+$/, '');
	if (p.endsWith('/')) p = p.slice(0, -1);
	return p;
}

/**
 * 実装パス記法かを判定 (glob / 変数展開 / 短すぎる断片を除外)。
 */
function isCheckableImplPath(p) {
	if (!CODEBASE_PREFIXES.some((prefix) => p.startsWith(prefix))) return false;
	if (p.includes('*') || p.includes('{') || p.includes('$')) return false;
	if (p.length < 5) return false; // src/x 程度の短すぎる断片は対象外
	return true;
}

/**
 * 改善 1: Deprecated marker のいずれかが含まれるかを判定。
 */
function isMarkedDeprecated(content) {
	return DEPRECATED_MARKERS.some((marker) => content.includes(marker));
}

/**
 * Deprecated 警告を挿入。H1 直後 (存在すれば) または冒頭に。
 */
function insertDeprecatedWarning(filePath) {
	const fc = fs.readFileSync(filePath, 'utf-8');
	const block = `${DEPRECATED_WARNING_HTML}\n\n${DEPRECATED_WARNING_BODY}\n\n`;
	let newContent;
	if (fc.startsWith('# ')) {
		const parts = fc.split('\n');
		parts.splice(1, 0, '', block);
		newContent = parts.join('\n');
	} else {
		newContent = block + fc;
	}
	fs.writeFileSync(filePath, newContent);
}

/**
 * 全 markdown ファイルを集める。
 */
function collectMdFiles() {
	const mdFiles = getFiles('docs', '.md');
	if (fs.existsSync('CLAUDE.md')) mdFiles.push('CLAUDE.md');
	if (fs.existsSync('DESIGN.md')) mdFiles.push('DESIGN.md');
	for (const dir of ['src', 'tests', 'scripts', 'infra', '.github']) {
		const candidate = path.join(dir, 'CLAUDE.md');
		if (fs.existsSync(candidate)) mdFiles.push(candidate);
	}
	for (const nested of getFiles('src', 'CLAUDE.md')) {
		if (!mdFiles.includes(nested)) mdFiles.push(nested);
	}
	return mdFiles.sort();
}

/**
 * 1 ファイルを走査して違反 (実在しないパス参照) を返す。
 */
function findViolationsInFile(file) {
	const original = fs.readFileSync(file, 'utf-8');
	if (isMarkedDeprecated(original)) return [];

	const content = stripFencedCodeBlocks(original);

	const inlinePaths = new Set();
	const inlineRe = /`([^`\n]+)`/g;
	let m;
	while ((m = inlineRe.exec(content)) !== null) {
		const candidate = normalizePath(m[1]);
		if (isCheckableImplPath(candidate)) inlinePaths.add(candidate);
	}

	const words = content.split(/[\s`"'()\[\]\n\r<>]+/);
	const checked = new Set();
	const violations = [];

	for (const word of words) {
		const cleanPath = normalizePath(word);
		if (!isCheckableImplPath(cleanPath)) continue;
		if (checked.has(cleanPath)) continue;
		checked.add(cleanPath);

		if (!fs.existsSync(cleanPath)) {
			violations.push({
				path: cleanPath,
				refType: inlinePaths.has(cleanPath) ? 'inline' : 'bare',
			});
		}
	}
	return violations;
}

function loadBaseline() {
	if (!fs.existsSync(BASELINE_PATH)) {
		return { totals: {}, generatedAt: null };
	}
	try {
		return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
	} catch {
		return { totals: {}, generatedAt: null };
	}
}

function saveBaseline(totals) {
	const data = {
		_comment:
			'#2240 Split A baseline: ドキュメント内の実装コードパス参照のうち実在しないものをファイル別件数で pin する。新規違反 1 件で CI fail。Split C (ADR + design 配下への Deprecated 警告一括挿入) は Pre-PMF 過剰防衛 (ADR-0010 §3 Bucket B) として skip し、本 baseline で防衛ラインを成立させる。意図的増減時のみ --update-baseline で更新。',
		totals,
		generatedAt: new Date().toISOString(),
	};
	const json = JSON.stringify(data, null, '\t');
	fs.writeFileSync(BASELINE_PATH, `${json}\n`, 'utf-8');
}

/**
 * baseline と現状 totals を比較して exceedances を計算
 */
function calculateExceedances(fileTotals, baselineTotals) {
	const exceedances = [];
	for (const [file, count] of Object.entries(fileTotals)) {
		const allowed = baselineTotals[file] ?? 0;
		if (count > allowed) {
			exceedances.push({ file, baseline: allowed, current: count, delta: count - allowed });
		}
	}
	return exceedances;
}

function main() {
	const mdFiles = collectMdFiles();

	const fileTotals = {};
	const violationsByFile = new Map();
	for (const file of mdFiles) {
		const v = findViolationsInFile(file);
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		if (v.length > 0) {
			fileTotals[rel] = v.length;
			violationsByFile.set(rel, v);
		}
	}

	const totalViolations = Object.values(fileTotals).reduce((a, b) => a + b, 0);

	if (UPDATE_BASELINE) {
		saveBaseline(fileTotals);
		console.log(`[check-doc-code-references] baseline updated: ${BASELINE_PATH}`);
		console.log(`  files: ${Object.keys(fileTotals).length}, total violations: ${totalViolations}`);
		return;
	}

	const baseline = loadBaseline();
	const baselineTotals = baseline.totals || {};
	const exceedances = calculateExceedances(fileTotals, baselineTotals);

	if (JSON_OUTPUT) {
		console.log(JSON.stringify({ fileTotals, baselineTotals, exceedances, totalViolations }, null, 2));
	} else {
		console.log('ドキュメント内のコード参照（実装との突合）をチェックしています...\n');
		console.log('[check-doc-code-references] file totals:');
		for (const [file, count] of Object.entries(fileTotals).sort()) {
			const allowed = baselineTotals[file] ?? 0;
			const marker = count > allowed ? ' [EXCEEDS]' : count === allowed ? ' [OK]' : ' [BELOW]';
			console.log(`  ${file}: ${count} (baseline: ${allowed})${marker}`);
		}

		if (exceedances.length > 0) {
			console.error('\n[FAIL] baseline exceeded (新規デッドリンク発生):');
			for (const ex of exceedances) {
				console.error(`  ${ex.file}: ${ex.current} > ${ex.baseline} (+${ex.delta})`);
				const vs = violationsByFile.get(ex.file) || [];
				for (const v of vs) {
					console.error(`    - ${v.path} (${v.refType === 'inline' ? '`...` inline code' : 'bare path'})`);
				}
			}
			console.error(
				'\n対応方針:\n' +
					'  1. 実装側の現在のパスに参照を更新する (推奨)\n' +
					'  2. ドキュメント全体が陳腐化しているなら冒頭に `<!-- doc-status: deprecated -->` を追加\n' +
					'  3. 意図的に違反を増やす場合は `node scripts/check-doc-code-references.mjs --update-baseline` で baseline 更新',
			);
		}
	}

	if (FIX && exceedances.length > 0) {
		console.log('\n--fix オプション: 新規違反ファイルに Deprecated 警告を挿入します...');
		for (const ex of exceedances) {
			insertDeprecatedWarning(ex.file);
			console.log(`  -> ${ex.file} に Deprecated 警告を追加`);
		}
		console.log('\n警告を挿入しました。再実行で再検証してください。');
		process.exit(0);
	}

	if (exceedances.length > 0) {
		process.exit(1);
	}

	if (!JSON_OUTPUT) {
		console.log(
			`\n✓ baseline 内 (${totalViolations} 件、${Object.keys(fileTotals).length} ファイル)。新規違反なし。`,
		);
	}
}

main();
