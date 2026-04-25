#!/usr/bin/env node
/**
 * scripts/generate-image.mjs (#1483)
 *
 * 汎用 Gemini 画像生成 CLI — ブランドスタイル統一
 * 詳細: docs/reference/gemini_image_generation_guide.md
 *
 * 使用法:
 *   npm run generate:image -- --prompt "ハートのスタンプ" --category stamp --rarity N \
 *     --output static/assets/stamps/n-heart.png
 *
 * オプション:
 *   --prompt       必須  生成対象の説明（日本語可）
 *   --category     general / stamp / badge / title / character / background / marketing
 *   --rarity       N / R / SR / UR（stamp/badge/title カテゴリで有効）
 *   --output       出力パス（.webp/.png/.jpg 自動変換、デフォルト: tmp/generated.png）
 *   --reference    参照画像パス（デフォルト: static/assets/brand/master-character-sheet.png）
 *   --model        flash（デフォルト）/ pro
 *   --aspect-ratio アスペクト比（カテゴリから自動推定、手動指定で上書き可）
 *   --dry-run      プロンプトのみ表示（API 未呼び出し）
 *   --help         オプション一覧表示
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import {
	CATEGORY_CONFIG,
	DEFAULT_REFERENCE_IMAGE,
	FALLBACK_REFERENCE_IMAGE,
	MODEL_IDS,
	RARITY_KEYWORDS,
} from './lib/brand-style-guide.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── 引数パース ──────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(`
使用法:
  npm run generate:image -- [オプション]

必須:
  --prompt <text>          生成対象の説明（日本語可）

オプション:
  --category <cat>         生成カテゴリ（デフォルト: general）
                           選択肢: general / stamp / badge / title / character / background / marketing
  --rarity <rarity>        レアリティ（デフォルト: N）
                           選択肢: N / R / SR / UR（stamp/badge/title で有効）
  --output <path>          出力パス（デフォルト: tmp/generated.png）
                           .webp 指定時は PNG 生成後に WebP 変換
  --reference <path>       参照画像パス
                           デフォルト: static/assets/brand/master-character-sheet.png
  --model <model>          生成モデル（デフォルト: flash）
                           選択肢: flash / pro
  --aspect-ratio <ratio>   アスペクト比の上書き（例: 4:3, 16:9, 1:1）
  --dry-run                プロンプトのみ表示（API 未呼び出し）
  --help, -h               このヘルプを表示

例:
  # N レアリティ スタンプ
  npm run generate:image -- --prompt "にこにこスマイル、丸いかわいい顔" --category stamp --rarity N --output static/assets/stamps/n-nikonikoSmile.png

  # SR スタンプ（レアリティ語彙自動付与）
  npm run generate:image -- --prompt "ドラゴン" --category stamp --rarity SR --output static/assets/stamps/sr-dragon.png

  # バッジ
  npm run generate:image -- --prompt "はじめての活動達成を表す、足跡アイコン" --category badge --output static/assets/badges/first-step.png

  # dry-run でプロンプト確認
  npm run generate:image -- --prompt "テスト" --category badge --rarity R --dry-run
`);
	process.exit(0);
}

function getArg(name, defaultValue = null) {
	const idx = args.indexOf(`--${name}`);
	if (idx === -1) return defaultValue;
	return args[idx + 1] ?? defaultValue;
}

const prompt = getArg('prompt');
const category = getArg('category', 'general');
const rarity = getArg('rarity', 'N').toUpperCase();
const outputArg = getArg('output', 'tmp/generated.png');
const referenceArg = getArg('reference', null);
const modelKey = getArg('model', 'flash');
const _aspectRatioArg = getArg('aspect-ratio', null);
const isDryRun = args.includes('--dry-run');

if (!prompt) {
	console.error('エラー: --prompt は必須です。');
	console.error('使用法: npm run generate:image -- --prompt "..." [オプション]');
	process.exit(1);
}

// ── 設定解決 ─────────────────────────────────────────────────

const catConfig = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.general;
const rarityKw = RARITY_KEYWORDS[rarity] ?? RARITY_KEYWORDS.N;
const modelId = MODEL_IDS[modelKey] ?? MODEL_IDS.flash;

const outputPath = path.resolve(REPO_ROOT, outputArg);
const isWebP = outputPath.endsWith('.webp');
const pngPath = isWebP ? outputPath.replace(/\.webp$/, '.png') : outputPath;

// 参照画像の解決（master-character-sheet.png → fallback hero-default.png → なし）
let referencePath = referenceArg
	? path.resolve(REPO_ROOT, referenceArg)
	: path.resolve(REPO_ROOT, DEFAULT_REFERENCE_IMAGE);

if (!fs.existsSync(referencePath)) {
	const fallback = path.resolve(REPO_ROOT, FALLBACK_REFERENCE_IMAGE);
	if (fs.existsSync(fallback)) {
		console.warn(`⚠ 参照画像が見つかりません: ${referencePath}`);
		console.warn(`  フォールバック使用: ${fallback}`);
		referencePath = fallback;
	} else {
		console.warn(`⚠ 参照画像が見つかりません（フォールバックも存在しない）: ${referencePath}`);
		referencePath = null;
	}
}

// プロンプト組み立て
const fullPrompt = catConfig.template(prompt, rarityKw);

// ── dry-run ─────────────────────────────────────────────────

if (isDryRun) {
	console.log('=== DRY RUN — API は呼び出しません ===\n');
	console.log(`カテゴリ  : ${category}`);
	console.log(`レアリティ: ${rarity}`);
	console.log(`モデル    : ${modelId}`);
	console.log(`出力先    : ${outputPath}`);
	console.log(`参照画像  : ${referencePath ?? '(なし)'}\n`);
	console.log('=== 生成プロンプト ===');
	console.log(fullPrompt);
	process.exit(0);
}

// ── API キー取得 ─────────────────────────────────────────────

// .env.local → .env の順で読み込む
function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return;
	const content = fs.readFileSync(filePath, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed
			.slice(eqIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
		if (!process.env[key]) process.env[key] = value;
	}
}

loadEnvFile(path.resolve(REPO_ROOT, '.env.local'));
loadEnvFile(path.resolve(REPO_ROOT, '.env'));

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
	console.error('エラー: GEMINI_API_KEY が設定されていません。');
	console.error('  .env.local または環境変数 GEMINI_API_KEY に設定してください。');
	process.exit(1);
}

// ── 生成 ─────────────────────────────────────────────────────

const ai = new GoogleGenAI({ apiKey: API_KEY });

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

console.log('がんばりクエスト 画像生成');
console.log(`  カテゴリ  : ${category}`);
console.log(`  レアリティ: ${rarity}`);
console.log(`  モデル    : ${modelId}`);
console.log(`  出力先    : ${outputPath}`);
console.log(`  参照画像  : ${referencePath ?? '(なし)'}\n`);

/** 参照画像を inline_data として返す */
function buildReferenceImagePart(imagePath) {
	const ext = path.extname(imagePath).toLowerCase();
	const mimeMap = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.webp': 'image/webp',
	};
	const mimeType = mimeMap[ext] ?? 'image/png';
	const data = fs.readFileSync(imagePath).toString('base64');
	return { inlineData: { mimeType, data } };
}

