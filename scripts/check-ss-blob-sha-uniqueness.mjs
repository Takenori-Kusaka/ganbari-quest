#!/usr/bin/env node

/**
 * scripts/check-ss-blob-sha-uniqueness.mjs (#2063)
 *
 * PR body の Before / After SS が **完全同一画像** (Blob SHA 一致) でないことを検証する CI gate。
 *
 * # 設計背景
 *
 * 2026-05-09 PR-2054 (#1912 LP 文言顧客語彙化) で SS 偽装が 3 ラウンド連続発生し、
 * 最終的に user 判断で PR close。実装ブランチを `git push --force` で 3 回 rebase したものの、
 * **`screenshots` branch (独立 branch) が更新されず**、Before / After SS が 1 byte も違わない
 * **完全同一画像** のまま PR body に貼られ続けた。
 *
 * QA bot が GitHub `gh api repos/.../contents/<path>?ref=screenshots` で
 * Blob SHA (Git の content-addressable hash) を取得・比較し偽装を検出した手動運用を、
 * **CI workflow に組み込み systematic に強制する** のが本スクリプトの責務。
 *
 * # 偽装パターン (PR-2054 実例)
 *
 * - `before-index-desktop.png` SHA `f4d9eebfca72e9efd30cf1c67621b3647357c0ba`
 * - `after-index-desktop.png`  SHA `f4d9eebfca72e9efd30cf1c67621b3647357c0ba` ← 完全一致
 *
 * SHA 完全一致 = 同一 Blob 参照 = 同一画像 1 px 違い無し。
 * これを「視覚的に変化があった証拠」として PR body に貼ると偽装。
 *
 * # 検出ロジック
 *
 * 1. PR body から SS URL を regex で抽出 (`raw.githubusercontent.com/.../screenshots/<path>`)
 * 2. URL から `(owner, repo, ref, path)` を parse
 * 3. `before-` / `after-` prefix で始まる SS をペアリング
 *    (例: `before-index-mobile.png` <-> `after-index-mobile.png`)
 * 4. `gh api repos/{owner}/{repo}/contents/{path}?ref=screenshots` で Blob SHA 取得
 * 5. ペアの SHA が同一 → fail (`core.setFailed`)
 *
 * # スキップ条件 (AC3)
 *
 * - PR ラベル `refactor:internal-no-doc-impact` 付与時 (visual diff ゼロ refactor)
 *   → check-pr-screenshot.mjs / design-doc-check.mjs と同パターン (#2017 / #1985)
 * - SS 1 件のみ / before-only / after-only → 比較対象なし、skip
 *
 * # OSS 先調査 (ADR-0014 / #1350)
 *
 * Issue #2063 本文に 3 選択肢比較記載済 (再記載不要)。本スクリプトは **選択肢 A** を実装:
 * - 採用: GitHub Actions `gh api` + Blob SHA 比較 (確立パターン、~30 行 script)
 * - 不採用: pixelmatch / sharp 画素差分 (Pre-PMF overkill、ADR-0010)
 * - 不採用: 独自 A+B 結合ツール (Pre-PMF overkill)
 *
 * # 環境変数
 *
 *   PR_BODY      — PR body Markdown (github.event.pull_request.body)
 *   PR_LABELS    — カンマ区切りの PR ラベル (gh pr view --json labels --jq ...)
 *   GH_TOKEN     — GitHub API token (gh CLI 経由 or env)
 *   GITHUB_REPOSITORY — `owner/repo` (Actions では自動設定、ローカルなら手動指定)
 *   CHECK_MODE   — 'warn' (default) | 'error'
 *                  'error' で fail 時 exit 1。dogfooding 期間後に昇格。
 *
 * # ローカル実行
 *
 *   PR_BODY="$(gh pr view 2054 --json body --jq .body)" \
 *   PR_LABELS="$(gh pr view 2054 --json labels --jq '[.labels[].name] | join(",")')" \
 *   GITHUB_REPOSITORY=Takenori-Kusaka/ganbari-quest \
 *   CHECK_MODE=error \
 *     node scripts/check-ss-blob-sha-uniqueness.mjs
 *
 * # exit code
 *
 *   0 — OK / skip / warn モードで違反あり
 *   1 — error モードで違反あり
 *   2 — internal error (API rate limit / 認証失敗 / etc)
 */

