#!/usr/bin/env node
/**
 * scripts/sync-lp-fallback.mjs (#1945, Phase 3 D5)
 *
 * site/*.html 内の `<TAG ... data-lp-key="ns.k" ...>FALLBACK</TAG>` 内側 fallback テキストを
 * site/shared-labels.js (= labels.ts から自動生成済) の LP_LABELS 値で自動更新する。
 *
 * 用途:
 *   - SEO クローラ / JS 失敗時に表示される fallback テキストが labels.ts と乖離するのを防ぐ
 *   - 手動同期廃止: labels.ts 変更 → generate-lp-labels.mjs → 本スクリプト の連鎖で自動波及
 *
 * 使用法:
 *   node scripts/sync-lp-fallback.mjs            # site/*.html を実際に更新
 *   node scripts/sync-lp-fallback.mjs --check    # 差分があれば exit 1（CI 用）
 *   node scripts/sync-lp-fallback.mjs --verbose  # 詳細ログ（不一致一覧）
 *
 * 設計選定 (OSS 先調査 — ADR-0014 / #1350):
 *   採用しなかった選択肢:
 *     - jsdom (29.1.1, 既存 dep): 全体 serialize で incidental whitespace 改変 (DOCTYPE 直後改行 / </body> 前改行追加) が発生し、site/*.html ほぼ全行 diff になる
 *     - cheerio (新 dep, ~500KB): jsdom 同様の re-serialization 問題
 *     - node-html-parser (新 dep): parse5 より成熟度低
 *     - 自作 regex: ネスト要素 (例 <p data-lp-key="x">a<span>b</span>c</p>) で End tag マッチ不能
 *   採用:
 *     - parse5 (^8.0.1, jsdom 経由で transitively 既存 + textlint 経由含め複数経路で installed)。
 *       `sourceCodeLocationInfo: true` で startTag.endOffset / endTag.startOffset の byte offset を
 *       取得し、targeted substring replacement で innerHTML のみ surgical 更新可能。
 *       新規 dep 追加コスト 0 (Pre-PMF 最適 — ADR-0010)。
 *
 * 注: LP は静的 HTML として GitHub Pages から配信されるため、Lambda には一切影響しない。
 * 本スクリプトは純粋なビルドタイムツールであり、Lambda バンドルサイズへの影響なし。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SHARED_LABELS_JS = path.join(REPO_ROOT, 'site/shared-labels.js');

/**
 * 対象 HTML ファイル一覧 (Issue #1945 AC4)。
 * site/ 直下 10 ファイルを対象。
 * 注: 旧 site/help/license-key.html (LP_LICENSEKEY_LABELS 参照) は Epic #2525 Phase 7 PR-L4
 *     (#2836) license key 全廃に伴い完全削除済のため対象外。
 */
const TARGET_HTML_FILES = [
	'site/index.html',
	'site/pricing.html',
	'site/faq.html',
	'site/pamphlet.html',
	'site/privacy.html',
	'site/terms.html',
	'site/tokushoho.html',
	'site/sla.html',
	'site/graduation.html',
	'site/selfhost.html',
];

const args = process.argv.slice(2);
const CHECK_MODE = args.includes('--check');
const VERBOSE = args.includes('--verbose');

/**
 * テスト専用: `SYNC_LP_FALLBACK_TARGETS` 環境変数で TARGET_HTML_FILES を override する。
 * 本番運用では使用されず、`scripts/__tests__/sync-lp-fallback.test.mjs` の `--check`
 * exit code 検証 (#1974) のみで使用。
 *
 * フォーマット: カンマ区切りの相対パス (`relA.html,sub/relB.html`)
 *
 * **セキュリティガード (#1974 QM Review M-1, Copilot [must])**:
 *   env override は CI / シェル経由で誰でも有効化できるため、以下 2 段の path validation を強制。
 *   ADR-0010 Pre-PMF security minimization 趣旨で「テスト backdoor を本番バイナリに残すなら
 *   最低限のガードが必須」。
 *
 *   1. **REPO_ROOT 配下強制** — `path.resolve(REPO_ROOT, relPath)` の結果が REPO_ROOT で
 *      始まらないエントリは throw (`../../etc/passwd.html` 等の path traversal 拒否)
 *   2. **`.html` 拡張子限定** — fallback テキスト同期対象は HTML のみ。任意拡張子 read/write を防ぐ
 *
 *   違反時は process.exit せず Error throw し main() の catch から呼び出し側 (テスト spawn) に
 *   非ゼロ exit code で通知する。
 *
 * @returns {string[]} override 配列。未指定なら空配列
 * @throws {Error} 不正パス (REPO_ROOT 外 / 非 .html 拡張子) を含む場合
 */
