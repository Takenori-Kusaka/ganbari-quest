#!/usr/bin/env node

/**
 * scripts/generate-coreloop-summary.mjs (#1787 / #1889)
 *
 * LP [03] core-loop セクションの 1-shot summary 画像（活動 → 習慣 → ごほうびの循環図）を
 * 生成する。出力先は `static/assets/lp/core-loop-summary.png` 固定 + `site/assets/lp/` に配備。
 *
 * #1889 で正本を SVG (`static/assets/lp/core-loop-summary.svg`) に変更:
 *   - **デフォルト**: SVG → sharp で透過 PNG (1280x640) に変換 (決定的、Gemini 鍵不要、透過保証)
 *   - **--regenerate**: Gemini API で SVG 自体を再生成 (鍵必要、本格生成画像のリフレッシュ用)
 *
 * 設計方針 (#1889):
 *   - SVG は git tracked で再現性 100%、ベクター + 透過がネイティブ保証
 *   - sharp の SVG → PNG 変換は既存依存ゼロ追加 (ADR-0010 §7 軽量 OSS 優先)
 *   - 出力 PNG が透過 (hasAlpha === true) であることを assert
 *   - LP 側 (`site/index.html`) `.core-loop-summary img{...}` から `background:#fff` も撤去済
 *
 * 使用法:
 *   npm run generate:coreloop-summary               # SVG → sharp PNG (デフォルト、推奨)
 *   npm run generate:coreloop-summary -- --regenerate  # Gemini API で再生成 (鍵必要)
 *   npm run generate:coreloop-summary -- --dry-run     # プロンプト確認のみ (--regenerate 時)
 *
 * 詳細:
 *   - docs/reference/gemini_image_generation_guide.md A-1 / A-3 character category
 *   - docs/design/asset-catalog.md LP コアループ 1-shot summary 画像 §
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// 1-shot summary 画像のプロンプト (Gemini 再生成時のみ使用、#1787 設計指針 / #1845 テキストなし強化)
const PROMPT = [
	'A 1-shot summary illustration showing the core loop of a children gamification family RPG app.',
	'D3 warrior character at the visual center (blue helmet + cape + gold magic wand + star emblem on chest).',
	'Three iconic objects orbiting around the warrior in a circular flow connected by curved arrows:',
	'  (1) a small notepad icon with a checkmark (representing recording daily activity),',
	'  (2) a small stamp card icon with stars (representing forming a habit),',
	'  (3) a small gift box icon with a ribbon (representing reward exchange).',
	'The three icons should be visually distinct, each in its own pastel circle, equally spaced 120 degrees apart.',
	'Curved arrows between icons indicate the cycle: notepad → stamp card → gift box → notepad.',
	'CRITICAL: Absolutely NO text, NO letters, NO Japanese characters, NO English words, NO labels anywhere in the image.',
	'CRITICAL: The image must be entirely text-free. Caption text is rendered by surrounding HTML alt / figcaption.',
	'Transparent background (no color background fill, alpha channel preserved).',
	'Wide landscape composition with 2:1 aspect ratio (1280x640 pixels), warrior centered, icons orbiting in horizontal ellipse.',
].join(' ');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isRegenerate = args.includes('--regenerate');

// 出力先: 開発側は static/assets/lp/、デプロイ側は site/assets/lp/ (CI / Pages 配備時にコピー)
const SVG_PATH = path.resolve(REPO_ROOT, 'static/assets/lp/core-loop-summary.svg');
const PNG_PATH = path.resolve(REPO_ROOT, 'static/assets/lp/core-loop-summary.png');
const SITE_PNG_PATH = path.resolve(REPO_ROOT, 'site/assets/lp/core-loop-summary.png');

// #1845: GEMINI_API_KEY 早期検出 (--regenerate 時のみ必須)
function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return;
	const content = fs.readFileSync(filePath, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
		if (!process.env[key]) process.env[key] = value;
	}
}
loadEnvFile(path.resolve(REPO_ROOT, '.env.local'));
loadEnvFile(path.resolve(REPO_ROOT, '.env'));

/**
 * デフォルトルート: SVG → sharp で透過 PNG 変換
 *
 * 透過保証ロジック:
 *   - SVG 自体が背景 rect なし (#1889 で削除済)
 *   - sharp.png() はデフォルトで alpha channel を保持
 *   - 出力後 metadata().hasAlpha === true を assert (#1889 AC1)
 */
