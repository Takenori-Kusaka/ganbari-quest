#!/usr/bin/env node

// scripts/generate-stamp-images.mjs
// Gemini API で全6ランクのおみくじスタンプ画像を生成するスクリプト
// 使用法: GEMINI_API_KEY=xxx node scripts/generate-stamp-images.mjs

import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
	console.error('Error: GEMINI_API_KEY environment variable is required');
	console.error('Usage: GEMINI_API_KEY=xxx node scripts/generate-stamp-images.mjs');
	process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const OUTPUT_DIR = path.resolve('static/assets/stamps');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 共通のスタンプデザイン指示
const BASE_PROMPT = `You are creating a Japanese stamp rally stamp (スタンプラリー) illustration.

This must look like a real rubber stamp impression — the kind you see at Japanese train stations, tourist spots, and shrines. These stamps are pressed with ink onto paper and have:
- A circular border with slight ink texture and bleed
- An illustration/motif in the center
- Japanese text integrated into the design
- A hand-pressed, slightly imperfect quality (not perfectly clean)

CRITICAL RULES:
- This is a FLAT 2D ink impression on paper, NOT a 3D object
- NOT a coin, NOT a medal, NOT a badge, NOT a button
- Think rubber stamp pressed with colored ink
- Transparent background (PNG with alpha)
- The overall shape is circular (round stamp)
- Size: 256x256 pixels
- Style: cute, appealing to children (ages 3-15), Japanese kawaii aesthetic
- The illustration should be simple but charming, like station stamps in Japan`;

const STAMPS = [
	{
		filename: 'daidaikichi.png',
		rank: '大大吉',
		prompt: `${BASE_PROMPT}

THIS STAMP: 大大吉 (Greatest Fortune) — the rarest and most special stamp.

Design:
- INK COLOR: Rich gold / golden color
- CENTRAL ILLUSTRATION: A majestic phoenix (鳳凰) with spread wings, drawn in a cute but impressive style
- BORDER: Double circular border in gold ink, with decorative cloud patterns between the rings
- TEXT: The characters "大大吉" written in bold brush calligraphy style at the top or bottom of the circle
- EXTRA DECORATION: Small stars or sparkles around the phoenix
- FEELING: Legendary, special, "wow I got the rarest one!"
- The phoenix should be simple enough to read at small sizes but detailed enough to feel premium`,
	},
	{
		filename: 'daikichi.png',
		rank: '大吉',
		prompt: `${BASE_PROMPT}

THIS STAMP: 大吉 (Great Fortune) — a very lucky, prestigious stamp.

Design:
- INK COLOR: Deep purple / violet
- CENTRAL ILLUSTRATION: A dragon (龍) coiling upward, drawn in a cute but dignified style
- BORDER: Double circular border in purple ink, with wave patterns between the rings
- TEXT: The characters "大吉" written in bold brush calligraphy style
- EXTRA DECORATION: Small clouds around the dragon
- FEELING: Powerful, impressive, "amazing luck!"
- The dragon should be stylized and cute, not scary — appealing to children`,
	},
	{
		filename: 'chukichi.png',
		rank: '中吉',
		prompt: `${BASE_PROMPT}

THIS STAMP: 中吉 (Medium Fortune) — a solid, good fortune stamp.

Design:
- INK COLOR: Blue (cobalt blue)
- CENTRAL ILLUSTRATION: A sea bream fish (鯛 / tai) — the Japanese symbol of celebration ("めでたい"). The fish should be cute and plump, swimming happily
- BORDER: Single circular border in blue ink with small wave decorations
- TEXT: The characters "中吉" written in brush calligraphy style
- EXTRA DECORATION: Small bubbles or water splashes
- FEELING: Happy, celebratory, "that's pretty good!"`,
	},
	{
		filename: 'shokichi.png',
		rank: '小吉',
		prompt: `${BASE_PROMPT}

THIS STAMP: 小吉 (Small Fortune) — a cute, modest fortune stamp.

Design:
- INK COLOR: Green (emerald green)
- CENTRAL ILLUSTRATION: A daruma doll (だるま) with a determined, cute expression and one eye filled in (願い事)
- BORDER: Single circular border in green ink
- TEXT: The characters "小吉" written in brush calligraphy style
- EXTRA DECORATION: Small leaves or bamboo sprigs
- FEELING: Encouraging, "keep going, good things are coming!"`,
	},
	{
		filename: 'kichi.png',
		rank: '吉',
		prompt: `${BASE_PROMPT}

THIS STAMP: 吉 (Fortune) — the standard, everyday fortune stamp.

Design:
- INK COLOR: Light blue / sky blue
- CENTRAL ILLUSTRATION: A beckoning cat (招き猫 / maneki-neko) with one paw raised, cute and friendly
- BORDER: Single circular border in light blue ink
- TEXT: The character "吉" written in brush calligraphy style
- EXTRA DECORATION: A small coin or bell near the cat
- FEELING: Friendly, warm, "a nice little fortune"`,
	},
	{
		filename: 'suekichi.png',
		rank: '末吉',
		prompt: `${BASE_PROMPT}

THIS STAMP: 末吉 (Ending Fortune) — a gentle, hopeful fortune stamp.

Design:
- INK COLOR: Warm gray / silver gray
- CENTRAL ILLUSTRATION: A four-leaf clover (四つ葉のクローバー) with a cute ladybug sitting on one leaf
- BORDER: Single circular border in gray ink, slightly thinner than other ranks
- TEXT: The characters "末吉" written in brush calligraphy style
- EXTRA DECORATION: Small dots like morning dew on the clover
- FEELING: Gentle, hopeful, "luck is just around the corner"`,
	},
];

async function generateImage(stamp) {
	console.log(`Generating ${stamp.rank} stamp (${stamp.filename})...`);

	try {
		const response = await ai.models.generateContent({
			model: 'gemini-2.5-flash-image',
			contents: [{ role: 'user', parts: [{ text: stamp.prompt }] }],
			config: {
				responseModalities: ['IMAGE', 'TEXT'],
			},
		});

		for (const part of response.candidates?.[0]?.content?.parts ?? []) {
			if (part.inlineData?.data) {
				const imageData = Buffer.from(part.inlineData.data, 'base64');
				const outputPath = path.join(OUTPUT_DIR, stamp.filename);
				fs.writeFileSync(outputPath, imageData);
				console.log(`  ✓ Saved: ${outputPath} (${(imageData.length / 1024).toFixed(0)} KB)`);
				return true;
			}
		}

		console.warn(`  ⚠ No image data in response for ${stamp.rank}`);
		return false;
	} catch (error) {
		console.error(`  ✗ Error generating ${stamp.rank}:`, error.message);
		return false;
	}
}

async function main() {
	console.log('=== おみくじスタンプ画像ジェネレーター ===');
	console.log(`Output: ${OUTPUT_DIR}\n`);

	let successCount = 0;
	for (const stamp of STAMPS) {
		const success = await generateImage(stamp);
		if (success) successCount++;
		// Rate limit
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}

	console.log(`\n完了: ${successCount}/${STAMPS.length} 画像生成`);

	if (successCount === STAMPS.length) {
		console.log('\n全スタンプ生成成功！');
		console.log('次のステップ: StampCard.svelte で画像パスを参照するように更新してください');
	}
}

main().catch(console.error);
