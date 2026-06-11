/**
 * scripts/lib/screenshot-helpers.mjs (#1206, #1424, #1766)
 *
 * `take-lp-screenshots.mjs` / `capture-hp-screenshots.mjs` 共通ユーティリティの SSOT。
 * #1424 で ScreenshotCapture / FlowRecorder クラスと純粋関数を追加。
 * #1766 で DOM snapshot 機能 (#1747 AC4 follow-up) を追加。
 *   PR #1717 で SS と実機が乖離していた事故の再発防止のため、SS と
 *   `document.documentElement.outerHTML` を **同一プロセスで** 取得する。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 既存エクスポート（維持）
// ============================================================

// ============================================================
// SS 偽装検出 (#2059): Before / After sha256 同一性ガード
// ============================================================
//
// 設計背景: PR #2024 / #2025 / #2040 / #2043 / #2054 で 5 件連続発生した
// 「Before / After SS が完全同一画像 (sha256 一致) のまま PR body に貼られる」
// SS 偽装事例への capture script 側ガード (#2063 CI gate と相補)。
//
// 撮影直後にローカル file hash で同一を検出することで、PR body 貼付前に
// 「Before SS は main HEAD で撮影 / After SS は PR HEAD で撮影」運用ミスを
// 検知する。CI gate (#2063) は screenshots branch push 後の Blob SHA 比較で
// 検出するが、本ガードは push 前のローカル段階で fail-fast する。

/**
 * ファイルの sha256 hex digest を返す。
 *
 * Node 標準 `crypto.createHash('sha256')` を使用 (Issue #2059 選択肢 C 採用、
 * pixelmatch / Playwright snapshot は overkill のため不採用)。
 *
 * @param {string} filePath - 絶対 or 相対パス
 * @returns {string} 64 hex chars
 */
export function sha256OfFile(filePath) {
	const data = fs.readFileSync(filePath);
	return createHash('sha256').update(data).digest('hex');
}

/**
 * ファイルパス配列から `before-<key>.<ext>` / `after-<key>.<ext>` のペアを抽出する。
 *
 * 命名規則 (CI gate #2063 と同一):
 * - `<dir>/before-<key>.<ext>` <-> `<dir>/after-<key>.<ext>`
 * - 例: `tmp/screenshots/pr-2059/before-index-mobile.png` <-> `.../after-index-mobile.png`
 *
 * basename の prefix 一致のみで判定し dir も key の一部に含めるため、
 * 異なる dir の `before-x` / `after-x` はペアにならない (誤検知防止)。
 *
 * @param {string[]} filePaths - SS ファイルパス一覧 (絶対 or 相対)
 * @returns {Array<{ key: string; before: string; after: string }>}
 */
export function findBeforeAfterPairs(filePaths) {
	/** @type {Map<string, string>} */
	const beforeMap = new Map();
	/** @type {Map<string, string>} */
	const afterMap = new Map();

	for (const fp of filePaths) {
		const dir = path.dirname(fp);
		const basename = path.basename(fp);
		const beforeMatch = basename.match(/^before-(.+)$/i);
		const afterMatch = basename.match(/^after-(.+)$/i);
		if (beforeMatch) {
			const key = `${dir}${path.sep}${beforeMatch[1]}`;
			beforeMap.set(key, fp);
		} else if (afterMatch) {
			const key = `${dir}${path.sep}${afterMatch[1]}`;
			afterMap.set(key, fp);
		}
	}

	const pairs = [];
	for (const [key, before] of beforeMap) {
		const after = afterMap.get(key);
		if (after) pairs.push({ key, before, after });
	}
	return pairs;
}

/**
 * Before / After ペアの sha256 が同一なものを検出する。
 *
 * @param {Array<{ key: string; before: string; after: string }>} pairs
 * @param {(path: string) => string} [hasher=sha256OfFile] - DI 用 (test で mock)
 * @returns {Array<{ key: string; before: string; after: string; sha: string }>}
 */
export function detectIdenticalBeforeAfterPairs(pairs, hasher = sha256OfFile) {
	/** @type {Array<{ key: string; before: string; after: string; sha: string }>} */
	const violations = [];
	for (const pair of pairs) {
		const beforeSha = hasher(pair.before);
		const afterSha = hasher(pair.after);
		if (beforeSha === afterSha) {
			violations.push({ ...pair, sha: beforeSha });
		}
	}
	return violations;
}

/**
 * 撮影ファイル一覧から Before/After 偽装を検出し、違反があれば fail 用 message を返す。
 * 違反 0 件 (またはペア 0 件) なら null。
 *
 * capture.mjs から呼ばれ、戻り値が non-null なら process.exit(1) する想定。
 *
 * @param {string[]} capturedFiles - 今回 capture session で書き出した全ファイルパス
 * @param {(path: string) => string} [hasher=sha256OfFile]
 * @returns {{ violations: Array<{ key: string; before: string; after: string; sha: string }>; message: string } | null}
 */