async function generateFromSvg() {
	if (!fs.existsSync(SVG_PATH)) {
		console.error(`エラー: SVG 正本が見つかりません: ${SVG_PATH}`);
		console.error('  #1889 で archive SVG を正本化したはずです。git status で確認してください。');
		process.exit(2);
	}
	console.log('LP [03] core-loop summary 画像生成 (#1889 SVG → sharp PNG ルート)');
	console.log(`  入力: ${path.relative(REPO_ROOT, SVG_PATH)}`);
	console.log(`  出力: ${path.relative(REPO_ROOT, PNG_PATH)}`);
	console.log(`  サイズ: 1280x640 (透過 PNG)`);
	console.log('');

	const svgBuf = fs.readFileSync(SVG_PATH);
	const pngBuf = await sharp(svgBuf, { density: 300 }).resize(1280, 640).png().toBuffer();
	fs.writeFileSync(PNG_PATH, pngBuf);

	// site/assets/lp/ にも配備
	const siteDir = path.dirname(SITE_PNG_PATH);
	if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
	fs.copyFileSync(PNG_PATH, SITE_PNG_PATH);

	// 透過 PNG であることを assert (#1889 AC1)
	const meta = await sharp(PNG_PATH).metadata();
	console.log(`  format: ${meta.format} | hasAlpha: ${meta.hasAlpha} | size: ${meta.width}x${meta.height}`);
	if (meta.format !== 'png' || meta.hasAlpha !== true) {
		console.error('エラー: 出力が透過 PNG になっていません (AC1 違反)');
		process.exit(1);
	}
	console.log(`✓ 透過 PNG を生成しました (hasAlpha === true)`);
	console.log(`✓ site/assets/lp/core-loop-summary.png にも配備しました（GitHub Pages 配信用）`);
}

/**
 * --regenerate ルート: Gemini API で本格生成画像をリフレッシュ
 *   注: 出力は character category により JPEG bytes になる可能性が高い (Gemini API 仕様)
 *   この場合は SVG (正本) を手動更新する運用にする (透過保証は SVG ルートに統一)
 */
function regenerateWithGemini() {
	if (!isDryRun && !process.env.GEMINI_API_KEY) {
		console.error('エラー: --regenerate には GEMINI_API_KEY が必要です。');
		console.error('  デフォルト (SVG → sharp PNG) ルートを使う場合は --regenerate を外してください。');
		process.exit(2);
	}

	const childArgs = [
		path.join(REPO_ROOT, 'scripts/generate-image.mjs'),
		'--prompt',
		PROMPT,
		'--category',
		'character',
		'--output',
		path.relative(REPO_ROOT, PNG_PATH),
		'--model',
		'pro',
		'--aspect-ratio',
		'2:1',
	];
	if (isDryRun) childArgs.push('--dry-run');

	console.log('LP [03] core-loop summary 画像生成 (#1845 Gemini --regenerate ルート)');
	console.log(`  出力先: ${path.relative(REPO_ROOT, PNG_PATH)}`);
	console.log(`  モデル: gemini-3-pro-image-preview`);
	console.log(`  注意: Gemini 出力は JPEG bytes の可能性あり。透過保証は SVG ルート (デフォルト) を使用してください。`);
	console.log('');

	const result = spawnSync(process.execPath, childArgs, {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		env: process.env,
	});

	if (result.status === 0 && !isDryRun) {
		const siteDir = path.dirname(SITE_PNG_PATH);
		if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
		fs.copyFileSync(PNG_PATH, SITE_PNG_PATH);
		console.log(`✓ site/assets/lp/core-loop-summary.png にも配備しました（GitHub Pages 配信用）`);
	}
	process.exit(result.status ?? 1);
}

if (isRegenerate) {
	regenerateWithGemini();
} else {
	generateFromSvg().catch((err) => {
		console.error('エラー:', err);
		process.exit(1);
	});
}