import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE = (process.env.CHECK_MODE || 'warn').toLowerCase();
// #2946 (Phase A/A-4): lane は SSOT (actions/pr-lane → scripts/pr-lane.mjs) 経由で渡される。
// 本 gate は before-*/after-* ペア不在時に既に skip する設計のため lane 分岐は最小 (Issue #2946 解決策)。
// integration lane (統合 PR、複数機能バッチで before/after ペアを持たない) で false positive が
// 出ないことを log で可視化するに留め、検証ロジック (checkSsBlobShaUniqueness) は lane 非依存に保つ。
const PR_LANE = (process.env.PR_LANE || 'feature').trim().toLowerCase();
const PR_BODY = process.env.PR_BODY || '';
const PR_LABELS = (process.env.PR_LABELS || '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// ---------------------------------------------------------------------------
// Pure functions (named exports for vitest)
// ---------------------------------------------------------------------------

/**
 * #2017 / #1985 / #2063 共通: 内部 refactor exempt のラベル名。
 *
 * 値が変わると 3 workflow 間の整合が壊れるため、固定値検証 unit test 必須。
 */
export const INTERNAL_REFACTOR_LABEL = 'refactor:internal-no-doc-impact';

/**
 * PR ラベル一覧に exempt ラベルが含まれるかを判定。
 *
 * @param {string[]} labels
 * @returns {boolean}
 */
export function hasInternalRefactorLabel(labels) {
	return labels.some((l) => l.trim().toLowerCase() === INTERNAL_REFACTOR_LABEL);
}

// SS URL pattern: raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
// path 部分から `pr-NNNN/before-X.png` 等を抽出する
const RAW_GITHUB_PATTERN =
	/https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/([^\s)]+\.(?:png|jpe?g|webp|gif))/gi;

/**
 * PR body から `raw.githubusercontent.com` の SS URL を抽出し、
 * 各 URL から `{owner, repo, ref, path}` を parse する。
 *
 * `ref === 'screenshots'` のもののみ対象とする (本 gate は screenshots branch 専用)。
 *
 * @param {string} body
 * @returns {Array<{ owner: string; repo: string; ref: string; path: string; url: string }>}
 */
export function extractScreenshotRefs(body) {
	const refs = [];
	for (const m of body.matchAll(RAW_GITHUB_PATTERN)) {
		const [url, owner, repo, ref, path] = m;
		if (ref !== 'screenshots') continue;
		refs.push({ owner, repo, ref, path, url });
	}
	return refs;
}

/**
 * SS path 一覧から before-* / after-* prefix のペアを生成する。
 *
 * 命名規則:
 * - `<dir>/before-<key>.<ext>` <-> `<dir>/after-<key>.<ext>`
 * - 例: `pr-2054/before-index-mobile.png` <-> `pr-2054/after-index-mobile.png`
 *
 * @param {string[]} paths - SS path 一覧 (例: ['pr-2054/before-index-mobile.png', ...])
 * @returns {Array<{ key: string; before: string; after: string }>}
 */
export function pairBeforeAfter(paths) {
	const beforeMap = new Map();
	const afterMap = new Map();

	for (const p of paths) {
		// 最後の `/` 以降が basename。`<dir>/before-<key>.png` から prefix と key を抽出
		const slash = p.lastIndexOf('/');
		const dir = slash >= 0 ? p.slice(0, slash + 1) : '';
		const basename = slash >= 0 ? p.slice(slash + 1) : p;

		const beforeMatch = basename.match(/^before-(.+)$/i);
		const afterMatch = basename.match(/^after-(.+)$/i);

		if (beforeMatch) {
			const key = `${dir}${beforeMatch[1]}`;
			beforeMap.set(key, p);
		} else if (afterMatch) {
			const key = `${dir}${afterMatch[1]}`;
			afterMap.set(key, p);
		}
	}

	const pairs = [];
	for (const [key, before] of beforeMap) {
		const after = afterMap.get(key);
		if (after) {
			pairs.push({ key, before, after });
		}
	}
	return pairs;
}

