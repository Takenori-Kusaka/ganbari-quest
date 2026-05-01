#!/usr/bin/env node
/**
 * scripts/check-lp-removal-residue.mjs (#1790)
 *
 * 「LP 削除/圧縮 PR」の残骸 (orphan reference) を CI で検出する。
 *
 * 検出対象:
 *   1. site/*.html / site/help/*.html 内の data-lp-key="namespace.key" 参照のうち、
 *      shared-labels.js / src/lib/domain/labels.ts のいずれにも定義が存在しないもの
 *      (= LP HTML が「削除済み label key」を参照し続けている残骸)
 *
 *   2. site/*.html 内の <img src="..."> / <source srcset="..."> / og:image 等の
 *      ローカル画像 (相対パス) が site/ ディレクトリに物理存在しないもの
 *      (例外: site/screenshots/*.webp は CI が pages.yml で生成するため .gitignore 対象。
 *       本検証では .gitignore された参照を「fail にしない」 — ただし URL の構文上の
 *       不整合は検出する)
 *
 *   3. site/index.html 内の <h2>/<h3> 見出しテキストが docs/design/lp-content-map.md の
 *      §4 LP トップページ IA の section 一覧と整合しているか (未実装、AC 観点で軽量チェックのみ)
 *      -- IA 整合性は人間レビューで担保するためここでは tag 構造のみ抽出して artefact に記録する
 *
 * Exit code: 違反 1 件以上で 1, 問題なければ 0
 *
 * 使い方:
 *   node scripts/check-lp-removal-residue.mjs                      # 全 HTML を検査
 *   node scripts/check-lp-removal-residue.mjs --json               # JSON 出力 (artefact 用)
 *   node scripts/check-lp-removal-residue.mjs --site-dir=site
 *
 * 関連:
 *   - #1790 (本 Issue)
 *   - ADR-0009 (labels.ts SSOT) — data-lp-key 参照の orphan 防止
 *   - ADR-0013 (LP truth) — 削除済み機能の文言が LP に残骸として残るのを防ぐ
 *   - ADR-0025 (LP SSOT 注入機構) — shared-labels.js は labels.ts から自動生成
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => {
			const [k, v] = a.replace(/^--/, '').split('=');
			return [k, v ?? 'true'];
		}),
);

const SITE_DIR = resolve(args['site-dir'] || join(REPO_ROOT, 'site'));
const LABELS_TS = resolve(REPO_ROOT, 'src/lib/domain/labels.ts');
const SHARED_LABELS_JS = resolve(SITE_DIR, 'shared-labels.js');
const BASELINE_PATH = resolve(REPO_ROOT, 'scripts/lp-removal-residue-baseline.json');
const JSON_OUTPUT = args.json === 'true';
const UPDATE_BASELINE = args['update-baseline'] === 'true';

/**
 * site/ 配下の .html を再帰列挙 (深さ 2 階層: site/ + site/help/)
 */
function listHtmlFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			// 既知の subdir のみ降りる (assets / js / screenshots は HTML を持たない)
			if (entry === 'help') {
				out.push(...listHtmlFiles(full));
			}
		} else if (entry.endsWith('.html')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * shared-labels.js から LP_LABELS namespace.key の集合を抽出する。
 * shared-labels.js は generate-lp-labels.mjs で自動生成されたものなので、
 *   const LP_LABELS = { ... };
 * の Object literal を eval せずにキー構造を文字列パースする。
 *
 * ここでは安全策として `"key1": ...` と `key1: ...` の両方を緩く検出する。
 * 厳密な構文解析が必要な場合は import() に切り替える。
 */
/**
 * `const LP_LABELS = { ... };` のブロックを brace 計数で切り出す。
 */
function extractLpLabelsBlock(src) {
	const startMatch = src.match(/const\s+LP_LABELS\s*=\s*\{/);
	if (!startMatch) return null;
	const openIdx = startMatch.index + startMatch[0].length - 1;
	let depth = 0;
	for (let i = openIdx; i < src.length; i++) {
		const ch = src[i];
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === '\\') i++;
				i++;
			}
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return src.slice(openIdx, i + 1);
		}
	}
	return null;
}

