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
 * よって本リポジトリ固有用途の小規模独自実装 (~250 行) として維持する。
 *
 * # 改善点 (vs 元 #2226 実装 + #2259 QM Tier 2 Review BLOCK 4 件対応)
 * 1. **skip 判定の marker 化** (line 33 fragile fullmatch → stable marker):
 *    元実装は warning 本文の文字列完全一致だった。`<!-- doc-status: deprecated -->` HTML
 *    コメントを stable marker とし、warning 本文の細部変更に追従可能にする。後方互換のため
 *    旧 fullmatch も継続サポート。
 *
 * 2. **fenced code block の除外**:
 *    `` ```bash ... ``` `` の中で `cd src/lib && ls` のように記述されたパスは skip。
 *
 * 3. **inline code (バッククォート) と bare path の区別**:
 *    エラーメッセージで「inline code」「bare path」を区別表示。
 *
 * 4. **baseline モデル (#2259 C1 fix — path-array 化)**:
 *    `scripts/doc-code-references-baseline.json`。元実装は file 別 count のみで pin して
 *    いたため「同一ファイル内で 1 件 fix + 1 件新規 swap」が baseline 維持で素通りした
 *    (Copilot [must] C1)。本実装では **path 配列で baseline を保存** し、現状の path
 *    set との **diff で新規 path が 1 件でも検出されたら fail** に変更。後方互換のため
 *    旧 `{ totals: { file: count } }` フォーマットも読み込み可能 (count >= 違反数 なら
 *    fail しない、ただし path-set diff の厳格判定は失われるため warn を出力)。
 *
 * 5. **CLI sandbox 対応 (#2259 C2 fix)**:
 *    `--baseline-path <file>` / `--repo-root <dir>` を追加し、test sandbox から本番
 *    baseline を参照せずに済むようにした。これにより `--update-baseline` の test が
 *    本番 baseline を破壊しなくなる (Copilot [must] C2)。引数省略時は従来通り
 *    `__dirname/..` をベースに解決する。
 *
 * # CLI
 *   node scripts/check-doc-code-references.mjs                          # baseline 検証
 *   node scripts/check-doc-code-references.mjs --json                   # JSON 出力
 *   node scripts/check-doc-code-references.mjs --update-baseline        # baseline 更新
 *   node scripts/check-doc-code-references.mjs --fix                    # Deprecated 警告挿入
 *   node scripts/check-doc-code-references.mjs --baseline-path <file>   # baseline ファイル指定
 *   node scripts/check-doc-code-references.mjs --repo-root <dir>        # repo root 指定
 *
 * # 関連 Issue / PR
 *   #2215 Epic 2 鮮度チェック / #2218 Epic 3 陳腐化整理 / #2240 Re-Issue (3 PR 分割)
 *   #2226 (CLOSED) 旧巨大 PR の close 候補 / #2259 QM Tier 2 Review Fix
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

/**
 * CLI 引数 parser。`--key=value` / `--key value` / `--key` 3 形式に対応 (#2259 C2)。
 */
function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const eq = a.indexOf('=');
		if (eq !== -1) {
			out[a.slice(2, eq)] = a.slice(eq + 1);
		} else {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith('--')) {
				out[key] = next;
				i++;
			} else {
				out[key] = 'true';
			}
		}
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));

const FIX = args.fix === 'true';
const JSON_OUTPUT = args.json === 'true';
const UPDATE_BASELINE = args['update-baseline'] === 'true';

/**
 * repo root / baseline path を CLI 引数 or デフォルトで解決 (#2259 C2 fix)。
 * test sandbox 等から非破壊的に本スクリプトを叩けるようにする。
 */
const REPO_ROOT = args['repo-root']
	? path.resolve(args['repo-root'])
	: path.resolve(__dirname, '..');
const BASELINE_PATH = args['baseline-path']
	? path.resolve(args['baseline-path'])
	: path.resolve(REPO_ROOT, 'scripts/doc-code-references-baseline.json');

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
	if (p.length < 5) return false;
	return true;
}

/**
 * Case-sensitive 版 existsSync。Windows / macOS の case-insensitive FS で Linux CI と
 * 挙動を一致させるため、各セグメントを readdirSync で実体名と strict 比較する。
 */
function existsCaseSensitive(absRoot, relPath) {
	const abs = path.join(absRoot, relPath);
	if (!fs.existsSync(abs)) return false;
	const segments = relPath.split(/[/\\]/).filter(Boolean);
	let cur = absRoot;
	for (const seg of segments) {
		try {
			const entries = fs.readdirSync(cur);
			if (!entries.includes(seg)) return false;
			cur = path.join(cur, seg);
		} catch {
			return false;
		}
	}
	return true;
}

/**
 * Deprecated marker のいずれかが含まれるかを判定。
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
 * 指定 repo root 配下の全 markdown ファイルを集める。
 */
