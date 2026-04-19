/**
 * scripts/lib/screenshot-helpers.mjs (#1206)
 *
 * `take-lp-screenshots.mjs` / `capture-hp-screenshots.mjs` 共通ユーティリティの SSOT。
 * 両スクリプトで重複していた定数・helper を統一し、#1180 (`?mode=demo` 移行) 時の
 * 片側更新忘れを防ぐ。
 *
 * 注意: VIEWPORTS の寸法は意図的に統一していない（take-lp は desktop=1280x800、
 * capture-hp は desktop=1440x900）。既存 SS 出力との互換性のため、各スクリプトで
 * それぞれ定義すること。共通化するのは「クエリ文字列」「WebP 変換」のみ。
 */

import fs from 'node:fs';

/**
 * `?screenshot=1` で demo 固有 UI（バナー・プラン切替・ガイドバー・フローティング CTA）
 * を非表示化する URL パラメータ。根本解決（demo/app 統合）は #1180 で別途。
 */
export const SCREENSHOT_QUERY = 'screenshot=1';

/**
 * パスに screenshot パラメータを追加する。既存クエリが無ければ `?`、あれば `&` を付ける。
 * @param {string} path - 例: `/demo/lower/home` または `/demo/checklist?childId=904`
 * @returns {string}
 */
export function withScreenshotParam(path) {
	return `${path}${path.includes('?') ? '&' : '?'}${SCREENSHOT_QUERY}`;
}

/**
 * PNG/任意画像ファイルを WebP に変換する。既存ファイルを上書きするか、別ファイルに書くかは
 * `outPath` の有無で切り替える。
 *
 * - `outPath` 省略: 入力ファイルを WebP バイナリで上書き（take-lp 互換）
 * - `outPath` 指定: `<outPath>.webp` として出力（capture-hp 互換）
 *
 * @param {string} filePath - 入力画像パス
 * @param {object} [options]
 * @param {number} [options.quality=85] - WebP 品質 (0-100)
 * @param {string} [options.outPath] - 出力パス（省略時は `filePath` を上書き）
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
