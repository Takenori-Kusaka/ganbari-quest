#!/usr/bin/env node
/**
 * scripts/check-no-hardcoded-labels.mjs (#1346)
 *
 * labels.ts (SSOT) で定義された UI ラベル文字列の直書きを検出する。
 *
 * 検出対象:
 *   - `src/lib/domain/labels.ts` でエクスポートされた const オブジェクトの
 *     文字列値が、他ファイル (src配下の .ts / .svelte, site配下の .html / .js)
 *     でリテラル直書きされている箇所
 *
 * Phase 1 (本スクリプト初版) = warn モード:
 *   - 違反があっても exit 0 (CI を落とさない)
 *   - `--strict` フラグ指定時のみ exit 1
 *   - 初回 scan で違反一覧を可視化し、Phase 2 で順次修正、Phase 3 で強制
 *
 * 使用法:
 *   node scripts/check-no-hardcoded-labels.mjs             # warn モード
 *   node scripts/check-no-hardcoded-labels.mjs --strict    # strict モード (exit 1)
 *   node scripts/check-no-hardcoded-labels.mjs --json      # JSON 出力
 *
 * 例外マーカー:
 *   行末または直前行に `// label-allow-literal: <理由>` コメントがあれば除外
 *
 * 関連:
 *   - ADR-0009 labels.ts SSOT 化原則
 *   - #972 / scripts/check-no-plan-literals.mjs (先例パターン)
 *   - tmp/2026-04-21-labels-ssot-architectural-gap.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');

const LABELS_TS = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');

const SEARCH_ROOTS_APP = ['src/routes', 'src/lib/features', 'src/lib/ui', 'src/lib/components'];
const SEARCH_ROOTS_LP = ['site'];
const EXT_APP = ['.ts', '.svelte'];
const EXT_LP = ['.html', '.js'];

const EXCLUDE_PATTERNS = [
	/src[\\/]lib[\\/]domain[\\/]labels\.ts$/,
	/src[\\/]lib[\\/]domain[\\/]constants[\\/]/,
	/src[\\/]lib[\\/]server[\\/]db[\\/]migrations[\\/]/,
	/\.test\.ts$/,
	/\.spec\.ts$/,
	/\.stories\.ts$/,
	/\.stories\.svelte$/,
	/site[\\/]shared-labels\.js$/,
];

/**
 * labels.ts から "export const X = { ... } as const" ブロック内の文字列値を抽出する。
 * AST を使わず、check-no-plan-literals / generate-lp-labels の簡易パーサパターンを踏襲。
 *
 * 収集対象の基準:
 *  - 日本語文字 (ひらがな / カタカナ / 漢字) を含む
 *  - 長さ 2 文字以上
 *  - 「無料」「あり」のような汎用短語は除外リストで抑制
 */
const GENERIC_EXCLUDE = new Set([
	// labels.ts 内でも頻用されるが同じ文字列が汎用でも使われるため誤検知源
	'無料',
	'あり',
	'なし',
	'はい',
	'いいえ',
	'すべて',
	'どちらも',
	'/月',
	'/年',
	'確認',
	'キャンセル',
	'保存',
	'削除',
	'追加',
	'編集',
	'閉じる',
	'続ける',
	'戻る',
	'次へ',
]);

function isJapanese(s) {
	return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(s);
}

function findBlockEnd(src, startIdx) {
	let depth = 1;
	let i = startIdx;
	while (i < src.length && depth > 0) {
		const ch = src[i];
		if (ch === '{') depth += 1;
		else if (ch === '}') depth -= 1;
		i += 1;
	}
	return i - 1;
}

function collectLiteralsFromBody(body, objectName, labels) {
	const quoted = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:\s*(['"])([^'"\\]+)\2/g;
	for (const match of body.matchAll(quoted)) {
		const key = match[1];
		const value = match[3];
		if (value.length < 2) continue;
		if (GENERIC_EXCLUDE.has(value)) continue;
		if (!isJapanese(value)) continue;
		if (!labels.has(value)) {
			labels.set(value, { sourceObject: objectName, key });
		}
	}
}

function extractLabelsFromTs() {
	const src = fs.readFileSync(LABELS_TS, 'utf-8');
	const labels = new Map();

	const blockRe = /export const (\w+)[^=]*=\s*\{/g;
	for (const blockMatch of src.matchAll(blockRe)) {
		const name = blockMatch[1];
		const startIdx = blockMatch.index + blockMatch[0].length;
		const endIdx = findBlockEnd(src, startIdx);
		const body = src.slice(startIdx, endIdx);
		collectLiteralsFromBody(body, name, labels);
	}

	return labels;
}

function shouldExclude(filePath) {
	const rel = path.relative(REPO_ROOT, filePath);
	return EXCLUDE_PATTERNS.some((p) => p.test(rel));
}

function walk(dir, exts, out = []) {
	if (!fs.existsSync(dir)) return out;
	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		if (exts.some((ext) => dir.endsWith(ext)) && !shouldExclude(dir)) {
			out.push(dir);
		}
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, exts, out);
		else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
			if (!shouldExclude(full)) out.push(full);
		}
	}
	return out;
}