function loadTargetOverridesFromEnv() {
	const raw = process.env.SYNC_LP_FALLBACK_TARGETS;
	if (!raw || raw.trim() === '') return [];
	const entries = raw
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	// REPO_ROOT prefix を比較する際は trailing separator を付けて部分一致による偽 OK を防ぐ
	// (例: REPO_ROOT='/repo' / '/repo-evil/x.html' を弾けるように)
	const repoRootPrefix = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
	for (const entry of entries) {
		// 1. .html 拡張子限定
		if (!entry.toLowerCase().endsWith('.html')) {
			throw new Error(
				`SYNC_LP_FALLBACK_TARGETS: '.html' 拡張子のみ許可されます (got: ${JSON.stringify(entry)})`,
			);
		}
		// 2. REPO_ROOT 配下強制 (path traversal 防止)
		const resolved = path.resolve(REPO_ROOT, entry);
		if (resolved !== REPO_ROOT && !resolved.startsWith(repoRootPrefix)) {
			throw new Error(
				`SYNC_LP_FALLBACK_TARGETS: REPO_ROOT (${REPO_ROOT}) の外側を指定できません (got: ${JSON.stringify(entry)} → ${resolved})`,
			);
		}
	}
	return entries;
}

/**
 * shared-labels.js 内の `const LP_LABELS = { ... };` ブロックを抽出し JSON parse する。
 *
 * shared-labels.js は generate-lp-labels.mjs 経由で `JSON.stringify(lpLabels, null, '\t')` 形式で
 * 出力されるため、純粋な JSON として parse 可能。
 *
 * @returns {Record<string, Record<string, string>>}
 */
