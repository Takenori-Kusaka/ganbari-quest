#!/usr/bin/env node
// scripts/generate-marketing-images.mjs
// Gemini API で SNS バナー画像・OGP 画像を生成するスクリプト
// 使用法: GEMINI_API_KEY=xxx node scripts/generate-marketing-images.mjs
//
// ロゴキャラクター（site/icon-character.png）を参照し、各種マーケティング画像を生成。

import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
	console.error('Error: GEMINI_API_KEY environment variable is required');
	console.error('Usage: GEMINI_API_KEY=xxx node scripts/generate-marketing-images.mjs');
	process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const LOGO_PATH = path.resolve('site/icon-character.png');

// Ensure output directories exist
const MARKETING_DIR = path.resolve('static/assets/marketing');
const SITE_DIR = path.resolve('site');
fs.mkdirSync(MARKETING_DIR, { recursive: true });

// Load reference character image
const logoBase64 = fs.readFileSync(LOGO_PATH).toString('base64');

const COMMON_STYLE = `
STYLE REQUIREMENTS (CRITICAL):
- Use the same art style as the reference character (cute anime/chibi style with golden helmet, blue cape, magic wand with star)
- The character from the reference image MUST be the main element — a cute child adventurer
- Japanese kawaii aesthetic, appealing to parents with children aged 3-15
- Clean, modern, flat design with soft gradients
- Professional quality suitable for marketing materials
- NO text, NO letters, NO words, NO numbers in the image — text will be added separately
- NOT transparent background — use soft gradient backgrounds
- The overall feeling should be warm, inviting, and adventurous
- Bright, cheerful color palette
`;

const IMAGES = [
	{
		filename: 'ogp.png',
		outputDir: SITE_DIR,
		name: 'OGP画像',
		prompt: `Create an OGP (Open Graph Protocol) image for a children's gamification web app called "Ganbari Quest" (a quest-based motivation app for kids).

Reference character: The attached image is the app's mascot — a cute child adventurer with a golden helmet, blue cape, and magic wand with a star. This character MUST appear prominently in the image.

${COMMON_STYLE}

SPECIFIC DESIGN FOR THIS IMAGE (OGP — 1200x630):
- Size: 1200x630 pixels (landscape, 1.91:1 aspect ratio)
- Layout: The mascot character positioned on the left side of the image, in a dynamic adventurous pose (jumping, pointing forward, or casting magic)
- The right side should have open space with decorative elements (stars, sparkles, magical swirls, small treasure chests, quest badges)
- Background: Beautiful soft gradient from light blue (#E8F4FD) on the left to light gold (#FFF8E1) on the right
- Scatter golden stars and sparkle effects around the character
- Add subtle quest/adventure themed decorative elements: a small compass, tiny floating gems, magical trails
- The character should look excited, welcoming, and full of energy
- Composition should feel balanced with the character as the focal point on the left third
- Professional, polished look — this is the first impression when sharing the URL
- Absolutely NO text in the image
`,
	},
	{
		filename: 'twitter-header.png',
		outputDir: MARKETING_DIR,
		name: 'Twitter/Xヘッダー',
		prompt: `Create a Twitter/X header banner image for a children's gamification web app called "Ganbari Quest".

Reference character: The attached image is the app's mascot — a cute child adventurer with a golden helmet, blue cape, and magic wand with a star. Use this character as the central element.

${COMMON_STYLE}

SPECIFIC DESIGN FOR THIS IMAGE (Twitter Header — 1500x500):
- Size: 1500x500 pixels (wide landscape, 3:1 aspect ratio)
- Layout: The main mascot character in the center, slightly larger, in a heroic pose
- 2-3 smaller companion characters on either side (similar chibi adventurer style but with different colored capes — pink, green, orange)
- Background: A dreamy fantasy adventure landscape — soft pastel sky with fluffy clouds, distant mountains, and twinkling stars
- Color palette: Soft blues, purples, pinks, and gold accents
- Scatter small magical elements across the banner: floating stars, sparkle trails, tiny quest icons
- The scene should feel like the beginning of a grand adventure
- Keep important elements in the center (Twitter crops edges on mobile)
- Warm, bright, and inviting atmosphere
- Absolutely NO text in the image
`,
	},
	{
		filename: 'twitter-post.png',
		outputDir: MARKETING_DIR,
		name: 'Twitter/X投稿画像',
		prompt: `Create a Twitter/X post image for a children's gamification web app called "Ganbari Quest".

Reference character: The attached image is the app's mascot — a cute child adventurer with a golden helmet, blue cape, and magic wand with a star. Use this character as the central element.

${COMMON_STYLE}

SPECIFIC DESIGN FOR THIS IMAGE (Twitter Post — 1200x675):
- Size: 1200x675 pixels (landscape, 16:9 aspect ratio)
- Theme: "Level Up!" celebration moment
- The mascot character in the center, in an excited celebratory pose — jumping with joy, arms raised, or casting sparkle magic
- A large golden "level up" star or badge effect behind/above the character (like an RPG level up animation)
- Magical energy effects radiating outward from the character
- Small achievement badges, stars, and sparkles floating around
- Background: Dramatic gradient from deep blue (#1565C0) at the bottom to golden (#FFD54F) at the top, creating a sunrise/dawn of adventure feel
- Golden light rays emanating from behind the character
- Confetti-like sparkle particles scattered throughout
- The feeling should be: triumphant, exciting, celebratory — a moment of achievement
- Absolutely NO text in the image
`,
	},
	{
		filename: 'instagram-post.png',
		outputDir: MARKETING_DIR,
		name: 'Instagram投稿',
		prompt: `Create an Instagram post image for a children's gamification web app called "Ganbari Quest".

Reference character: The attached image is the app's mascot — a cute child adventurer with a golden helmet, blue cape, and magic wand with a star. Use this character as the central element.

${COMMON_STYLE}

SPECIFIC DESIGN FOR THIS IMAGE (Instagram Post — 1080x1080):
- Size: 1080x1080 pixels (perfect square)
- The mascot character in the center, slightly larger, in a confident and cheerful pose
- Surround the character with gamification elements arranged in a circular pattern:
  - Golden trophy on one side
  - Level-up badge/shield on another side
  - Stars (various sizes) scattered around
  - Small treasure chest
  - A magic wand trail creating sparkle circles
  - Achievement ribbon/medal
- Background: Bright pastel gradient — soft pink (#FCE4EC) blending to soft lavender (#E8EAF6) blending to soft mint (#E0F7FA)
- The gamification elements should feel like they're orbiting or floating around the character
- Add subtle sparkle and glow effects to make everything feel magical
- Composition should be centrally balanced for the square format
- Everything should feel magical, playful, and rewarding
- Absolutely NO text in the image
`,
	},
];