export function checkBeforeAfterIdentical(capturedFiles, hasher = sha256OfFile) {
	const pairs = findBeforeAfterPairs(capturedFiles);
	if (pairs.length === 0) return null;
	const violations = detectIdenticalBeforeAfterPairs(pairs, hasher);
	if (violations.length === 0) return null;

	const lines = [
		`SS 偽装検出 (#2059): ${violations.length} ペアの Before/After sha256 が完全一致しています。`,
		'',
		'検出された同一ペア:',
		...violations.map((v) => `  - ${v.before} == ${v.after}\n    sha256: ${v.sha}`),
		'',
		'考えられる原因:',
		'  1. Before SS を撮影せず、After SS のファイル名を変えて Before として貼った',
		'  2. main HEAD と PR HEAD の両方が同じ commit を指している (rebase 直後等)',
		'  3. 修正が DOM 差分を生まない (CSS / 画像差し替えのみで撮影箇所に変化なし)',
		'',
		'対応方法:',
		'  - Before SS は **別 worktree で main HEAD を強制 checkout** してから撮影してください:',
		'      git worktree add ../gq-main-head main',
		'      cd ../gq-main-head',
		'      MSYS_NO_PATHCONV=1 node scripts/capture.mjs --pr <N> --url <path>',
		"      # 撮影後 'before-' prefix にリネームして PR ブランチ側に戻す",
		'  - After SS は PR HEAD (作業中ブランチ) で撮影してください',
		'  - 変化のない箇所であれば SS 提示を取りやめ、refactor:internal-no-doc-impact label を付ける',
		'',
		'参考: docs/sessions/qa-session.md / scripts/check-ss-blob-sha-uniqueness.mjs (#2063 CI gate)',
	];

	return { violations, message: lines.join('\n') };
}

/**
 * `?screenshot=all` で demo 固有 UI を非表示化 + 本番一致演出 (MilestoneBanner 等) を強制表示する
 * URL パラメータ (#1893)。`?screenshot=1` (旧 noise-only モード) は後方互換のため維持。
 *
 * LP 配信 SS が本番 NUC ユーザの実画面と一致するよう、`all` を default とする。
 */
export const SCREENSHOT_QUERY = 'screenshot=all';

/**
 * `?screenshot=1` (noise-only、旧挙動) を表す定数。テスト・後方互換用途のみ使用すべき。
 * 通常は `SCREENSHOT_QUERY` (= `screenshot=all`) を使う。
 */
export const SCREENSHOT_QUERY_NOISE_ONLY = 'screenshot=1';

/**
 * パスに screenshot パラメータを追加する。
 * @param {string} urlPath - 例: `/demo/lower/home`
 * @param {object} [options]
 * @param {('all'|'noise-only')} [options.mode='all'] - screenshot mode (#1893)
 *   - 'all': 本番一致演出強制 ON (default)
 *   - 'noise-only': demo 固有 UI のみ非表示 (旧挙動、後方互換)
 */
export function withScreenshotParam(urlPath, options = {}) {
	const mode = options.mode ?? 'all';
	const queryValue = mode === 'noise-only' ? SCREENSHOT_QUERY_NOISE_ONLY : SCREENSHOT_QUERY;
	return `${urlPath}${urlPath.includes('?') ? '&' : '?'}${queryValue}`;
}

/**
 * PNG/任意画像ファイルを WebP に変換する。
 * @param {string} filePath - 入力画像パス
 * @param {object} [options]
 * @param {number} [options.quality=85]
 * @param {string} [options.outPath]
 * @returns {Promise<{ ok: true; outPath: string } | { ok: false; error: Error }>}
 */
export async function convertToWebP(filePath, options = {}) {
	const { quality = 85, outPath } = options;
	try {
		const sharp = (await import('sharp')).default;
		if (outPath) {
			await sharp(filePath).webp({ quality }).toFile(outPath);
			return { ok: true, outPath };
		}
		const webpBuf = await sharp(filePath).webp({ quality }).toBuffer();
		fs.writeFileSync(filePath, webpBuf);
		return { ok: true, outPath: filePath };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
	}
}

/**
 * ページ描画安定待ち (#1208 — `waitForTimeout` 置換の SSOT)
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {string} [options.selector]
 * @param {number} [options.networkIdleTimeout=5000]
 * @param {boolean} [options.skipNetworkIdle=false]
 * @param {boolean} [options.waitSplide=false]
 *   `true` の場合、Splide.js carousel (`#hero-carousel .splide__slide.is-active`) の
 *   初期化完了を最大 10s 待機する。LP 撮影で Splide が黒ブロックのまま記録される問題への対処 (#1825 SC-012)。
 */
export async function waitForStablePage(page, options = {}) {
	const {
		selector,
		networkIdleTimeout = 5000,
		skipNetworkIdle = false,
		waitSplide = false,
	} = options;
	if (!skipNetworkIdle) {
		await page.waitForLoadState('networkidle', { timeout: networkIdleTimeout }).catch(() => {});
	}
	if (selector) {
		await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
	}
	if (waitSplide) {
		// #1825: Splide.js mount 完了を `.is-active` slide の出現で検知する。
		// 初期化前は <ul class="splide__list"> しか存在せず slide が空のため、`.is-active` が出現した時点で
		// CSS 適用 + 1 枚目の slide が前面に来た状態になる。
		// Splide が存在しないページ (pricing.html / pamphlet.html 等) では即タイムアウトを許容するため
		// timeout を短めに設定し、catch して進める。
		await page
			.waitForFunction(
				() => document.querySelector('#hero-carousel .splide__slide.is-active') !== null,
				{ timeout: 10000 },
			)
			.catch(() => {
				// Splide が存在しない / CDN 未ロードの場合は無視して進める
			});
	}
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				const finish = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
				if (document.fonts?.ready) {
					document.fonts.ready.then(finish);
				} else {
					finish();
				}
			}),
	);
}