function collectMdFiles(repoRoot) {
	const docsDir = path.join(repoRoot, 'docs');
	const mdFiles = getFiles(docsDir, '.md');
	for (const top of ['CLAUDE.md', 'DESIGN.md']) {
		const p = path.join(repoRoot, top);
		if (fs.existsSync(p)) mdFiles.push(p);
	}
	for (const dir of ['src', 'tests', 'scripts', 'infra', '.github']) {
		const candidate = path.join(repoRoot, dir, 'CLAUDE.md');
		if (fs.existsSync(candidate)) mdFiles.push(candidate);
	}
	for (const nested of getFiles(path.join(repoRoot, 'src'), 'CLAUDE.md')) {
		if (!mdFiles.includes(nested)) mdFiles.push(nested);
	}
	return mdFiles.sort();
}

/**
 * 1 ファイルを走査して違反 (実在しないパス参照) を返す。
 */
function findViolationsInFile(file, repoRoot) {
	const original = fs.readFileSync(file, 'utf-8');
	if (isMarkedDeprecated(original)) return [];

	const content = stripFencedCodeBlocks(original);

	const inlinePaths = new Set();
	const inlineRe = /`([^`\n]+)`/g;
	for (const m of content.matchAll(inlineRe)) {
		const candidate = normalizePath(m[1]);
		if (isCheckableImplPath(candidate)) inlinePaths.add(candidate);
	}

	const words = content.split(/[\s`"'()[\]\n\r<>]+/);
	const checked = new Set();
	const violations = [];

	for (const word of words) {
		const cleanPath = normalizePath(word);
		if (!isCheckableImplPath(cleanPath)) continue;
		if (checked.has(cleanPath)) continue;
		checked.add(cleanPath);

		if (!existsCaseSensitive(repoRoot, cleanPath)) {
			violations.push({
				path: cleanPath,
				refType: inlinePaths.has(cleanPath) ? 'inline' : 'bare',
			});
		}
	}
	return violations;
}

/**
 * baseline ロード。新フォーマット (path 配列) と旧 (totals: count) の両方に対応 (#2259 C1)。
 * 戻り値: { paths: Record<file, string[]>, legacy: boolean, legacyTotals?: Record<file, number> }
 */
function loadBaseline() {
	if (!fs.existsSync(BASELINE_PATH)) {
		return { paths: {}, legacy: false };
	}
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
	} catch {
		return { paths: {}, legacy: false };
	}

	// 新フォーマット: { paths: { file: [missing-paths...] } }
	if (raw && raw.paths && typeof raw.paths === 'object') {
		const out = {};
		for (const [file, arr] of Object.entries(raw.paths)) {
			if (Array.isArray(arr)) out[file] = arr.slice();
		}
		return { paths: out, legacy: false };
	}

	// 旧フォーマット: { totals: { file: count } } — count 比較フォールバックで読み込む
	if (raw && raw.totals && typeof raw.totals === 'object') {
		return { paths: {}, legacy: true, legacyTotals: { ...raw.totals } };
	}

	return { paths: {}, legacy: false };
}

/**
 * baseline 保存。新フォーマット (path 配列) で書き出す (#2259 C1)。
 */
function saveBaseline(violationsByFile) {
	const paths = {};
	for (const [file, vs] of violationsByFile.entries()) {
		paths[file] = vs.map((v) => v.path).sort();
	}
	const data = {
		_comment:
			'#2240 Split A baseline (#2259 C1 で path 配列化): ドキュメント内の実装コードパス参照のうち実在しないものを path 配列で pin する。新規 path 1 件で CI fail (set diff)。Split C は Pre-PMF 過剰防衛 (ADR-0010 §3 Bucket B) として skip し、本 baseline で防衛ラインを成立させる。意図的増減時のみ --update-baseline で更新。',
		paths,
		generatedAt: new Date().toISOString(),
	};
	const json = JSON.stringify(data, null, '\t');
	fs.writeFileSync(BASELINE_PATH, `${json}\n`, 'utf-8');
}

/**
 * baseline と現状 violationsByFile を path set diff で比較し、新規 path を返す (#2259 C1)。
 */
function calculateNewViolations(violationsByFile, baseline) {
	const newByFile = [];
	for (const [file, vs] of violationsByFile.entries()) {
		const currentSet = new Set(vs.map((v) => v.path));
		if (baseline.legacy) {
			// 旧フォーマット: count 比較 (path-set 厳密判定不可、warn 出力)
			const allowed = baseline.legacyTotals[file] ?? 0;
			if (currentSet.size > allowed) {
				const delta = currentSet.size - allowed;
				newByFile.push({
					file,
					mode: 'legacy-count',
					baselineCount: allowed,
					current: vs,
					delta,
					newPaths: vs.map((v) => v.path), // どれが新規か特定不能
				});
			}
		} else {
			const baselineSet = new Set(baseline.paths[file] || []);
			const newPaths = [...currentSet].filter((p) => !baselineSet.has(p));
			if (newPaths.length > 0) {
				newByFile.push({
					file,
					mode: 'set-diff',
					baselinePaths: [...baselineSet].sort(),
					current: vs,
					delta: newPaths.length,
					newPaths,
				});
			}
		}
	}
	return newByFile;
}