function loadLpLabels() {
	if (!fs.existsSync(SHARED_LABELS_JS)) {
		throw new Error(
			`site/shared-labels.js が存在しません。先に \`node scripts/generate-lp-labels.mjs\` を実行してください。`,
		);
	}
	const src = fs.readFileSync(SHARED_LABELS_JS, 'utf-8');
	// `const LP_LABELS = { ... };` を非貪欲マッチで抽出。lpLabels の閉じ `}` の直後に `;` が来る。
	const m = src.match(/const LP_LABELS = (\{[\s\S]*?\});\s*\n\s*\/\//);
	if (!m) {
		throw new Error(
			`site/shared-labels.js の LP_LABELS ブロックが抽出できませんでした。フォーマット変更を確認してください。`,
		);
	}
	return JSON.parse(m[1]);
}

/**
 * `data-lp-key="ns.k"` を `LP_LABELS.ns.k` に解決する。
 *
 * @param {Record<string, Record<string, string>>} lpLabels
 * @param {string} dottedKey - "ns.k" 形式
 * @returns {string | null} 値が見つからなければ null
 */
function lookupLpLabel(lpLabels, dottedKey) {
	const parts = dottedKey.split('.');
	if (parts.length !== 2) return null;
	const ns = lpLabels[parts[0]];
	if (!ns || typeof ns !== 'object') return null;
	const value = ns[parts[1]];
	return typeof value === 'string' ? value : null;
}

/**
 * parse5 AST を再帰走査し、`data-lp-key` 属性を持つ要素を全て収集する。
 * 親要素が data-lp-key を持つ場合に子要素 data-lp-key も検出 (nested 警告用)。
 *
 * @param {*} node
 * @param {boolean} hasLpKeyAncestor
 * @param {Array<{node: *, dottedKey: string, hasLpKeyAncestor: boolean}>} acc
 */
function collectLpKeyElements(node, hasLpKeyAncestor, acc) {
	const lpKeyAttr = node.attrs?.find((a) => a.name === 'data-lp-key');
	const isLpKey = Boolean(lpKeyAttr);
	if (isLpKey) {
		acc.push({
			node,
			dottedKey: lpKeyAttr.value,
			hasLpKeyAncestor,
		});
	}
	for (const child of node.childNodes ?? []) {
		collectLpKeyElements(child, hasLpKeyAncestor || isLpKey, acc);
	}
}

/**
 * node 配下に data-lp-key を持つ子孫がいるかを返す。
 * @param {*} node
 * @returns {boolean}
 */
function collectHasDescendantLpKey(node) {
	for (const child of node.childNodes ?? []) {
		if (child.attrs?.some((a) => a.name === 'data-lp-key')) return true;
		if (collectHasDescendantLpKey(child)) return true;
	}
	return false;
}

/**
 * 1 ファイルの fallback テキストを update した結果文字列を返す。
 * 元の HTML をベースに、targeted substring replacement で innerHTML のみ surgical に変更する。
 * (jsdom serialize による全体改変を回避)
 *
 * @param {string} _filePath
 * @param {string} html
 * @param {Record<string, Record<string, string>>} lpLabels
 * @returns {{
 *   updated: string;
 *   changes: Array<{ dottedKey: string; oldInner: string; newInner: string; line: number }>;
 *   skippedMissing: string[];
 *   skippedNested: string[];
 *   errorsNestedReplace: string[];
 * }}
 */
function syncFallbackInFile(_filePath, html, lpLabels) {
	const doc = parse(html, { sourceCodeLocationInfo: true });
	/** @type {Array<{node: *, dottedKey: string, hasLpKeyAncestor: boolean}>} */
	const elements = [];
	collectLpKeyElements(doc, false, elements);

	/** @type {Array<{ dottedKey: string; oldInner: string; newInner: string; line: number; startOffset: number; endOffset: number }>} */
	const pendingReplacements = [];
	const skippedMissing = [];
	const skippedNested = [];
	const errorsNestedReplace = [];

	for (const { node, dottedKey, hasLpKeyAncestor } of elements) {
		const canonical = lookupLpLabel(lpLabels, dottedKey);
		if (canonical === null) {
			skippedMissing.push(dottedKey);
			continue;
		}
		const loc = node.sourceCodeLocation;
		if (!loc?.startTag || !loc?.endTag) {
			// void 要素 or self-closing。fallback 不要のためスキップ。
			continue;
		}
		const startOffset = loc.startTag.endOffset;
		const endOffset = loc.endTag.startOffset;
		const oldInner = html.substring(startOffset, endOffset);
		// 既に一致していれば変更不要 (idempotent)
		if (oldInner === canonical) continue;

		// nested data-lp-key を含む要素の値を上書きすると子要素を破壊する。
		// 子に data-lp-key 子孫が居る場合は警告にして skip。
		// (canonical 自身に同じ data-lp-key 子要素 markup が完全に含まれていれば置換可能だが、
		//  そのケースは通常 labels.ts の設計ミスで Phase 3 D5 では非対応)
		const hasLpKeyDescendant = collectHasDescendantLpKey(node);
		if (hasLpKeyDescendant) {
			errorsNestedReplace.push(
				`${dottedKey}: 子孫に data-lp-key を持つため上書き不可。labels.ts の構造を見直してください。`,
			);
			continue;
		}

		// hasLpKeyAncestor は警告だが、親側がそもそも置換 skip されていれば問題なし。
		// hasLpKeyAncestor 自体は実害がないため記録のみ。
		if (hasLpKeyAncestor) {
			skippedNested.push(dottedKey);
		}

		pendingReplacements.push({
			dottedKey,
			oldInner,
			newInner: canonical,
			line: loc.startLine,
			startOffset,
			endOffset,
		});
	}

	// 後ろから前に置換することで offset がずれない
	pendingReplacements.sort((a, b) => b.startOffset - a.startOffset);
	let updated = html;
	for (const r of pendingReplacements) {
		updated = updated.substring(0, r.startOffset) + r.newInner + updated.substring(r.endOffset);
	}

	return {
		updated,
		changes: pendingReplacements.map((r) => ({
			dottedKey: r.dottedKey,
			oldInner: r.oldInner,
			newInner: r.newInner,
			line: r.line,
		})),
		skippedMissing,
		skippedNested,
		errorsNestedReplace,
	};
}

/**
 * unique 要素を返す配列ヘルパー。
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function uniq(arr) {
	return [...new Set(arr)];
}

/**
 * 1 ファイル分の処理 (read → sync → optional write) を行い、サマリ情報を返す。
 * main() の cognitive complexity を下げるため切り出し。
 *
 * **#1974: --check モードでの error 伝播強化**
 *   - 対象 HTML 不存在時: `--check` モードでは failure 扱い (errorsCount += 1) で exit code 1 へ伝播
 *     させる。`--write` モードでは従来通り WARN + skip (open issue ではなく、
 *     新規 LP ファイル追加時の bootstrap UX を維持するため)
 *   - 想定外 error (read / parse 失敗) は両モードで failure 扱い + ファイル名 + error message 明示
 *   - 根拠: Copilot `[must]` (PR #1970, line 261) — TARGET_HTML_FILES の網羅性検査が `--check`
 *     モードの責務であり、silent skip は ADR-0006 (assertion 弱体化禁止) 違反
 *
 * @param {string} relPath
 * @param {Record<string, Record<string, string>>} lpLabels
 * @returns {{
 *   summary: { path: string; count: number; changes: Array<{ dottedKey: string; oldInner: string; newInner: string; line: number }> } | null;
 *   errorsCount: number;
 *   missingKeys: string[];
 * }} ファイル不存在 / 読込み失敗時は summary: null + errorsCount > 0 (--check モード時)
 */
function processFile(relPath, lpLabels) {
	const absPath = path.join(REPO_ROOT, relPath);
	if (!fs.existsSync(absPath)) {
		// #1974: --check モードでは「TARGET_HTML_FILES の網羅性検査」責務のため failure 扱い。
		// --write モードでは新規 LP ファイル追加時の bootstrap UX 維持のため WARN + skip 継続。
		if (CHECK_MODE) {
			console.error(
				`[sync-lp-fallback] ✗ ${relPath} が存在しません — TARGET_HTML_FILES に列挙されていますが実ファイルが見つかりません。SSOT 整合のため --check 失敗扱いとします。`,
			);
			return { summary: null, errorsCount: 1, missingKeys: [] };
		}
		console.warn(`[sync-lp-fallback] WARN: ${relPath} が存在しません — スキップ`);
		return { summary: null, errorsCount: 0, missingKeys: [] };
	}
	let html;
	try {
		html = fs.readFileSync(absPath, 'utf-8');
	} catch (err) {
		// #1974: read 失敗は両モードで failure 扱い (--check / --write 共通)
		console.error(
			`[sync-lp-fallback] ✗ ${relPath} 読込エラー: ${err instanceof Error ? err.message : String(err)}`,
		);
		return { summary: null, errorsCount: 1, missingKeys: [] };
	}
	let result;
	try {
		result = syncFallbackInFile(relPath, html, lpLabels);
	} catch (err) {
		// #1974: parse / 内部処理失敗も両モードで failure 扱い
		console.error(
			`[sync-lp-fallback] ✗ ${relPath} 処理エラー: ${err instanceof Error ? err.message : String(err)}`,
		);
		return { summary: null, errorsCount: 1, missingKeys: [] };
	}

	if (result.errorsNestedReplace.length > 0) {
		console.error(`\n[sync-lp-fallback] ✗ ${relPath} — nested data-lp-key 上書きエラー:`);
		for (const err of result.errorsNestedReplace) {
			console.error(`  - ${err}`);
		}
	}

	const summary =
		result.changes.length > 0
			? {
					path: relPath,
					count: result.changes.length,
					changes: result.changes,
				}
			: null;

	if (summary && !CHECK_MODE) {
		fs.writeFileSync(absPath, result.updated, 'utf-8');
	}

	return {
		summary,
		errorsCount: result.errorsNestedReplace.length,
		missingKeys: uniq(result.skippedMissing),
	};
}

/**
 * --check モード時の差分一覧表示。
 *
 * @param {Array<{ path: string; count: number; changes: Array<{ dottedKey: string; oldInner: string; newInner: string; line: number }> }>} fileSummaries
 * @param {number} totalChanges
 */
function printCheckModeReport(fileSummaries, totalChanges) {
	console.error(`✗ fallback テキストが labels.ts と乖離しています (${totalChanges} 件)`);
	for (const summary of fileSummaries) {
		console.error(`\n  ${summary.path} (${summary.count} 件):`);
		for (const c of summary.changes.slice(0, 5)) {
			const oldDisp = c.oldInner.length > 60 ? `${c.oldInner.slice(0, 57)}...` : c.oldInner;
			const newDisp = c.newInner.length > 60 ? `${c.newInner.slice(0, 57)}...` : c.newInner;
			console.error(
				`    line ${c.line} ${c.dottedKey}: ${JSON.stringify(oldDisp)} → ${JSON.stringify(newDisp)}`,
			);
		}
		if (summary.changes.length > 5) {
			console.error(`    ... and ${summary.changes.length - 5} more`);
		}
	}
	console.error(
		'\n  修正方法: `node scripts/sync-lp-fallback.mjs` を実行して fallback を再生成してください。',
	);
}

function main() {
	const lpLabels = loadLpLabels();

	let totalChanges = 0;
	let totalErrors = 0;
	const fileSummaries = [];

	// #1974: テスト専用 env override (本番では空配列のため通常 TARGET_HTML_FILES を使用)
	// path validation (M-1) で Error throw された場合は stderr に明示しつつ exit 1 で終了
	let overrides;
	try {
		overrides = loadTargetOverridesFromEnv();
	} catch (err) {
		console.error(`[sync-lp-fallback] FAIL — ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	const targetFiles = overrides.length > 0 ? overrides : TARGET_HTML_FILES;

	for (const relPath of targetFiles) {
		const r = processFile(relPath, lpLabels);
		// #1974: processFile は常に object を返す (null skip 廃止)。
		// missing target / read error / parse error 全てが errorsCount に伝播する。
		totalErrors += r.errorsCount;
		if (r.summary) {
			fileSummaries.push(r.summary);
			totalChanges += r.summary.count;
		}
		if (VERBOSE && r.missingKeys.length > 0) {
			const sampled = r.missingKeys.slice(0, 5).join(', ');
			const tail = r.missingKeys.length > 5 ? ' ...' : '';
			console.log(
				`[sync-lp-fallback] ${relPath}: skip (LP_LABELS 未定義) ${r.missingKeys.length} 件: ${sampled}${tail}`,
			);
		}
	}

	if (totalErrors > 0) {
		// #1974: nested エラー / missing target / read / parse 失敗を全て errorsCount に集計し
		// exit code 1 に伝播させる (Copilot [must] 指摘 — silent skip による検証経路握り潰し回避)
		console.error(`\n[sync-lp-fallback] FAIL — エラー ${totalErrors} 件。`);
		process.exit(1);
	}

	if (CHECK_MODE) {
		if (totalChanges === 0) {
			console.log('✓ 全 site/*.html の fallback テキストは labels.ts と同期済みです');
			return;
		}
		printCheckModeReport(fileSummaries, totalChanges);
		process.exit(1);
	}

	if (totalChanges === 0) {
		console.log('✓ 全 site/*.html の fallback テキストは既に labels.ts と同期済みです');
		return;
	}

	console.log(`✓ ${totalChanges} 件の fallback テキストを更新しました:`);
	for (const summary of fileSummaries) {
		console.log(`  - ${summary.path}: ${summary.count} 件`);
	}
}

// CLI 実行時のみ main() を呼ぶ。テストから import される場合は副作用なし
const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedAsCli) {
	main();
}

// テスト用エクスポート
export {
	collectHasDescendantLpKey,
	collectLpKeyElements,
	loadLpLabels,
	lookupLpLabel,
	processFile,
	syncFallbackInFile,
	TARGET_HTML_FILES,
};
