#!/usr/bin/env node
/**
 * scripts/check-ss-blob-sha-uniqueness.mjs
 *
 * Before/After SS の Blob SHA 一致 (= 完全同一画像 = 偽装) を検出する gate (#2063 / #4084)。
 *
 * 入力:
 *   node scripts/check-ss-blob-sha-uniqueness.mjs --pr <N>              # gh で PR を引く
 *   PR_BODY="$(gh pr view <N> --json body -q .body)" node scripts/...   # CI (workflow) 経路
 *
 * `--pr` を黙殺して空 body を検査し SKIP (exit 0) していたのを #4348 で是正した。
 * 入力解決は `scripts/lib/ci/pr-input.mjs` (SSOT) に委譲する。
 */
import {
	formatPrInputUsage,
	isHelpRequested,
	PrInputError,
	resolvePrInput,
} from './lib/ci/pr-input.mjs';
import { MIN_REASON_LENGTH, parseReasonDeclaration } from './lib/ci/reason-declaration.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

const SCRIPT_NAME = 'scripts/check-ss-blob-sha-uniqueness.mjs';

const MODE = (process.env.CHECK_MODE || 'warn').toLowerCase();
// #2946 (Phase A/A-4): lane は SSOT (actions/pr-lane → scripts/pr-lane.mjs) 経由で渡される。
// 本 gate は before-*/after-* ペア不在時に既に skip する設計のため lane 分岐は最小 (Issue #2946 解決策)。
// integration lane (統合 PR、複数機能バッチで before/after ペアを持たない) で false positive が
// 出ないことを log で可視化するに留め、検証ロジック (checkSsBlobShaUniqueness) は lane 非依存に保つ。
const PR_LANE = (process.env.PR_LANE || 'feature').trim().toLowerCase();

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
		const [url, owner = '', repo = '', ref = '', path = ''] = m;
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

// ---------------------------------------------------------------------------
// #4084: 命名非依存のペアリング宣言 + 理由必須の例外宣言
// ---------------------------------------------------------------------------

/**
 * 理由の実体判定は `scripts/lib/ci/reason-declaration.mjs` が SSOT (#4129 AC5 で集約)。
 * 本 module からの re-export は既存の import 経路を壊さないために維持する。
 */
export { MIN_REASON_LENGTH, parseReasonDeclaration };

/**
 * ペアリング宣言を読む (#4084 AC2)。
 *
 * 撮影者の命名自由度を保ったまま機械が対応関係を取れるようにする。実測 (#4080) の
 * `develop-*` / `pr4080-*` は prefix 宣言 1 行で 20 枚すべてペアになる。
 *
 *   <!-- ss-pair-prefix: before=develop- after=pr4080- -->
 *   <!-- ss-pair: before=<path or raw URL> after=<path or raw URL> -->
 *
 * @param {string} body
 * @returns {{ prefixes: { before: string; after: string }[]; explicit: { before: string; after: string }[] }}
 */
export function parsePairDeclarations(body) {
	const prefixes = [];
	for (const m of body.matchAll(/<!--\s*ss-pair-prefix\s*:\s*before=(\S+)\s+after=(\S+)\s*-->/g)) {
		prefixes.push({ before: m[1] ?? '', after: m[2] ?? '' });
	}
	const explicit = [];
	for (const m of body.matchAll(/<!--\s*ss-pair\s*:\s*before=(\S+)\s+after=(\S+)\s*-->/g)) {
		explicit.push({ before: toScreenshotPath(m[1] ?? ''), after: toScreenshotPath(m[2] ?? '') });
	}
	return { prefixes, explicit };
}

/**
 * raw URL でも path でも受け取れるように、screenshots branch 以下の path に正規化する。
 *
 * @param {string} value
 * @returns {string}
 */
function toScreenshotPath(value) {
	const m = value.match(
		/https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/screenshots\/([^\s)]+)/,
	);
	return m?.[1] ?? value;
}

/**
 * SS path 一覧をペアリングする (#4084 AC2)。
 *
 * 優先順位: 明示ペア宣言 → prefix 宣言 → 既定の `before-*` / `after-*` 命名。
 * どれか 1 つで対応が取れれば SHA 比較まで進む (= 命名を変えただけで検査が消えない)。
 *
 * @param {string[]} paths
 * @param {{ prefixes: { before: string; after: string }[]; explicit: { before: string; after: string }[] }} decls
 * @returns {Array<{ key: string; before: string; after: string }>}
 */