async function generateImage() {
	const parts = [];

	if (referencePath) {
		parts.push(buildReferenceImagePart(referencePath));
		parts.push({ text: 'Using the above image as brand style reference, generate the following:' });
	}

	parts.push({ text: fullPrompt });

	const response = await ai.models.generateContent({
		model: modelId,
		contents: [{ role: 'user', parts }],
		config: { responseModalities: ['IMAGE', 'TEXT'] },
	});

	for (const part of response.candidates?.[0]?.content?.parts ?? []) {
		if (part.inlineData?.data) {
			const imageData = Buffer.from(part.inlineData.data, 'base64');
			fs.writeFileSync(pngPath, imageData);
			console.log(`✓ PNG 保存: ${pngPath} (${(imageData.length / 1024).toFixed(0)} KB)`);

			if (isWebP) {
				await convertToWebP(pngPath, outputPath);
				fs.unlinkSync(pngPath);
			}

			console.log(`✓ 完了: ${outputPath}`);
			return;
		}
	}

	console.error('✗ 画像データが応答に含まれていませんでした。');
	process.exit(1);
}

/** PNG を WebP に変換（sharp が利用可能な場合）*/
async function convertToWebP(pngInput, webpOutput) {
	try {
		const { default: sharp } = await import('sharp');
		await sharp(pngInput).webp({ quality: 90 }).toFile(webpOutput);
		console.log(`✓ WebP 変換: ${webpOutput}`);
	} catch {
		// sharp が未インストールの場合はスキップ
		console.warn('⚠ sharp が見つかりません。PNG のまま出力します（WebP 変換をスキップ）。');
		fs.copyFileSync(pngInput, webpOutput);
	}
}

generateImage().catch((err) => {
	console.error('✗ 生成エラー:', err.message);
	process.exit(1);
});