async function generateImage(imageConfig) {
	console.log(`\nGenerating ${imageConfig.name} (${imageConfig.filename})...`);

	try {
		const response = await ai.models.generateContent({
			model: 'gemini-3-pro-image-preview',
			contents: [
				{
					role: 'user',
					parts: [
						{
							inlineData: {
								mimeType: 'image/png',
								data: logoBase64,
							},
						},
						{ text: imageConfig.prompt },
					],
				},
			],
			config: {
				responseModalities: ['IMAGE', 'TEXT'],
			},
		});

		for (const part of response.candidates?.[0]?.content?.parts ?? []) {
			if (part.inlineData?.data) {
				const imageData = Buffer.from(part.inlineData.data, 'base64');
				const outputPath = path.join(imageConfig.outputDir, imageConfig.filename);
				fs.writeFileSync(outputPath, imageData);
				console.log(`  OK Saved: ${outputPath} (${(imageData.length / 1024).toFixed(0)} KB)`);
				return true;
			}
		}

		console.warn(`  WARNING: No image data in response for ${imageConfig.name}`);
		// Log text parts for debugging
		for (const part of response.candidates?.[0]?.content?.parts ?? []) {
			if (part.text) {
				console.warn(`  Response text: ${part.text.substring(0, 200)}`);
			}
		}
		return false;
	} catch (error) {
		console.error(`  ERROR generating ${imageConfig.name}:`, error.message);
		return false;
	}
}

async function main() {
	console.log('=== マーケティング画像ジェネレーター ===');
	console.log(`Reference character: ${LOGO_PATH}`);
	console.log(`Marketing output: ${MARKETING_DIR}`);
	console.log(`OGP output: ${SITE_DIR}`);
	console.log(`\nGenerating ${IMAGES.length} images...\n`);

	let successCount = 0;
	for (const imageConfig of IMAGES) {
		const success = await generateImage(imageConfig);
		if (success) successCount++;
		// Rate limit between requests (Gemini API)
		if (imageConfig !== IMAGES[IMAGES.length - 1]) {
			console.log('  Waiting 5 seconds for rate limit...');
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}

	console.log(`\n=== 完了: ${successCount}/${IMAGES.length} 画像生成 ===`);

	if (successCount > 0) {
		console.log('\n生成された画像:');
		for (const img of IMAGES) {
			const outputPath = path.join(img.outputDir, img.filename);
			if (fs.existsSync(outputPath)) {
				const stats = fs.statSync(outputPath);
				console.log(`  - ${img.name}: ${outputPath} (${(stats.size / 1024).toFixed(0)} KB)`);
			}
		}
	}

	if (successCount < IMAGES.length) {
		console.log(`\n${IMAGES.length - successCount} 枚の画像生成に失敗しました。再実行してください。`);
	}
}

main();