/**
 * GitHub Contents API で Blob SHA を取得する。
 *
 * `gh api repos/{owner}/{repo}/contents/{path}?ref={ref}` 相当。
 * Actions runner では `GH_TOKEN` / `GITHUB_TOKEN` 経由で自動認証。
 *
 * @param {{ owner: string; repo: string; ref: string; path: string }} loc
 * @param {typeof fetch} [fetcher] — DI 用 (test では mock)
 * @returns {Promise<string>}
 */
export async function fetchBlobSha(loc, fetcher = fetch) {
	const { owner, repo, ref, path } = loc;
	const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`;
	const headers = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetcher(apiUrl, { headers });
	if (!res.ok) {
		throw new Error(
			`GitHub API failed for ${owner}/${repo}/${path}@${ref}: ${res.status} ${res.statusText}`,
		);
	}
	const json = await res.json();
	if (!json.sha) {
		throw new Error(`No 'sha' field in response for ${owner}/${repo}/${path}@${ref}`);
	}
	return json.sha;
}

/**
 * SS ペアの Blob SHA 一覧から、同一 SHA の偽装ペアを検出する。
 *
 * @param {Array<{ key: string; before: string; after: string; beforeSha: string; afterSha: string }>} pairsWithSha
 * @returns {Array<{ key: string; before: string; after: string; sha: string }>}
 */
export function detectIdenticalPairs(pairsWithSha) {
	return pairsWithSha
		.filter((p) => p.beforeSha === p.afterSha)
		.map((p) => ({ key: p.key, before: p.before, after: p.after, sha: p.beforeSha }));
}

/**
 * PR-2054 偽装 sentinel fixture (#2063 AC5)。
 *
 * これらの SHA は PR-2054 の screenshots branch で実際に発生した
 * before/after 完全一致ペアの Blob SHA。回帰テスト用に固定値で保持し、
 * 今後の同種偽装パターンが pairBeforeAfter + detectIdenticalPairs で
 * 確実に検出されることを test fixture として保証する。
 *
 * 取得元: `gh api repos/Takenori-Kusaka/ganbari-quest/contents/pr-2054?ref=screenshots`
 *         (2026-05-09 取得)
 */
export const PR_2054_SENTINEL_FIXTURE = Object.freeze({
	prNumber: 2054,
	identicalPairs: Object.freeze([
		Object.freeze({
			key: 'pr-2054/index-desktop.png',
			before: 'pr-2054/before-index-desktop.png',
			after: 'pr-2054/after-index-desktop.png',
			sha: 'f4d9eebfca72e9efd30cf1c67621b3647357c0ba',
		}),
		Object.freeze({
			key: 'pr-2054/index-mobile.png',
			before: 'pr-2054/before-index-mobile.png',
			after: 'pr-2054/after-index-mobile.png',
			sha: '82c0a8dfdbe4179c7f345308697b316b8a43e287',
		}),
		Object.freeze({
			key: 'pr-2054/pricing-desktop.png',
			before: 'pr-2054/before-pricing-desktop.png',
			after: 'pr-2054/after-pricing-desktop.png',
			sha: '5706cee856a1b9fa0f4a55215fe62b66e1ba7d8b',
		}),
		Object.freeze({
			key: 'pr-2054/pricing-mobile.png',
			before: 'pr-2054/before-pricing-mobile.png',
			after: 'pr-2054/after-pricing-mobile.png',
			sha: '910fcbf4b7395ad36334b3a506b2dff03933adb2',
		}),
	]),
});

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * 本体処理。fetcher を DI 可能にして test で mock 注入する。
 *
 * @param {{ body: string; labels: string[]; fetcher?: typeof fetch }} input
 * @returns {Promise<{ status: 'pass' | 'fail' | 'skip'; reason: string; violations?: Array<{ key: string; before: string; after: string; sha: string }> }>}
 */
export async function checkSsBlobShaUniqueness({ body, labels, fetcher = fetch }) {
	// AC3: label exempt
	if (hasInternalRefactorLabel(labels)) {
		return {
			status: 'skip',
			reason: `PR ラベル '${INTERNAL_REFACTOR_LABEL}' により内部 refactor として exempt (#2063 AC3 / #2017 / #1985)`,
		};
	}

	// 1. SS URL 抽出
	const refs = extractScreenshotRefs(body);
	if (refs.length === 0) {
		return {
			status: 'skip',
			reason: 'PR body に raw.githubusercontent.com/.../screenshots/... 参照が見つかりません',
		};
	}

	// 2. before/after ペアリング
	// 同 ref からの path 一覧をペア化
	const paths = refs.map((r) => r.path);
	const pairs = pairBeforeAfter(paths);

	if (pairs.length === 0) {
		return {
			status: 'skip',
			reason: `before-* / after-* ペアが 0 件 (SS ${refs.length} 件中)。命名規則 (before-<key> / after-<key>) に従っていない、または single-side のみ`,
		};
	}

	// 3. Blob SHA 取得 (path -> ref location lookup)
	const refByPath = new Map(refs.map((r) => [r.path, r]));
	const pairsWithSha = [];
	for (const pair of pairs) {
		const beforeRef = refByPath.get(pair.before);
		const afterRef = refByPath.get(pair.after);
		if (!beforeRef || !afterRef) continue;
		const [beforeSha, afterSha] = await Promise.all([
			fetchBlobSha(beforeRef, fetcher),
			fetchBlobSha(afterRef, fetcher),
		]);
		pairsWithSha.push({ ...pair, beforeSha, afterSha });
	}

	// 4. 同一 SHA 偽装検出
	const violations = detectIdenticalPairs(pairsWithSha);

	if (violations.length === 0) {
		return {
			status: 'pass',
			reason: `${pairsWithSha.length} ペアすべて Blob SHA が異なる (偽装なし)`,
		};
	}

	return {
		status: 'fail',
		reason: `${violations.length} ペアの SS が完全同一画像 (Blob SHA 一致 = 偽装疑い)`,
		violations,
	};
}

