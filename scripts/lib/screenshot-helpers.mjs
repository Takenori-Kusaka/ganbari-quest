/**
 * scripts/lib/screenshot-helpers.mjs (#1206, #1424)
 *
 * `take-lp-screenshots.mjs` / `capture-hp-screenshots.mjs` 共通ユーティリティの SSOT。
 * #1424 で ScreenshotCapture / FlowRecorder クラスと純粋関数を追加。
 */

import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 既存エクスポート（維持）
// ============================================================

/**
 * `?screenshot=1` で demo 固有 UI を非表示化する URL パラメータ。
 */
export const SCREENSHOT_QUERY = 'screenshot=1';

/**
 * パスに screenshot パラメータを追加する。
 * @param {string} urlPath - 例: `/demo/lower/home`
 */
export function withScreenshotParam(urlPath) {
	return `${urlPath}${urlPath.includes('?') ? '&' : '?'}${SCREENSHOT_QUERY}`;
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
 */
export async function waitForStablePage(page, options = {}) {
	const { selector, networkIdleTimeout = 5000, skipNetworkIdle = false } = options;
	if (!skipNetworkIdle) {
		await page.waitForLoadState('networkidle', { timeout: networkIdleTimeout }).catch(() => {});
	}
	if (selector) {
		await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
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

	constructor({
		baseUrl = 'http://localhost:5173',
		outputDir = 'tmp/screenshots',
		locale = 'ja-JP',
		deviceScaleFactor = 2,
	} = {}) {
		this.#baseUrl = baseUrl;
		this.#outputDir = outputDir;
		this.#locale = locale;
		this.#defaultDeviceScaleFactor = deviceScaleFactor;
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
	 * @param {import('playwright').BrowserContextOptions['storageState']} [opts.storageState] - 認証済みセッション
	 * @returns {Promise<{ ok: true; filePath: string; size: number } | { ok: false; error: Error }>}
	 */
	async capture({
		url,
		name,
		viewport,
		fullPage = false,
		format = 'png',
		quality = 85,
		selector,
		storageState,
	}) {
		if (!this.#browser) throw new Error('setup() を先に呼び出してください。');

		const vp = viewport ?? PRESETS.desktop;
		const context = await this.#browser.newContext({
			viewport: { width: vp.width, height: vp.height },
			deviceScaleFactor: vp.deviceScaleFactor ?? this.#defaultDeviceScaleFactor,
			locale: this.#locale,
			...(storageState ? { storageState } : {}),
		});
		const page = await context.newPage();

		try {
			const targetUrl = `${this.#baseUrl}${url}`;
			await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
				throw new Error(
					`サーバーに接続できません: ${targetUrl}\nnpm run dev または npm run dev:cognito でサーバーを起動してください。`,
				);
			});
			await waitForStablePage(page, { selector, skipNetworkIdle: true });

			const screenshotType = format === 'jpeg' ? 'jpeg' : 'png';
			const ext = format === 'webp' ? 'png' : screenshotType;
			const tmpPath = path.join(this.#outputDir, `${name}.${ext}`);
			await page.screenshot({ path: tmpPath, fullPage, type: screenshotType });

			let filePath = tmpPath;
			if (format === 'webp') {
				filePath = path.join(this.#outputDir, `${name}.webp`);
				const result = await convertToWebP(tmpPath, { quality, outPath: filePath });
				if (!result.ok) throw result.error;
				fs.rmSync(tmpPath, { force: true });
			}

			const stat = fs.statSync(filePath);
			return { ok: true, filePath, size: stat.size };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
		} finally {
			await context.close();
		}
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

		const targetUrl = `${this.#baseUrl}${url}`;
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
			if (stepIndex > maxSteps) {
				throw new Error(
					`ステップ上限超過: ${stepIndex} > ${maxSteps}。--max-steps で上限を変更できます。`,
				);
			}
			const warnThreshold = Math.floor(maxSteps * 0.8);
			if (stepIndex > warnThreshold) {
				const layout = buildGridLayout(maxSteps, gridColumns, cellWidth, cellHeight);
				console.warn(
					`[WARN] ステップ ${stepIndex}/${maxSteps} (80%超)。合成後推定サイズ: ${layout.totalWidth}×${layout.totalHeight}px`,
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
