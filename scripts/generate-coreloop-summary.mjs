#!/usr/bin/env node

/**
 * scripts/generate-coreloop-summary.mjs (#1787)
 *
 * LP [03] core-loop セクションの 1-shot summary 画像（活動 → 習慣 → ごほうびの循環図）を
 * Gemini API で生成する。出力先は `static/assets/lp/core-loop-summary.png` 固定。
 *
 * 設計方針:
 *   - 汎用 `scripts/generate-image.mjs` の薄い wrapper として実装し、独自プロンプトロジックを最小化
 *   - ブランドスタイル統一（A-1 BRAND STYLE BLOCK 経由、`character` カテゴリ）
 *   - 参照画像 `static/assets/brand/master-character-sheet.png` を提供
 *   - LP 3 layer (活動 / 習慣 / ごほうび) の循環表現に特化したプロンプト
 *   - 出力先 (PNG) は固定。`site/assets/lp/` への配備はビルド時 (CI / GitHub Pages) で同期
 *
 * 使用法:
 *   npm run generate:coreloop-summary
 *   npm run generate:coreloop-summary -- --dry-run     # プロンプト確認のみ
 *
 * 詳細:
 *   - docs/reference/gemini_image_generation_guide.md A-1 / A-3 character category
 *   - docs/design/asset-catalog.md LP スクショ § (core-loop-summary は同 § に追記)
 *
 * scripts/ 配下追加ルール (#1442) 整合:
 *   - `package.json` の `scripts.generate:coreloop-summary` に登録済み
 *   - 「Issue 番号付き使い捨て」ではなく、core-loop summary の再生成（プロンプト調整・モデル更新時）に
 *     継続的に使用する手動ツールとして位置付ける（A: package.json scripts に登録された npm run コマンド）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// 1-shot summary 画像のプロンプト (#1787 設計指針 / #1845 テキストなし強化)
//   - D3 warrior キャラクターを中心配置
//   - 3 アイコン（活動 / 習慣 / ごほうび）を円環で結ぶ循環図
//   - kawaii chibi flat illustration（A-1 ブランドスタイル）
//   - テキスト一切なし（HTML 側で alt + figcaption が SSOT、ブランド A-1 整合）
//   - 透過背景 PNG（DESIGN.md §11-7 / asset-catalog.md チェックリスト整合）
//   - 横長 16:9 構図（LP 640x320 想定の 2:1 に近い、character category デフォルト 1:1 から override）
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

// 出力先: 開発側は static/assets/lp/、デプロイ側は site/assets/lp/ (CI / Pages 配備時にコピー)
const OUTPUT_PATH = 'static/assets/lp/core-loop-summary.png';

// #1845: GEMINI_API_KEY 早期検出 — wrapper 段階で鍵未配備を検出し、fallback コマンドを案内する
//   (内部で呼ぶ generate-image.mjs も同様の検出を行うが、wrapper 段階で
//    coreloop summary 固有の fallback パス案内を表示することで開発者の判断を早める)
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

if (!isDryRun && !process.env.GEMINI_API_KEY) {
	console.error('エラー: GEMINI_API_KEY が設定されていません。');
	console.error('');
	console.error('  Gemini API での再生成には以下の手順で .env.local に鍵を配備してください:');
	console.error('    1. https://aistudio.google.com/apikey で API key を取得');
	console.error('    2. リポジトリルートの .env.local に  GEMINI_API_KEY=<key>  を記載');
	console.error('    3. npm run generate:coreloop-summary を再実行');
	console.error('');
	console.error(
		'  鍵が配備できない場合のフォールバック (#1845 完遂後は archive SVG → PNG 決定的変換):',
	);
	console.error(
		"    node -e \"require('sharp')('static/assets/lp/_archive/core-loop-summary.svg.bak')\\",
	);
	console.error("      .resize(1280,640).png().toFile('static/assets/lp/core-loop-summary.png')\"");
	console.error(
		'    cp static/assets/lp/core-loop-summary.png site/assets/lp/core-loop-summary.png',
	);
	console.error('');
	console.error(
		'  詳細: docs/design/asset-catalog.md「LP コアループ 1-shot summary 画像 (#1787)」セクション',
	);
	process.exit(2);
}

const childArgs = [
	path.join(REPO_ROOT, 'scripts/generate-image.mjs'),
	'--prompt',
	PROMPT,
	'--category',
	'character',
	'--output',
	OUTPUT_PATH,
	'--model',
	'pro',
	'--aspect-ratio',
	'2:1',
];

if (isDryRun) {
	childArgs.push('--dry-run');
}

console.log('LP [03] core-loop summary 画像生成 (#1787)');
console.log(`  出力先: ${OUTPUT_PATH}`);
console.log(`  モデル: gemini-2.5-pro`);
console.log(`  アスペクト比: 2:1 (640x320 想定)`);
console.log('');

const result = spawnSync(process.execPath, childArgs, {
	cwd: REPO_ROOT,
	stdio: 'inherit',
	env: process.env,
});

if (result.status === 0 && !isDryRun) {
	// site/assets/lp/ にも配備（GitHub Pages から `assets/lp/core-loop-summary.png` で配信される）
	const srcAbs = path.resolve(REPO_ROOT, OUTPUT_PATH);
	const siteAssetsDir = path.resolve(REPO_ROOT, 'site/assets/lp');
	if (!fs.existsSync(siteAssetsDir)) fs.mkdirSync(siteAssetsDir, { recursive: true });
	const destAbs = path.join(siteAssetsDir, 'core-loop-summary.png');
	fs.copyFileSync(srcAbs, destAbs);
	console.log(`✓ site/assets/lp/core-loop-summary.png にも配備しました（GitHub Pages 配信用）`);
}

process.exit(result.status ?? 1);