async function main() {
	// CHECK_MODE は warn / error の二値運用 (将来の段階適用フラグ)
	const isError = MODE === 'error';

	let result;
	try {
		result = await checkSsBlobShaUniqueness({ body: PR_BODY, labels: PR_LABELS });
	} catch (err) {
		console.error('[ss-blob-sha-uniqueness] internal error:', err.message);
		return 2;
	}

	const prefix = '[ss-blob-sha-uniqueness]';

	// #2946 AC5: 統合 PR は before/after ペアを持たないため skip 系に落ちるのが正常。
	// lane=integration で skip した場合は「false positive ではなく対象なし pass」であることを明示。
	if (PR_LANE === 'integration' && result.status === 'skip') {
		console.log(
			`${prefix} SKIP (lane=integration) — ${result.reason}。統合 PR は before/after ペア前提を持たないため対象なし pass (false positive ではありません、#2946 AC5)`,
		);
		return 0;
	}

	if (result.status === 'skip') {
		console.log(`${prefix} SKIP — ${result.reason}`);
		return 0;
	}
	if (result.status === 'pass') {
		console.log(`${prefix} OK — ${result.reason}`);
		return 0;
	}

	// fail
	console.log(`\n${prefix} ${isError ? 'ERROR' : 'WARN'} — ${result.reason}`);
	console.log(`\nSS forging detected (Blob SHA 完全一致):`);
	for (const v of result.violations) {
		console.log(`  - ${v.before} == ${v.after} (SHA: ${v.sha})`);
	}
	console.log(
		`\n背景: PR-2054 (#1912) で 3 ラウンド連続偽装が発生。実装ブランチを force-push で rebase`,
	);
	console.log(
		`しても screenshots branch が更新されないため、Before / After SS が完全同一画像のままに。`,
	);
	console.log(`\n対応方法:`);
	console.log(`  1. 修正後 SS を撮影し直す (scripts/capture.mjs --pr <N>)`);
	console.log(`  2. 撮影したファイルを screenshots branch に push`);
	console.log(`  3. PR body の after-* URL が新しい SHA を指していることを確認`);
	console.log(
		`\n[${prefix.replace(/[[\]]/g, '')}] mode=${MODE}, violations=${result.violations.length} ` +
			`(${isError ? 'CI を red にします' : '段階適用中: warning として記録、CI は通過させます'})`,
	);

	return isError ? 1 : 0;
}

const isMain = (() => {
	try {
		return pathResolve(fileURLToPath(import.meta.url)) === pathResolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error('[ss-blob-sha-uniqueness] uncaught:', err);
			process.exit(2);
		},
	);
}