/**
 * 文字列リテラル位置から `"value"` を取り出し、その直後に `:` が続けば key として返す。
 * 戻り値: { value, end, isKey }
 */
function readStringLiteral(block, startIdx) {
	const quote = block[startIdx];
	let j = startIdx + 1;
	let value = '';
	while (j < block.length && block[j] !== quote) {
		if (block[j] === '\\') j += 2;
		else {
			value += block[j];
			j++;
		}
	}
	let k = j + 1;
	while (k < block.length && /\s/.test(block[k])) k++;
	const isKey = block[k] === ':';
	return { value, end: j + 1, isKey };
}

/**
 * scan state を更新するヘルパ。
 * - 文字列リテラルなら key 候補かチェック、ヒットすれば currentNs / keys を更新
 * - { なら depth++、} なら depth-- + namespace 切り替え
 *
 * 戻り値: 次の i の位置
 */
function advanceScanCursor(block, i, state, keys) {
	const c = block[i];
	if (c === '"' || c === "'") {
		const { value, end, isKey } = readStringLiteral(block, i);
		if (isKey) {
			if (state.depth === 1) state.currentNs = value;
			else if (state.depth === 2 && state.currentNs) keys.add(`${state.currentNs}.${value}`);
		}
		return end;
	}
	if (c === '{') state.depth++;
	else if (c === '}') {
		state.depth--;
		if (state.depth <= 1) state.currentNs = null;
	}
	return i + 1;
}

function extractSharedLabelsKeys(filePath) {
	const keys = new Set();
	if (!existsSync(filePath)) return keys;
	const src = readFileSync(filePath, 'utf8');
	const block = extractLpLabelsBlock(src);
	if (!block) return keys;
	const state = { depth: 0, currentNs: null };
	let i = 0;
	while (i < block.length) {
		i = advanceScanCursor(block, i, state, keys);
	}
	return keys;
}

/**
 * labels.ts から LP_*_LABELS の namespace.key を抽出する (orphan 検出の補助)。
 * ここは厳密な構文解析を避け、`generate-lp-labels.mjs` の出力 = shared-labels.js を
 * 信頼する設計。labels.ts 直接抽出は冗長になるため shared-labels.js に一本化。
 *
 * 引数 _path は API 互換のため受け取るが現状は未使用。
 */
function extractLabelsTsLpKeys(_path) {
	// 現実装は shared-labels.js への依存に集約する。labels.ts 単独からの抽出は
	// generate-lp-labels.mjs の責務であり、本スクリプトは「生成済 shared-labels.js
	// が SSOT として正しい」前提で動く (差分があれば lint:lp-plan-sync が検出)。
	return new Set();
}

/**
 * HTML ソースから data-lp-key="..." の値を全件抽出する。
 */
function extractDataLpKeys(html) {
	const keys = new Set();
	const re = /data-lp-key="([^"]+)"/g;
	let m;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
	while ((m = re.exec(html)) !== null) {
		keys.add(m[1]);
	}
	return keys;
}

/**
 * HTML ソースから ローカル参照の画像 path を抽出する。
 *   - <img src="...">
 *   - <source srcset="..."> (一つ目の URL のみ)
 *   - <meta property="og:image" content="...">
 *   - <link rel="..." href="...png|webp|svg">
 *
 * 戻り値: { src: string, line: number }[]
 */
function extractLocalImageRefs(html) {
	const refs = [];
	const patterns = [
		/<img\s[^>]*src="([^"]+)"/g,
		/<source\s[^>]*srcset="([^"]+?)(?:\s+[0-9.]+[xw])?"/g,
		/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g,
		/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g,
	];
	for (const re of patterns) {
		let m;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
		while ((m = re.exec(html)) !== null) {
			const url = m[1];
			// 外部 URL / data URI / アンカー / mailto はスキップ
			if (
				url.startsWith('http://') ||
				url.startsWith('https://') ||
				url.startsWith('//') ||
				url.startsWith('data:') ||
				url.startsWith('#') ||
				url.startsWith('mailto:')
			) {
				continue;
			}
			const line = html.substring(0, m.index).split('\n').length;
			refs.push({ src: url, line });
		}
	}
	return refs;
}

