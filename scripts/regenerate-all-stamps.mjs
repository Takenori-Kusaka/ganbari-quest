#!/usr/bin/env node
// scripts/regenerate-all-stamps.mjs
// 全6スタンプ: Gemini Pro テキストなし生成 → flood-fill透過 → トリム → SVGテキスト個別配置

import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
	console.error('GEMINI_API_KEY required');
	process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const OUTPUT_DIR = path.resolve('static/assets/stamps');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const BASE_PROMPT = `You are creating a Japanese stamp rally stamp (スタンプラリー) illustration.
This must look like a real rubber stamp pressed with ink onto paper.

CRITICAL RULES:
- Circular rubber stamp with border and illustration
- FLAT 2D ink impression, NOT a 3D coin/medal
- ★★★ DO NOT include ANY text, kanji, hiragana, katakana, or letters ★★★
- ILLUSTRATION AND BORDER ONLY
- Solid white background
- 1024x1024 pixels
- Cute kawaii style for Japanese children ages 3-15`;

const STAMPS = [
	{
		filename: 'daidaikichi.png',
		rank: '大大吉',
		textColor: '#8B6914',
		textY: 0.08, // 上部ギリギリ（元0.25 + offset -175/1024）
		prompt: `${BASE_PROMPT}
INK: Rich gold / golden. ILLUSTRATION: Majestic cute phoenix (鳳凰) with spread wings.
BORDER: Double circular border with cloud patterns. DECORATION: Stars/sparkles.
★ NO TEXT AT ALL ★`,
	},
	{
		filename: 'daikichi.png',
		rank: '大吉',
		textColor: '#5d4e8c',
		textY: 0.25, // 合格位置
		prompt: `${BASE_PROMPT}
INK: Deep purple / violet. ILLUSTRATION: Cute kawaii dragon (龍) coiling upward.
BORDER: Double circular border with seigaiha wave patterns. DECORATION: Small clouds.
★ NO TEXT AT ALL ★`,
	},
	{
		filename: 'chukichi.png',
		rank: '中吉',
		textColor: '#1a4b8c',
		textY: 0.20, // 元0.25 + offset -50/1024
		prompt: `${BASE_PROMPT}
INK: Blue (cobalt). ILLUSTRATION: Cute plump sea bream fish (鯛) swimming.
BORDER: Single circular border with wave decorations. DECORATION: Bubbles.
★ NO TEXT AT ALL ★`,
	},
	{
		filename: 'shokichi.png',
		rank: '小吉',
		textColor: '#1a6b3a',
		textY: 0.15, // 元0.25 + offset -100/1024
		prompt: `${BASE_PROMPT}
INK: Green (emerald). ILLUSTRATION: Cute daruma doll with determined expression.
BORDER: Single circular border. DECORATION: Bamboo sprigs.
★ NO TEXT AT ALL ★`,
	},
	{
		filename: 'kichi.png',
		rank: '吉',
		textColor: '#4a8baf',
		textY: 0.225, // 元0.25 + offset -25/1024
		prompt: `${BASE_PROMPT}
INK: Light blue / sky blue. ILLUSTRATION: Cute beckoning cat (招き猫) with paw raised.
BORDER: Single circular border. DECORATION: Small coin or bell.
★ NO TEXT AT ALL ★`,
	},
	{
		filename: 'suekichi.png',
		rank: '末吉',
		textColor: '#5a5a5a',
		textY: 0.20, // 元0.25 + offset -50/1024
		prompt: `${BASE_PROMPT}
INK: Warm gray / silver. ILLUSTRATION: Four-leaf clover with cute ladybug.
BORDER: Single circular border. DECORATION: Morning dew dots.
★ NO TEXT AT ALL ★`,
	},
];