export function pairScreenshots(paths, decls = { prefixes: [], explicit: [] }) {
	const available = new Set(paths);
	const used = new Set();
	const pairs = [];

	for (const { before, after } of decls.explicit ?? []) {
		if (available.has(before) && available.has(after)) {
			pairs.push({ key: `${before} ⇄ ${after}`, before, after });
			used.add(before);
			used.add(after);
		}
	}

	for (const { before: bp, after: ap } of decls.prefixes ?? []) {
		const beforeMap = new Map();
		const afterMap = new Map();
		for (const p of paths) {
			if (used.has(p)) continue;
			const slash = p.lastIndexOf('/');
			const dir = slash >= 0 ? p.slice(0, slash + 1) : '';
			const basename = slash >= 0 ? p.slice(slash + 1) : p;
			if (basename.startsWith(bp)) beforeMap.set(`${dir}${basename.slice(bp.length)}`, p);
			else if (basename.startsWith(ap)) afterMap.set(`${dir}${basename.slice(ap.length)}`, p);
		}
		for (const [key, before] of beforeMap) {
			const after = afterMap.get(key);
			if (!after) continue;
			pairs.push({ key, before, after });
			used.add(before);
			used.add(after);
		}
	}

	for (const pair of pairBeforeAfter(paths.filter((p) => !used.has(p)))) {
		pairs.push(pair);
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
 * @param {typeof fetch} [fetcher] - DI 用 (test では mock)
 * @returns {Promise<string>}
 */
export async function fetchBlobSha(loc, fetcher = fetch) {
	const { owner, repo, ref, path } = loc;
	const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`;
	/** @type {Record<string, string>} */
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
 * @returns {Promise<{ status: 'pass' | 'fail' | 'skip'; reason: string;
 *   violations?: Array<{ key: string; before: string; after: string; sha: string }>;
 *   acknowledgedIdenticalPairs?: Array<{ key: string; before: string; after: string; sha: string }>;
 *   pairingHelp?: boolean }>}
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

	// 2. ペアリング (#4084 AC2: 明示宣言 → prefix 宣言 → 既定命名の順で対応を取る)
	const paths = refs.map((r) => r.path);
	const decls = parsePairDeclarations(body);
	const pairs = pairScreenshots(paths, decls);

	if (pairs.length === 0) {
		// #4084 AC1: SS が embed されているのにペアが 0 件 = **偽装検知が 1 度も実行できていない**。
		// 旧実装はここを skip にしていたため「20 枚あって 0 ペア」が silent に pass していた
		// (実測: PR #4080)。検知できなかったことを黙って通さない (#3983 / #4074 と同 class)。
		const none = parseReasonDeclaration(body, 'ss-pair-none');
		if (none.present && none.valid) {
			return {
				status: 'pass',
				reason:
					`SS ${refs.length} 件でペアが 0 件だが、宣言により対象外と判定: ${none.reason} ` +
					'(<!-- ss-pair-none: <理由> -->、#4084 AC1)',
			};
		}
		return {
			status: 'fail',
			reason:
				`SS ${refs.length} 件が embed されているのに Before/After ペアが 0 件で、偽装検知を 1 ペアも実行できていません (#4084 AC1)。` +
				(none.present
					? ' `<!-- ss-pair-none: ... -->` は宣言されていますが理由が空 / 定型 stub のため受理できません。'
					: ''),
			pairingHelp: true,
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

	// #4084 AC3: 「Before / After が同一であることが正しい」ケースの明示経路。
	// 実測 (#4080): JST 00:00〜09:00 の 9 時間帯だけ日付がずれる修正を、その窓の外 (JST 日中) に
	// 撮影したため描画が一致するのが正しい結果だった。理由の記述を必須とし (空なら fail)、
	// 同一だった事実自体は握り潰さず列挙する。`refactor:internal-no-doc-impact` (挙動不変の
	// 内部 refactor 用) とは意味が違うので別経路にする。
	const identicalOk = parseReasonDeclaration(body, 'ss-identical-ok');
	if (identicalOk.present && identicalOk.valid) {
		return {
			status: 'pass',
			reason:
				`${violations.length} ペアが Blob SHA 一致だが、理由付き宣言により正当と判定: ${identicalOk.reason} ` +
				'(<!-- ss-identical-ok: <理由> -->、#4084 AC3)',
			acknowledgedIdenticalPairs: violations,
		};
	}

	return {
		status: 'fail',
		reason:
			`${violations.length} ペアの SS が完全同一画像 (Blob SHA 一致 = 偽装疑い)` +
			(identicalOk.present
				? '。`<!-- ss-identical-ok: ... -->` は宣言されていますが理由が空 / 定型 stub のため受理できません (理由必須、#4084 AC3 / #3956)'
				: ''),
		violations,
	};
}

async function main() {
	// CHECK_MODE は warn / error の二値運用 (将来の段階適用フラグ)
	const isError = MODE === 'error';
	const argv = process.argv.slice(2);

	if (isHelpRequested(argv)) {
		console.log(
			[
				`${SCRIPT_NAME} — Before/After SS の Blob SHA 一致 (偽装) を検出します (#2063 / #4084)。`,
				'',
				'入力 (いずれか。無指定は失敗します — #4348):',
				formatPrInputUsage(SCRIPT_NAME, 'body'),
				'',
				'(help を表示しただけで、検査は実行していません)',
			].join('\n'),
		);
		return 0;
	}

	// #4348: 入力ゼロ (`--pr` 黙殺 / PR_BODY 未設定) を SKIP=exit 0 にしない。
	let input;
	try {
		input = resolvePrInput({ argv, env: process.env, need: 'body', scriptName: SCRIPT_NAME });
	} catch (err) {
		if (err instanceof PrInputError) {
			console.error(`[ss-blob-sha-uniqueness] INPUT ERROR — ${err.message}`);
			return 2;
		}
		throw err;
	}

	let result;
	try {
		result = await checkSsBlobShaUniqueness({ body: input.body, labels: input.labels });
	} catch (err) {
		console.error(
			'[ss-blob-sha-uniqueness] internal error:',
			err instanceof Error ? err.message : String(err),
		);
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

	// #4084 AC1: ペアが 0 件で検査そのものが実行できなかった場合の対応手順
	if (result.pairingHelp) {
		console.log(`\n対応方法 (いずれか 1 つ):`);
		console.log(`  1. SS の file 名を規約どおり before-<key> / after-<key> にする`);
		console.log(
			`  2. 命名を変えたくない場合は PR body に prefix 宣言を置く:\n` +
				`       <!-- ss-pair-prefix: before=develop- after=pr<PR番号>- -->`,
		);
		console.log(
			`  3. 個別に対応を書く場合:\n` +
				`       <!-- ss-pair: before=<raw URL or path> after=<raw URL or path> -->`,
		);
		console.log(
			`  4. ペアが原理的に存在しない場合 (新規画面で修正前が無い 等) は理由を書いて宣言する:\n` +
				`       <!-- ss-pair-none: <${MIN_REASON_LENGTH} 文字以上の理由> -->`,
		);
		console.log(
			`\nSS が embed されているのにペア 0 件を skip で通すと、偽装検知 (#2063) が黙って無効化されます (#4084)。`,
		);
		return isError ? 1 : 0;
	}

	const violations = result.violations ?? [];
	console.log(`\nSS forging detected (Blob SHA 完全一致):`);
	for (const v of violations) {
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
		`  4. **同一であることが正しい**場合 (差分が現れる条件の外で撮影した 等) は理由を書いて宣言する:\n` +
			`       <!-- ss-identical-ok: <${MIN_REASON_LENGTH} 文字以上の理由> -->\n` +
			`     理由が空 / TODO 等の定型 stub では受理しません (#4084 AC3 / #3956)。`,
	);
	console.log(
		`\n[${prefix.replace(/[[\]]/g, '')}] mode=${MODE}, violations=${violations.length} ` +
			`(${isError ? 'CI を red にします' : '段階適用中: warning として記録、CI は通過させます'})`,
	);

	return isError ? 1 : 0;
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error('[ss-blob-sha-uniqueness] uncaught:', err);
			process.exit(2);
		},
	);
}