/**
 * 全ファイル走査して violationsByFile (Map<file, violation[]>) を返す。
 */
function collectAllViolations(mdFiles, repoRoot) {
	const violationsByFile = new Map();
	for (const file of mdFiles) {
		const v = findViolationsInFile(file, repoRoot);
		const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
		if (v.length > 0) {
			violationsByFile.set(rel, v);
		}
	}
	return violationsByFile;
}

function printNewViolationReport(newByFile) {
	if (newByFile.length === 0) return;
	console.error('\n[FAIL] baseline exceeded (新規デッドリンク発生):');
	for (const ex of newByFile) {
		if (ex.mode === 'legacy-count') {
			console.error(
				`  ${ex.file}: ${ex.current.length} > ${ex.baselineCount} (+${ex.delta}) [legacy-count]`,
			);
		} else {
			console.error(`  ${ex.file}: +${ex.delta} new path(s) [set-diff]`);
		}
		const newSet = new Set(ex.newPaths);
		for (const v of ex.current) {
			if (newSet.has(v.path)) {
				console.error(
					`    + ${v.path} (${v.refType === 'inline' ? '`...` inline code' : 'bare path'})`,
				);
			}
		}
	}
	console.error(
		'\n対応方針:\n' +
			'  1. 実装側の現在のパスに参照を更新する (推奨)\n' +
			'  2. ドキュメント全体が陳腐化しているなら冒頭に `<!-- doc-status: deprecated -->` を追加\n' +
			'  3. 意図的に違反を増やす場合は `node scripts/check-doc-code-references.mjs --update-baseline` で baseline 更新',
	);
}

function printFileTotals(violationsByFile, baseline) {
	console.log('ドキュメント内のコード参照（実装との突合）をチェックしています...\n');
	console.log('[check-doc-code-references] file totals:');
	const fileNames = [...violationsByFile.keys()].sort();
	for (const file of fileNames) {
		const vs = violationsByFile.get(file);
		const count = vs.length;
		let allowed;
		if (baseline.legacy) {
			allowed = baseline.legacyTotals[file] ?? 0;
		} else {
			allowed = (baseline.paths[file] || []).length;
		}
		const marker = count > allowed ? ' [EXCEEDS]' : count === allowed ? ' [OK]' : ' [BELOW]';
		console.log(`  ${file}: ${count} (baseline: ${allowed})${marker}`);
	}
	if (baseline.legacy) {
		console.warn(
			'\n[warn] baseline が旧フォーマット (totals: count) で読み込まれました。次回 --update-baseline で path 配列に移行されます。',
		);
	}
}

function main() {
	const mdFiles = collectMdFiles(REPO_ROOT);
	const violationsByFile = collectAllViolations(mdFiles, REPO_ROOT);

	if (UPDATE_BASELINE) {
		saveBaseline(violationsByFile);
		const totalPaths = [...violationsByFile.values()].reduce((a, v) => a + v.length, 0);
		console.log(`[check-doc-code-references] baseline updated: ${BASELINE_PATH}`);
		console.log(
			`  files: ${violationsByFile.size}, total violation paths: ${totalPaths} (path-array format)`,
		);
		return;
	}

	const baseline = loadBaseline();
	const newByFile = calculateNewViolations(violationsByFile, baseline);

	const fileTotals = {};
	for (const [file, vs] of violationsByFile.entries()) fileTotals[file] = vs.length;
	const baselineTotalsForJson = baseline.legacy
		? baseline.legacyTotals
		: Object.fromEntries(Object.entries(baseline.paths).map(([f, arr]) => [f, arr.length]));
	const totalViolations = Object.values(fileTotals).reduce((a, b) => a + b, 0);

	if (JSON_OUTPUT) {
		console.log(
			JSON.stringify(
				{
					fileTotals,
					baselineTotals: baselineTotalsForJson,
					exceedances: newByFile.map((x) => ({
						file: x.file,
						mode: x.mode,
						delta: x.delta,
						newPaths: x.newPaths,
					})),
					totalViolations,
				},
				null,
				2,
			),
		);
	} else {
		printFileTotals(violationsByFile, baseline);
		printNewViolationReport(newByFile);
	}

	if (FIX && newByFile.length > 0) {
		console.log('\n--fix オプション: 新規違反ファイルに Deprecated 警告を挿入します...');
		for (const ex of newByFile) {
			const abs = path.join(REPO_ROOT, ex.file);
			insertDeprecatedWarning(abs);
			console.log(`  -> ${ex.file} に Deprecated 警告を追加`);
		}
		console.log('\n警告を挿入しました。再実行で再検証してください。');
		process.exit(0);
	}

	if (newByFile.length > 0) {
		process.exit(1);
	}

	if (!JSON_OUTPUT) {
		console.log(
			`\n✓ baseline 内 (${totalViolations} 件、${violationsByFile.size} ファイル)。新規違反なし。`,
		);
	}
}

main();