// ============================================================
// #3012: SS render 健全性検証 (500 / error ページ混入検出)
// ============================================================
//
// 設計背景: PR #3006 で /admin/rewards・/admin/checklists の 500 エラーページが
// 「実画面 SS」として screenshots branch に 2 度 push され、既存 CI gate
// (blob SHA 一意性 #2063 / ローカルパス禁止 #1741) を素通りした。
// 「SS が正常画面か (error ページでないか)」を検証する層がゼロだったため、
// 撮影 script 側で撮影直前に assert する (根本層)。CI 側の補完 gate は
// scripts/check-ss-render-health.mjs (.dom.html marker scan) が担う。
//
// マーカーの実体 (SSOT):
//   - アプリ error ページ: src/routes/+error.svelte
//       root: <div class="error-page" data-role=...> + <p class="error-status">{status}</p>
//       (Svelte scoping class が付くため `class="error-page ` 前方一致で検出)
//   - infra error ページ: infra/error-pages/{500,502,503,504}.html
//       <p class="code">Error 5xx</p> + <title>エラーが おきたよ - がんばりクエスト</title>

/** infra/error-pages/*.html の title / h1 に含まれる固有マーカー文言 */
export const INFRA_ERROR_TITLE_MARKER = 'エラーが おきたよ';

/**
 * render 健全性の純粋判定。Playwright page から抽出した facts を受け取り、
 * error ページ描画 / 5xx 応答なら unhealthy を返す。
 *
 * 判定ルール:
 *   1. HTTP status >= 500 → unhealthy (SSR が 500 を返した)
 *   2. アプリ error ページの DOM marker (.error-page .error-status に 3 桁 status) → unhealthy
 *      (404 / 403 含む — error ページを「実画面 SS」として撮ることは常に誤り)
 *   3. infra error ページの marker (<p class="code">Error 5xx</p> / title マーカー) → unhealthy
 *
 * @param {object} facts
 * @param {number | null} [facts.httpStatus] - page.goto() response の HTTP status
 * @param {string | null} [facts.appErrorStatus] - `.error-page .error-status` の textContent
 * @param {string | null} [facts.infraCode] - `p.code` の textContent
 * @param {string} [facts.title] - document.title
 * @returns {{ healthy: true; reason: '' } | { healthy: false; reason: string }}
 */
export function evaluateRenderHealth({
	httpStatus = null,
	appErrorStatus = null,
	infraCode = null,
	title = '',
} = {}) {
	if (typeof httpStatus === 'number' && httpStatus >= 500) {
		return { healthy: false, reason: `HTTP ${httpStatus} 応答 (サーバーエラー)` };
	}
	if (typeof appErrorStatus === 'string' && /^\d{3}$/.test(appErrorStatus.trim())) {
		return {
			healthy: false,
			reason: `アプリ error ページ描画 (status ${appErrorStatus.trim()}、src/routes/+error.svelte)`,
		};
	}
	if (typeof infraCode === 'string' && /^Error 5\d\d$/.test(infraCode.trim())) {
		return {
			healthy: false,
			reason: `infra error ページ描画 (${infraCode.trim()}、infra/error-pages/)`,
		};
	}
	if (typeof title === 'string' && title.includes(INFRA_ERROR_TITLE_MARKER)) {
		return {
			healthy: false,
			reason: `infra error ページ描画 (title "${INFRA_ERROR_TITLE_MARKER}")`,
		};
	}
	return { healthy: true, reason: '' };
}

/**
 * Playwright page から render 健全性 facts を抽出して判定する。
 *
 * SS 撮影直前に呼び、unhealthy なら撮影せずに fail させる用途。
 * テスト容易性のため page は `evaluate` のみを要求する duck-typed 受け取り
 * (captureDomSnapshot と同パターン)。
 *
 * @param {{ evaluate: (fn: () => unknown) => Promise<unknown> }} page
 * @param {{ httpStatus?: number | null }} [options]
 * @returns {Promise<{ healthy: boolean; reason: string }>}
 */
export async function checkRenderHealth(page, { httpStatus = null } = {}) {
	const facts =
		/** @type {{ appErrorStatus: string|null; infraCode: string|null; title: string }} */ (
			await page.evaluate(() => {
				const appErrorEl = document.querySelector('.error-page .error-status');
				const codeEl = document.querySelector('p.code');
				return {
					appErrorStatus: appErrorEl?.textContent?.trim() ?? null,
					infraCode: codeEl?.textContent?.trim() ?? null,
					title: document.title || '',
				};
			})
		);
	return evaluateRenderHealth({ httpStatus, ...facts });
}

/**
 * HTML 文字列 (.dom.html スナップショット等) から error ページ固有マーカーを検出する。
 *
 * CI 側補完 gate (scripts/check-ss-render-health.mjs) が screenshots branch に
 * push 済みの `.dom.html` を scan する用途。撮影時 assert (checkRenderHealth) と
 * 同じマーカー定義を共有する (SSOT)。
 *
 * 注: Svelte の scoping class (`class="error-page svelte-xxxx"`) を考慮し前方一致で照合。
 *
 * @param {string} html
 * @returns {string[]} 検出理由の配列 (空 = healthy)
 */