// ===== flood-fill 背景除去（外周から接続する白/灰のみ） =====
async function removeBackground(inputBuffer) {
	const { data, info } = await sharp(inputBuffer)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const pixels = Buffer.from(data);
	const { width, height, channels } = info;

	function isBg(r, g, b) {
		if (r > 225 && g > 225 && b > 225) return true;
		if (r > 185 && g > 185 && b > 185 && Math.abs(r - g) < 15 && Math.abs(g - b) < 15) return true;
		if (r > 225 && g > 220 && b > 205) return true;
		return false;
	}

	const visited = new Uint8Array(width * height);
	const toClear = new Uint8Array(width * height);
	const queue = [];

	// 外周をシード
	for (let x = 0; x < width; x++) {
		queue.push(x);
		queue.push((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		queue.push(y * width);
		queue.push(y * width + (width - 1));
	}

	while (queue.length > 0) {
		const idx = queue.shift();
		if (idx < 0 || idx >= width * height || visited[idx]) continue;
		visited[idx] = 1;
		const off = idx * channels;
		if (!isBg(pixels[off], pixels[off + 1], pixels[off + 2])) continue;
		toClear[idx] = 1;
		const x = idx % width;
		const y = Math.floor(idx / width);
		if (x > 0) queue.push(idx - 1);
		if (x < width - 1) queue.push(idx + 1);
		if (y > 0) queue.push(idx - width);
		if (y < height - 1) queue.push(idx + width);
	}

	for (let i = 0; i < width * height; i++) {
		if (toClear[i]) {
			const off = i * channels;
			pixels[off] = 0;
			pixels[off + 1] = 0;
			pixels[off + 2] = 0;
			pixels[off + 3] = 0;
		}
	}

	return sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
}

// ===== トリム + 正方形パディング（余白最小限） =====
async function trimAndSquare(buffer) {
	const trimmed = await sharp(buffer).trim().png().toBuffer();
	const m = await sharp(trimmed).metadata();
	const maxDim = Math.max(m.width, m.height);
	// 2%余白で正方形化
	const padded = Math.round(maxDim * 1.02);

	return sharp(trimmed)
		.extend({
			top: Math.round((padded - m.height) / 2),
			bottom: Math.ceil((padded - m.height) / 2),
			left: Math.round((padded - m.width) / 2),
			right: Math.ceil((padded - m.width) / 2),
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();
}

// ===== SVGテキスト合成 =====
async function addText(buffer, text, color, textYRatio) {
	const m = await sharp(buffer).metadata();
	const { width, height } = m;
	const fontSize = Math.round(width * 0.13);
	const yPos = Math.round(height * textYRatio);

	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${width / 2}" y="${yPos}"
    font-family="'Yu Mincho','MS Mincho','Hiragino Mincho ProN','Noto Serif JP',serif"
    font-size="${fontSize}" font-weight="900"
    fill="${color}" text-anchor="middle" dominant-baseline="middle"
    letter-spacing="${Math.round(width * 0.01)}"
  >${text}</text>
</svg>`;

	const textPng = await sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
	return sharp(buffer).composite([{ input: textPng, top: 0, left: 0 }]).png().toBuffer();
}

// ===== Gemini生成 =====
async function generate(prompt, label) {
	console.log(`  Gemini Pro generating ${label}...`);
	const res = await ai.models.generateContent({
		model: 'gemini-3-pro-image-preview',
		contents: [{ role: 'user', parts: [{ text: prompt }] }],
		config: { responseModalities: ['IMAGE', 'TEXT'] },
	});
	for (const part of res.candidates?.[0]?.content?.parts ?? []) {
		if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
	}
	throw new Error(`No image for ${label}`);
}

// ===== メイン =====
async function main() {
	console.log('=== 全スタンプ再生成（Proモデル + flood-fill透過 + トリム + 個別テキスト位置）===\n');

	for (const s of STAMPS) {
		console.log(`--- ${s.rank} ---`);
		const raw = await generate(s.prompt, s.rank);
		const transparent = await removeBackground(raw);
		const trimmed = await trimAndSquare(transparent);
		const final = await addText(trimmed, s.rank, s.textColor, s.textY);
		await sharp(final).png().toFile(path.join(OUTPUT_DIR, s.filename));

		const m = await sharp(path.join(OUTPUT_DIR, s.filename)).metadata();
		console.log(`  ✓ ${s.filename}: ${m.width}x${m.height}\n`);
		await new Promise((r) => setTimeout(r, 4000));
	}

	console.log('=== 完了 ===');
}

main().catch(console.error);