function hasAllowLiteralMarker(lines, lineIdx) {
	if (/label-allow-literal:/.test(lines[lineIdx])) return true;
	if (lineIdx > 0 && /label-allow-literal:/.test(lines[lineIdx - 1])) return true;
	return false;
}

/**
 * ラベル文字列と完全一致する「直書き」パターンのみマッチさせる。
 * 部分一致 (「チャレンジきろく」に「チャレンジ」) は false positive になるので除外。
 *
 * 対象パターン:
 *   - クオート内完全一致:  'ラベル' / "ラベル" / `ラベル`  (前後はクオート/バッククオート)
 *   - JSX / Svelte テキストノード完全一致:  >ラベル<  (前後はタグ境界)
 *   - HTML 属性値完全一致:  ="ラベル" / ='ラベル' は上記クオートルールで捕捉
 *   - 日本語として前後に日本語文字がない場合の単独出現 (>ラベルを選ぶ< のような混在は除外)
 */
function buildExactMatchers(literal) {
	const esc = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return [
		// クオート完全一致
		new RegExp(`['"\`]${esc}['"\`]`),
		// JSX / HTML タグ間の完全一致 (前後が > と <)
		new RegExp(`>${esc}<`),
		// Svelte テキスト: >{' ラベル '}</ のような単独表現
		new RegExp(`>\\s*${esc}\\s*<`),
	];
}

function checkFile(filePath, labels) {
	const text = fs.readFileSync(filePath, 'utf-8');
	const lines = text.split(/\r?\n/);
	const findings = [];

	// ラベルごとに matcher をキャッシュ
	const matchers = new Map();
	for (const [literal] of labels) {
		matchers.set(literal, buildExactMatchers(literal));
	}

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*<!--/.test(line)) continue;
		if (hasAllowLiteralMarker(lines, i)) continue;

		for (const [literal, meta] of labels) {
			const regs = matchers.get(literal);
			if (regs.some((r) => r.test(line))) {
				findings.push({
					file: path.relative(REPO_ROOT, filePath),
					line: i + 1,
					literal,
					sourceObject: meta.sourceObject,
					key: meta.key,
					snippet: line.trim().slice(0, 140),
				});
			}
		}
	}
	return findings;
}

function main() {
	const labels = extractLabelsFromTs();

	const appFiles = [];
	for (const root of SEARCH_ROOTS_APP) {
		walk(path.join(REPO_ROOT, root), EXT_APP, appFiles);
	}
	const lpFiles = [];
	for (const root of SEARCH_ROOTS_LP) {
		walk(path.join(REPO_ROOT, root), EXT_LP, lpFiles);
	}

	const appFindings = [];
	for (const f of appFiles) {
		appFindings.push(...checkFile(f, labels));
	}
	const lpFindings = [];
	for (const f of lpFiles) {
		lpFindings.push(...checkFile(f, labels));
	}

	const total = appFindings.length + lpFindings.length;

	if (JSON_OUT) {
		console.log(
			JSON.stringify(
				{
					totalLabels: labels.size,
					appFindings,
					lpFindings,
					total,
					phase: STRICT ? 'strict' : 'warn',
				},
				null,
				2,
			),
		);
		process.exit(STRICT && total > 0 ? 1 : 0);
	}

	console.log(`[check-no-hardcoded-labels] labels.ts から ${labels.size} 件のラベル文字列を抽出`);
	console.log(
		`[check-no-hardcoded-labels] 対象ファイル: app=${appFiles.length}, lp=${lpFiles.length}`,
	);

	if (total === 0) {
		console.log('[check-no-hardcoded-labels] OK — ハードコード検出なし');
		process.exit(0);
	}

	const prefix = STRICT ? 'NG' : 'WARN';
	console.log(`\n[check-no-hardcoded-labels] ${prefix} — ${total} 件のハードコードを検出:`);
	console.log(`  app: ${appFindings.length}`);
	console.log(`  lp:  ${lpFindings.length}\n`);

	// 頻出ラベル上位を集計
	const perLiteral = new Map();
	for (const f of [...appFindings, ...lpFindings]) {
		perLiteral.set(f.literal, (perLiteral.get(f.literal) ?? 0) + 1);
	}
	const top = [...perLiteral.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

	console.log('--- 頻出ラベル TOP 15 ---');
	for (const [lit, count] of top) {
		const meta = labels.get(lit);
		console.log(`  ${count.toString().padStart(4)} × "${lit}" (${meta.sourceObject}.${meta.key})`);
	}

	console.log('\n--- 詳細 (最初の 30 件) ---');
	for (const f of [...appFindings, ...lpFindings].slice(0, 30)) {
		console.log(`  ${f.file}:${f.line}`);
		console.log(`    "${f.literal}" (${f.sourceObject}.${f.key})`);
		console.log(`    ${f.snippet}`);
	}

	if (total > 30) {
		console.log(`\n  ... 他 ${total - 30} 件 (全件は --json で出力)`);
	}

	console.log('\n修正方法: labels.ts からインポートしてください。例:');
	console.log("  import { PLAN_LABELS } from '$lib/domain/labels';");
	console.log('  <span>{PLAN_LABELS.standard}</span>');
	console.log('\n除外が必要な場合: 該当行直前 or 末尾に `// label-allow-literal: <理由>` を付与');

	process.exit(STRICT && total > 0 ? 1 : 0);
}

main();