export function detectErrorMarkersInHtml(html) {
	const reasons = [];
	if (/class="error-page[\s"]/.test(html) && /class="error-status[\s"]/.test(html)) {
		const statusMatch = html.match(/class="error-status[^"]*"[^>]*>\s*(\d{3})/);
		reasons.push(
			`アプリ error ページ marker (.error-page + .error-status${statusMatch ? `, status ${statusMatch[1]}` : ''})`,
		);
	}
	if (/<p class="code">\s*Error 5\d\d\s*<\/p>/.test(html)) {
		reasons.push('infra error ページ marker (<p class="code">Error 5xx</p>)');
	}
	if (html.includes(INFRA_ERROR_TITLE_MARKER)) {
		reasons.push(`infra error ページ marker ("${INFRA_ERROR_TITLE_MARKER}")`);
	}
	return reasons;
}

// ============================================================
// #1424: 新規エクスポート — プリセット・純粋関数
// ============================================================

/**
 * 標準ビューポートプリセット（playwright.config.ts と統一）。
 */
export const PRESETS = {
	mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
	tablet: { width: 768, height: 1024, deviceScaleFactor: 2 },
	desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

/**
 * プリセット名からビューポート設定を解決する。
 * @param {string} name - 'mobile' | 'tablet' | 'desktop'
 * @returns {{ width: number; height: number; deviceScaleFactor: number }}
 */
export function resolvePreset(name) {
	const preset = PRESETS[/** @type {keyof typeof PRESETS} */ (name)];
	if (!preset) {
		throw new Error(`Unknown preset: "${name}". Valid options: ${Object.keys(PRESETS).join(', ')}`);
	}
	return preset;
}

/**
 * グリッド合成レイアウトを計算する（合成処理なし、純粋関数）。
 * @param {number} stepCount
 * @param {number} gridColumns
 * @param {number} cellWidth
 * @param {number} cellHeight
 * @returns {{ cols: number; rows: number; totalWidth: number; totalHeight: number }}
 */
export function buildGridLayout(stepCount, gridColumns, cellWidth, cellHeight) {
	const cols = Math.min(stepCount, gridColumns);
	const rows = Math.ceil(stepCount / gridColumns);
	return { cols, rows, totalWidth: cols * cellWidth, totalHeight: rows * cellHeight };
}

/**
 * 画像が全白または全黒の blank 画像でないかを sharp で検証する。
 * @param {string} pngPath - 検証対象の画像ファイルパス
 * @returns {Promise<{ blank: boolean; reason: string }>}
 */
export async function checkImageNotBlank(pngPath) {
	let sharp;
	try {
		sharp = (await import('sharp')).default;
	} catch {
		throw new Error('sharp が見つかりません。npm install を実行してください。');
	}
	const { data } = await sharp(pngPath)
		.resize({ width: 50, height: 50, fit: 'fill' })
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	let minVal = 255;
	let maxVal = 0;
	for (const v of data) {
		if (v < minVal) minVal = v;
		if (v > maxVal) maxVal = v;
	}

	if (maxVal <= 5) {
		return { blank: true, reason: `全黒画像 (最大輝度値: ${maxVal})` };
	}
	if (minVal >= 250) {
		return { blank: true, reason: `全白画像 (最小輝度値: ${minVal})` };
	}
	return { blank: false, reason: '' };
}

/**
 * フロー記録のステップ上限・警告を検証する（純粋関数）。
 * @param {number} stepIndex - 1-based step index
 * @param {number} maxSteps
 * @param {number} gridColumns
 * @param {number} cellWidth
 * @param {number} cellHeight
 * @returns {{ warn: boolean; layout: ReturnType<typeof buildGridLayout> | null }}
 * @throws {Error} ステップ上限を超過した場合
 */
export function checkStepLimit(stepIndex, maxSteps, gridColumns, cellWidth, cellHeight) {
	if (stepIndex > maxSteps) {
		throw new Error(
			`ステップ上限超過: ${stepIndex} > ${maxSteps}。--max-steps で上限を変更できます。`,
		);
	}
	const warnThreshold = Math.floor(maxSteps * 0.8);
	if (stepIndex > warnThreshold) {
		const layout = buildGridLayout(maxSteps, gridColumns, cellWidth, cellHeight);
		return { warn: true, layout };
	}
	return { warn: false, layout: null };
}

/**
 * フロースタンプシートの Markdown スニペットを生成する（純粋関数）。
 * @param {string} flowName
 * @param {Array<{ label: string }>} steps
 * @param {string} relativePath - composite WebP の相対パス
 * @returns {string}
 */
export function generateMarkdownSnippet(flowName, steps, relativePath) {
	const tableRows = steps.map((s, i) => `| ${i + 1} | ${s.label} |`).join('\n');
	return [
		`### ${flowName}フロー（${steps.length} ステップ）`,
		`![${flowName}-flow](./${relativePath})`,
		'',
		'| ステップ | 説明 |',
		'|---------|------|',
		tableRows,
		'',
	].join('\n');
}

// ============================================================
// #1766: DOM snapshot 機能 (#1747 AC4)
// ============================================================

/**
 * SS ファイルパスから対応する DOM HTML スナップショットファイルパスを導出する（純粋関数）。
 *
 * 例:
 *   resolveDomSnapshotPath('tmp/screenshots/pr-1770/admin-home.png')
 *     → 'tmp/screenshots/pr-1770/admin-home.dom.html'
 *   resolveDomSnapshotPath('docs/screenshots/pr-1770/lp-top-mobile.webp')
 *     → 'docs/screenshots/pr-1770/lp-top-mobile.dom.html'
 *
 * @param {string} screenshotPath - SS ファイルパス（拡張子は .png/.jpeg/.webp 等）
 * @returns {string} 同一ディレクトリ・同一 basename + `.dom.html` の DOM ファイルパス
 */
export function resolveDomSnapshotPath(screenshotPath) {
	const dir = path.dirname(screenshotPath);
	const ext = path.extname(screenshotPath);
	const base = path.basename(screenshotPath, ext);
	return path.join(dir, `${base}.dom.html`);
}

/**
 * Playwright page から DOM HTML スナップショットを保存する。
 *
 * `document.documentElement.outerHTML` を取得して指定パスに UTF-8 で書き込む。
 * SS と DOM が **同一プロセス・同一 page インスタンス** で取得されたことを構造的に保証する
 * (#1747 AC4 / #1766) ため、SS 撮影直後に同一 page を渡して呼ぶこと。
 *
 * @param {{ evaluate: (fn: () => string) => Promise<string> }} page -
 *   Playwright Page インスタンス（テスト容易性のため evaluate のみを要求する duck-typed 受け取り）
 * @param {string} domPath - 出力先ファイルパス（拡張子 `.dom.html` 推奨、`resolveDomSnapshotPath` 経由）
 * @returns {Promise<{ ok: true; filePath: string; size: number } | { ok: false; error: Error }>}
 */
export async function captureDomSnapshot(page, domPath) {
	try {
		const html = await page.evaluate(() => document.documentElement.outerHTML);
		if (typeof html !== 'string') {
			throw new Error(
				`document.documentElement.outerHTML が文字列でありません (typeof=${typeof html})`,
			);
		}
		fs.mkdirSync(path.dirname(domPath), { recursive: true });
		fs.writeFileSync(domPath, html, 'utf8');
		const stat = fs.statSync(domPath);
		return { ok: true, filePath: domPath, size: stat.size };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
	}
}

// ============================================================
// #1424: ScreenshotCapture クラス
// ============================================================

/**
 * 単一 URL のスクリーンショットを撮影するクラス。
 * setup() → capture() × N → teardown() のライフサイクルで使用する。
 */
export class ScreenshotCapture {
	/** @type {import('playwright').Browser | null} */
	#browser = null;
	#baseUrl;
	#outputDir;
	#locale;
	#defaultDeviceScaleFactor;

	/** @type {boolean} */
	#domSnapshotEnabled;

	constructor({
		baseUrl = 'http://localhost:5173',
		outputDir = 'tmp/screenshots',
		locale = 'ja-JP',
		deviceScaleFactor = 2,
		domSnapshot = true,
	} = {}) {
		this.#baseUrl = baseUrl;
		this.#outputDir = outputDir;
		this.#locale = locale;
		this.#defaultDeviceScaleFactor = deviceScaleFactor;
		this.#domSnapshotEnabled = domSnapshot;
	}

	async setup() {
		let chromium;
		try {
			({ chromium } = await import('playwright'));
		} catch {
			throw new Error('playwright が見つかりません。npm install を実行してください。');
		}
		this.#browser = await chromium.launch({ headless: true });
		fs.mkdirSync(this.#outputDir, { recursive: true });
	}

	/**
	 * @param {object} opts
	 * @param {string} opts.url - パス（BASE_URL が自動付与される）
	 * @param {string} opts.name - 出力ファイル名（拡張子なし）
	 * @param {{ width: number; height: number; deviceScaleFactor?: number }} [opts.viewport]
	 * @param {boolean} [opts.fullPage=false]
	 * @param {'png'|'webp'|'jpeg'} [opts.format='png']
	 * @param {number} [opts.quality=85] - WebP 品質 (0-100)
	 * @param {string} [opts.selector] - 表示まで待つ要素
	 * @param {string} [opts.section] - セクション要素単位の撮影 CSS セレクタ (#1827 fix2)。
	 *   指定すると `page.locator(section).screenshot()` でその要素のみ切り出す。
	 *   `fullPage` と排他（同時指定時は呼び出し側で弾く想定）。
	 * @param {import('playwright').BrowserContextOptions['storageState']} [opts.storageState] - 認証済みセッション
	 * @param {boolean} [opts.domSnapshot] - DOM HTML を <name>.dom.html として保存するか (#1747 AC4 / #1766)。
	 *   省略時はコンストラクタの `domSnapshot` 設定（デフォルト true）に従う
	 * @param {boolean} [opts.waitSplide=false] - Splide.js carousel 初期化完了を待機するか (#1825)。
	 *   LP の `site/index.html` 等の hero carousel 撮影で「黒ブロック」状態を回避する目的。
	 *   Splide が存在しないページでは silent skip するため副作用なし
	 * @param {Array<{ name: string; value: string; path?: string; httpOnly?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }>} [opts.cookies] -
	 *   撮影前に設定する cookie 一覧 (#2097 EPIC PR-B1)。本番ルート (`/(child)/[uiMode]/home` 等) を
	 *   demo モード (AUTH_MODE=anonymous + DATA_SOURCE=demo) で撮影する際、`selectedChildId` cookie を
	 *   pre-set して `/(child)/+layout.server.ts` の `/switch` redirect をバイパスする目的。
	 *   各 cookie の `path` 既定値は `/`、`httpOnly` は `false`、`sameSite` は `'Lax'`。
	 * @param {(page: import('playwright').Page) => Promise<void>} [opts.interact] -
	 *   ページ読込 + `waitForStablePage` 完了後・撮影直前に実行する任意の操作 hook (#2928)。
	 *   ❓ ガイドを開く等の user-gesture を必要とする "操作後の状態" を baseline 撮影するために使う。
	 *   この hook 内で `page.click()` / `page.addStyleTag()` / box 安定待ち等を行い、撮影したい
	 *   settled 状態を作る。例外は capture() の戻り値 `{ ok: false, error }` に集約される。
	 * @param {boolean} [opts.renderHealthCheck=false] - SS render 健全性検証 (#3012)。
	 *   true の場合、撮影直前に HTTP status >= 500 / error ページ DOM marker
	 *   (src/routes/+error.svelte / infra/error-pages) を検出し、検出時は撮影せず
	 *   `{ ok: false, error }` (error.code = 'ERR_RENDER_HEALTH') を返す。
	 *   PR #3006 で 500 エラーページが「実画面 SS」として push された事故の根本対策。
	 *   default false (capture-hp-screenshots.mjs 等の既存利用箇所の挙動を変えない)。
	 * @returns {Promise<{ ok: true; filePath: string; size: number; domPath?: string; domSize?: number } | { ok: false; error: Error }>}
	 */
	async capture({
		url,
		name,
		viewport,
		fullPage = false,
		format = 'png',
		quality = 85,
		selector,
		section,
		storageState,
		domSnapshot,
		waitSplide = false,
		cookies,
		interact,
		renderHealthCheck = false,
	}) {
		if (!this.#browser) throw new Error('setup() を先に呼び出してください。');

		const vp = viewport ?? PRESETS.desktop;
		const context = await this.#browser.newContext({
			viewport: { width: vp.width, height: vp.height },
			deviceScaleFactor: vp.deviceScaleFactor ?? this.#defaultDeviceScaleFactor,
			locale: this.#locale,
			...(storageState ? { storageState } : {}),
		});

		// #2097 EPIC PR-B1: 本番ルートを demo Lambda 想定で撮影する際に `selectedChildId` を pre-set する。
		// `baseUrl` の URL から host を抽出して cookie domain として設定する。
		if (cookies && cookies.length > 0) {
			const baseUrl = new URL(this.#baseUrl);
			await context.addCookies(
				cookies.map((c) => ({
					name: c.name,
					value: c.value,
					domain: baseUrl.hostname,
					path: c.path ?? '/',
					httpOnly: c.httpOnly ?? false,
					sameSite: c.sameSite ?? 'Lax',
				})),
			);
		}

		const page = await context.newPage();

		try {
			// Normalize: strip duplicate leading slashes (Windows Git Bash expands /foo to //foo)
			const normalizedPath = `/${url.replace(/^\/+/, '')}`;
			const targetUrl = `${this.#baseUrl}${normalizedPath}`;
			// #3012: render 健全性検証のため goto response (HTTP status) を保持する
			const response = await page
				.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
				.catch(() => {
					throw new Error(
						`サーバーに接続できません: ${targetUrl}\nnpm run dev または npm run dev:cognito でサーバーを起動してください。`,
					);
				});
			await waitForStablePage(page, { selector, skipNetworkIdle: true, waitSplide });

			// #2928: 撮影直前の任意操作 hook (❓ ガイドを開く等)。settled 状態の調整は hook 内で行う。
			if (interact) {
				await interact(page);
			}

			// #3012: SS render 健全性 assert — error ページを「実画面 SS」として撮影しない。
			// 撮影前に検証するため、違反時は SS ファイル自体が生成されない (screenshots branch
			// push 対象にもならない)。PR #3006 (500 ページ 2 度 push) の構造的再発防止。
			if (renderHealthCheck) {
				const health = await checkRenderHealth(page, {
					httpStatus: response ? response.status() : null,
				});
				if (!health.healthy) {
					const err = new Error(
						`SS render 健全性違反 (#3012): ${health.reason}\n` +
							`  URL: ${targetUrl}\n` +
							'  エラーページは「実画面 SS」として撮影できません。対象ページの 500/404 を修正してください。\n' +
							'  エラーページ自体のデザイン SS が必要な場合のみ capture.mjs の --allow-error-page を使ってください。',
					);
					/** @type {Error & { code?: string }} */ (err).code = 'ERR_RENDER_HEALTH';
					throw err;
				}
			}

			const screenshotType = format === 'jpeg' ? 'jpeg' : 'png';
			const ext = format === 'webp' ? 'png' : screenshotType;
			const tmpPath = path.join(this.#outputDir, `${name}.${ext}`);

			// #1827 fix2: section が指定された場合は要素単位の撮影を行う。
			// PR #1827 Re-Review (a8d053d) で全 desktop SS が hero (fullpage 冒頭) を
			// 撮ってしまい MD5 衝突 + ファイル名/内容の不一致を発生させた事故への構造的対応。
			if (section) {
				const locator = page.locator(section).first();
				// セクションが mount されていない / 表示されていない場合は早期に fail
				await locator.waitFor({ state: 'visible', timeout: 10000 });
				// scrollIntoView してから撮影（lazy 画像の load 待機含む）
				await locator.scrollIntoViewIfNeeded();
				// 画像 lazy-load を待つため短い idle 待機
				await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
				await locator.screenshot({ path: tmpPath, type: screenshotType });
			} else {
				await page.screenshot({ path: tmpPath, fullPage, type: screenshotType });
			}

			// #1766: SS と同一プロセス・同一 page で DOM HTML を取得して保存する。
			// PR #1717 で SS と実機 DOM が乖離していた事故の構造的再発防止。
			const domEnabled = domSnapshot ?? this.#domSnapshotEnabled;
			const domInfo = domEnabled
				? await this.#tryCaptureDom(page, name, format, tmpPath)
				: { domPath: undefined, domSize: undefined };

			let filePath = tmpPath;
			if (format === 'webp') {
				filePath = path.join(this.#outputDir, `${name}.webp`);
				const result = await convertToWebP(tmpPath, { quality, outPath: filePath });
				if (!result.ok) throw result.error;
				fs.rmSync(tmpPath, { force: true });
			}

			const stat = fs.statSync(filePath);
			return {
				ok: true,
				filePath,
				size: stat.size,
				...(domInfo.domPath !== undefined
					? { domPath: domInfo.domPath, domSize: domInfo.domSize }
					: {}),
			};
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
		} finally {
			await context.close();
		}
	}

	/**
	 * #1766: 撮影直後の page から DOM HTML を取得する内部ヘルパ。
	 * SS と同じ basename + `.dom.html` を SS と同じディレクトリに書き出す。
	 * 失敗しても SS 撮影自体は成功扱いとし、警告ログのみ。
	 *
	 * @param {import('playwright').Page} page
	 * @param {string} name
	 * @param {'png'|'webp'|'jpeg'} format
	 * @param {string} tmpPath - 撮影 PNG の一時パス（webp の場合は最終 webp パスから DOM パスを導出）
	 * @returns {Promise<{ domPath: string | undefined; domSize: number | undefined }>}
	 */
	async #tryCaptureDom(page, name, format, tmpPath) {
		const finalScreenshotPathForDom =
			format === 'webp' ? path.join(this.#outputDir, `${name}.webp`) : tmpPath;
		const targetDomPath = resolveDomSnapshotPath(finalScreenshotPathForDom);
		const domResult = await captureDomSnapshot(page, targetDomPath);
		if (!domResult.ok) {
			console.warn(
				`[capture] DOM snapshot 保存に失敗しました (${name}): ${domResult.error.message}`,
			);
			return { domPath: undefined, domSize: undefined };
		}
		return { domPath: domResult.filePath, domSize: domResult.size };
	}

	async teardown() {
		await this.#browser?.close();
		this.#browser = null;
	}
}

// ============================================================
// #1424: FlowRecorder クラス
// ============================================================

/**
 * 操作ステップを連番 PNG でキャプチャし、グリッド合成 WebP + Markdown を生成するクラス。
 */
export class FlowRecorder {
	#baseUrl;
	#outputDir;
	#maxSteps;
	#gridColumns;
	#cellWidth;
	#cellHeight;

	constructor({
		baseUrl = 'http://localhost:5173',
		outputDir = 'tmp/screenshots',
		maxSteps = 12,
		gridColumns = 2,
		cellWidth = 400,
		cellHeight = 300,
	} = {}) {
		this.#baseUrl = baseUrl;
		this.#outputDir = outputDir;
		this.#maxSteps = maxSteps;
		this.#gridColumns = gridColumns;
		this.#cellWidth = cellWidth;
		this.#cellHeight = cellHeight;
	}

	/**
	 * @param {object} opts
	 * @param {string} opts.url - 初期 URL パス
	 * @param {string} opts.flowName - フロー名（出力ファイル名に使用）
	 * @param {(page: import('playwright').Page, capture: (label: string) => Promise<string>) => Promise<void>} opts.actions
	 * @param {'mobile'|'tablet'|'desktop'} [opts.preset='desktop']
	 * @param {import('playwright').BrowserContextOptions['storageState']} [opts.storageState]
	 * @returns {Promise<{ stepsDir: string; compositePath: string|null; markdownSnippet: string; stepCount: number }>}
	 */
	async record({ url, flowName, actions, preset = 'desktop', storageState }) {
		const vp = resolvePreset(preset);
		const stepsDir = path.join(this.#outputDir, `${flowName}-steps`);
		fs.mkdirSync(stepsDir, { recursive: true });
		fs.mkdirSync(this.#outputDir, { recursive: true });

		let chromium;
		try {
			({ chromium } = await import('playwright'));
		} catch {
			throw new Error('playwright が見つかりません。npm install を実行してください。');
		}

		const browser = await chromium.launch({ headless: true });
		const context = await browser.newContext({
			viewport: { width: vp.width, height: vp.height },
			deviceScaleFactor: vp.deviceScaleFactor,
			locale: 'ja-JP',
			...(storageState ? { storageState } : {}),
		});
		const page = await context.newPage();

		const normalizedFlowPath = `/${url.replace(/^\/+/, '')}`;
		const targetUrl = `${this.#baseUrl}${normalizedFlowPath}`;
		try {
			await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
		} catch {
			await context.close();
			await browser.close();
			throw new Error(
				`サーバーに接続できません: ${targetUrl}\nnpm run dev または npm run dev:cognito でサーバーを起動してください。`,
			);
		}
		await waitForStablePage(page, { skipNetworkIdle: true });

		/** @type {Array<{ label: string; pngPath: string; stepName: string }>} */
		const steps = [];
		let stepIndex = 0;
		const maxSteps = this.#maxSteps;
		const gridColumns = this.#gridColumns;
		const cellWidth = this.#cellWidth;
		const cellHeight = this.#cellHeight;

		/** @param {string} label */
		const captureStep = async (label) => {
			stepIndex++;
			const limitCheck = checkStepLimit(stepIndex, maxSteps, gridColumns, cellWidth, cellHeight);
			if (limitCheck.warn && limitCheck.layout) {
				console.warn(
					`[WARN] ステップ ${stepIndex}/${maxSteps} (80%超)。合成後推定サイズ: ${limitCheck.layout.totalWidth}×${limitCheck.layout.totalHeight}px`,
				);
			}

			const paddedIndex = String(stepIndex).padStart(2, '0');
			const safeName = label.replace(/[^\w　-鿿゠-ヿ]/g, '-').replace(/-+/g, '-');
			const stepName = `${paddedIndex}-${safeName}`;
			const pngPath = path.join(stepsDir, `${stepName}.png`);
			await page.screenshot({ path: pngPath, fullPage: false });

			const stat = fs.statSync(pngPath);
			if (stat.size === 0) {
				throw new Error(`ステップ ${stepIndex} の PNG が空ファイルです: ${pngPath}`);
			}

			// 全白・全黒画像チェック
			const blankCheck = await checkImageNotBlank(pngPath).catch((e) => {
				console.warn(
					`[WARN] 画像品質チェックをスキップしました: ${/** @type {Error} */ (e).message}`,
				);
				return null;
			});
			if (blankCheck?.blank) {
				throw new Error(`ステップ ${stepIndex} の PNG が ${blankCheck.reason} です: ${pngPath}`);
			}

			steps.push({ label, pngPath, stepName });
			return pngPath;
		};

		/** @type {Error | null} */
		let actionsError = null;
		try {
			await actions(page, captureStep);
		} catch (err) {
			actionsError = err instanceof Error ? err : new Error(String(err));
			if (steps.length > 0) {
				console.error(
					`[WARN] アクション中にエラーが発生しました (${steps.length} ステップまで保存済み): ${actionsError.message}`,
				);
			}
		} finally {
			await context.close();
			await browser.close();
		}

		if (steps.length === 0) {
			if (actionsError) throw actionsError;
			return { stepsDir, compositePath: null, markdownSnippet: '', stepCount: 0 };
		}

		const compositePath = path.join(this.#outputDir, `${flowName}-flow.webp`);
		await this.#compositeSteps(steps, compositePath);

		const markdownPath = path.join(this.#outputDir, `${flowName}-flow.md`);
		const relativePath = path.relative(process.cwd(), compositePath).replace(/\\/g, '/');
		const markdownSnippet = generateMarkdownSnippet(flowName, steps, relativePath);
		fs.writeFileSync(markdownPath, markdownSnippet);

		this.#printReport(steps, compositePath);

		if (actionsError) throw actionsError;
		return { stepsDir, compositePath, markdownSnippet, stepCount: steps.length };
	}

	/**
	 * @param {Array<{ label: string; pngPath: string; stepName: string }>} steps
	 * @param {string} outputPath
	 */
	async #compositeSteps(steps, outputPath) {
		let sharp;
		try {
			sharp = (await import('sharp')).default;
		} catch {
			throw new Error('sharp が見つかりません。npm install を実行してください。');
		}

		const layout = buildGridLayout(
			steps.length,
			this.#gridColumns,
			this.#cellWidth,
			this.#cellHeight,
		);

		const compositeOps = await Promise.all(
			steps.map(async (step, i) => {
				const col = i % this.#gridColumns;
				const row = Math.floor(i / this.#gridColumns);
				const resized = await sharp(step.pngPath)
					.resize(this.#cellWidth, this.#cellHeight, {
						fit: 'contain',
						background: { r: 248, g: 248, b: 248, alpha: 1 },
					})
					.toBuffer();
				return { input: resized, left: col * this.#cellWidth, top: row * this.#cellHeight };
			}),
		);

		await sharp({
			create: {
				width: layout.totalWidth,
				height: layout.totalHeight,
				channels: 4,
				background: { r: 248, g: 248, b: 248, alpha: 1 },
			},
		})
			.composite(compositeOps)
			.webp({ quality: 85 })
			.toFile(outputPath);
	}

	/**
	 * @param {Array<{ label: string; pngPath: string; stepName: string }>} steps
	 * @param {string} compositePath
	 */
	#printReport(steps, compositePath) {
		const layout = buildGridLayout(
			steps.length,
			this.#gridColumns,
			this.#cellWidth,
			this.#cellHeight,
		);
		const compositeSize = fs.statSync(compositePath).size;

		console.log('\n=== フロースタンプシート生成レポート ===');
		console.log(`ステップ数: ${steps.length}`);
		for (const [i, s] of steps.entries()) {
			const size = fs.statSync(s.pngPath).size;
			console.log(`  ${i + 1}. ${s.label}: ${(size / 1024).toFixed(0)} KB`);
		}
		console.log(`合成後: ${compositePath}`);
		console.log(`  サイズ: ${(compositeSize / 1024).toFixed(0)} KB`);
		console.log(`  解像度: ${layout.totalWidth}×${layout.totalHeight}px`);

		if (compositeSize > 5 * 1024 * 1024) {
			console.warn('[WARN] 合成 WebP が 5MB 超。GitHub PR の表示が重くなる可能性があります。');
		}
		if (layout.totalHeight > 4000) {
			console.warn('[WARN] 縦が 4000px 超。Claude Code の視認性が低下する可能性があります。');
		}
	}
}