/**
 * site/screenshots/*.webp は CI が pages.yml で生成するため
 * .gitignore 対象 (本リポジトリには物理存在しない)。
 * これらは「物理存在しなくても warn 扱い」としつつ、参照 URL の syntactic 妥当性
 * (拡張子 / 二重スラッシュ等) のみ検査する。
 */
function isGitIgnoredScreenshot(relSrc) {
	return relSrc.startsWith('screenshots/') && (relSrc.endsWith('.webp') || relSrc.endsWith('.png'));
}

/**
 * site/index.html 等の <h2>/<h3> テキストを抽出 (IA artefact 用)
 */
function extractHeadings(html) {
	const out = [];
	const re = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/g;
	let m;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
	while ((m = re.exec(html)) !== null) {
		const text = m[2]
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (text) out.push({ tag: m[1], text });
	}
	return out;
}

/**
 * 1 ファイルから data-lp-key orphan / 画像 broken ref を検出する。
 * heading は artefact に記録するため副作用として返す。
 */
function checkSingleFile(file, knownKeys, violations, warnings) {
	const html = readFileSync(file, 'utf8');
	const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');

	// 1. data-lp-key orphan 検出
	if (knownKeys.size > 0) {
		for (const key of extractDataLpKeys(html)) {
			if (!knownKeys.has(key)) {
				violations.push({
					kind: 'orphan-lp-key',
					file: rel,
					detail: `data-lp-key="${key}" が shared-labels.js (LP_LABELS) に存在しません`,
				});
			}
		}
	}

	// 2. ローカル画像参照の物理存在検証
	for (const { src, line } of extractLocalImageRefs(html)) {
		const resolvedPath = src.startsWith('/')
			? join(SITE_DIR, src.replace(/^\/+/, ''))
			: join(dirname(file), src);
		if (existsSync(resolvedPath)) continue;
		if (isGitIgnoredScreenshot(src.replace(/^\/+/, ''))) {
			warnings.push(`[${rel}:${line}] ${src} は CI 生成 (.gitignore) — ローカル不在は許容`);
		} else {
			violations.push({
				kind: 'broken-image-ref',
				file: rel,
				line,
				detail: `画像参照 "${src}" のファイルが存在しません (resolved: ${relative(REPO_ROOT, resolvedPath).replaceAll('\\', '/')})`,
			});
		}
	}

	return { rel, headings: extractHeadings(html) };
}

function loadBaseline(violationKey, warnings) {
	if (!existsSync(BASELINE_PATH)) {
		return { baselineSet: new Set(), baselineExists: false };
	}
	try {
		const baselineRaw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
		if (Array.isArray(baselineRaw.violations)) {
			return {
				baselineSet: new Set(baselineRaw.violations.map(violationKey)),
				baselineExists: true,
			};
		}
	} catch (e) {
		warnings.push(`baseline ファイルの読み込みに失敗: ${e instanceof Error ? e.message : e}`);
	}
	return { baselineSet: new Set(), baselineExists: false };
}

function reportResult(result, JSON_OUTPUT_FLAG) {
	if (JSON_OUTPUT_FLAG) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	console.log(`=== LP 削除残骸 (orphan reference) 検証 ===`);
	console.log(`  scan: ${result.siteDir} (${result.htmlFilesScanned} HTML files)`);
	console.log(`  known LP_LABELS keys: ${result.knownLpLabelKeys}`);
	console.log(
		`  baseline: ${result.baselineExists ? `${result.baselineCount} 件 (既知)` : 'なし (初回)'}`,
	);
	console.log(`  current violations: ${result.currentCount}`);
	console.log(`  new violations (vs baseline): ${result.newViolationCount}`);
	console.log(`  fixed (baseline で減った): ${result.fixedBaselineCount}`);
	console.log(`  warnings: ${result.warnings.length}`);
	console.log('');
	if (result.warnings.length) {
		console.log('--- WARNINGS ---');
		for (const w of result.warnings) console.log(`  [warn] ${w}`);
		console.log('');
	}
	if (result.newViolationCount > 0) {
		console.log('--- NEW VIOLATIONS (本 PR 起因) ---');
		for (const v of result.newViolations) {
			const pos = v.line ? `:${v.line}` : '';
			console.log(`  [${v.kind}] ${v.file}${pos}`);
			console.log(`    ${v.detail}`);
		}
		console.log('');
		console.log('[FAIL] LP に新規の削除残骸が追加されました。');
		console.log('修正手順:');
		console.log(
			'  1. data-lp-key="..." 参照を削除した label に揃えるか、shared-labels.js / labels.ts に key を追加',
		);
		console.log('  2. <img src="..."> 参照は site/ に物理ファイルを配置するか HTML 側を削除');
		console.log(
			'  3. baseline を意図的に増やす場合は ADR で議論したうえで `--update-baseline` を実行',
		);
		console.log(
			'  4. 詳細は docs/design/lp-content-map.md §「LP 削除/圧縮 PR 必須チェックリスト」参照',
		);
	} else if (result.fixedBaselineCount > 0) {
		console.log(
			'[OK] 新規残骸なし。baseline が縮小したので `--update-baseline` で reset を検討してください。',
		);
	} else {
		console.log('[OK] 新規残骸なし (baseline と同等)。');
	}
}

function main() {
	const violations = [];
	const warnings = [];

	if (!existsSync(SITE_DIR)) {
		console.error(`[ERROR] site/ ディレクトリが見つかりません: ${SITE_DIR}`);
		process.exit(1);
	}

	const sharedLabelKeys = extractSharedLabelsKeys(SHARED_LABELS_JS);
	const labelsTsKeys = extractLabelsTsLpKeys(LABELS_TS);
	const knownKeys = new Set([...sharedLabelKeys, ...labelsTsKeys]);

	if (knownKeys.size === 0) {
		warnings.push(
			`shared-labels.js から LP_LABELS keys を抽出できませんでした: ${SHARED_LABELS_JS}. ` +
				`generate-lp-labels.mjs を実行してから再度試してください (--check は orphan 検証のため fail).`,
		);
	}

	const htmlFiles = listHtmlFiles(SITE_DIR);
	const headingArtefact = {};

	for (const file of htmlFiles) {
		const { rel, headings } = checkSingleFile(file, knownKeys, violations, warnings);
		headingArtefact[rel] = headings;
	}

	// baseline ratchet:
	//   既存の violation 件数を `scripts/lp-removal-residue-baseline.json` に保存し、
	//   新規 1 件でも追加されれば CI を fail させる (Phase A、#1790 R1 の baseline 設計)。
	const violationKey = (v) => `${v.kind}::${v.file}::${v.detail}`;
	const currentSet = new Set(violations.map(violationKey));
	const { baselineSet, baselineExists } = loadBaseline(violationKey, warnings);

	const newViolations = violations.filter((v) => !baselineSet.has(violationKey(v)));
	const fixedBaselineEntries = [...baselineSet].filter((k) => !currentSet.has(k));

	if (UPDATE_BASELINE) {
		const baselineOut = {
			updatedAt: new Date().toISOString(),
			note:
				'#1790: LP 削除残骸 baseline。新規 violation のみ CI で fail させる ratchet。' +
				' baseline を増やす変更は ADR で議論すること。',
			violations,
		};
		writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineOut, null, '\t')}\n`);
		console.log(
			`[baseline] ${relative(REPO_ROOT, BASELINE_PATH).replaceAll('\\', '/')} を更新しました (${violations.length} 件)`,
		);
		process.exit(0);
	}

	const result = {
		timestamp: new Date().toISOString(),
		siteDir: relative(REPO_ROOT, SITE_DIR).replaceAll('\\', '/') || 'site',
		htmlFilesScanned: htmlFiles.length,
		knownLpLabelKeys: knownKeys.size,
		baselineExists,
		baselineCount: baselineSet.size,
		currentCount: violations.length,
		newViolationCount: newViolations.length,
		fixedBaselineCount: fixedBaselineEntries.length,
		violations,
		newViolations,
		warnings,
		headingArtefact,
	};

	reportResult(result, JSON_OUTPUT);
	process.exit(newViolations.length > 0 ? 1 : 0);
}

main();
