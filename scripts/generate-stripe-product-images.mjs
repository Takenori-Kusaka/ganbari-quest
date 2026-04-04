#!/usr/bin/env node
// scripts/generate-stripe-product-images.mjs
// Gemini API で Stripe 商品画像を生成するスクリプト
// 使用法: GEMINI_API_KEY=xxx node scripts/generate-stripe-product-images.mjs
//
// ロゴ（site/icon-character.png）をベースに、スタンダード/ファミリー各プランの商品画像を生成。
// Stripe 商品画像の推奨サイズ: 690×690px (正方形)

import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
	console.error('Error: GEMINI_API_KEY environment variable is required');
	console.error('Usage: GEMINI_API_KEY=xxx node scripts/generate-stripe-product-images.mjs');
	process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const OUTPUT_DIR = path.resolve('static/assets/stripe');
const LOGO_PATH = path.resolve('site/icon-character.png');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ロゴ画像を読み込み
const logoBase64 = fs.readFileSync(LOGO_PATH).toString('base64');

const COMMON_STYLE = `
STYLE REQUIREMENTS:
- Size: 690x690 pixels (square)
- Clean, modern, flat design with soft gradients
- Japanese kawaii aesthetic, appealing to parents with children aged 3-15
- Professional quality suitable for a payment page
- The character from the reference image should be incorporated/referenced in the design
- Use the same art style as the reference character (cute anime/chibi style with golden helmet, blue cape, magic wand with star)
- Background: soft gradient (NOT transparent — Stripe shows white gaps with transparent PNGs)
- NO text in the image — Stripe shows the product name separately
- The overall feeling should be warm, trustworthy, and inviting
`;

const PRODUCTS = [
	{
		filename: 'standard-plan.png',
		name: 'スタンダードプラン',
		prompt: `Create a product illustration for a children's gamification app subscription plan called "Standard Plan".

Reference character: The attached image is the app's mascot — a cute child adventurer with a golden helmet, blue cape, and magic wand with a star. Use this character or a very similar character as the main element.

${COMMON_STYLE}

DESIGN FOR THIS PRODUCT (Standard Plan — the core subscription):
- The mascot character standing confidently, giving a thumbs up or pointing forward
- A single golden star floating above or near the character
- Background: warm gradient from soft orange (#FFF3E0) to light gold (#FFF8E1)
- Subtle decorative elements: small sparkles, a faint circular badge/emblem frame around the character
- Feeling: "Your adventure begins here!" — welcoming, encouraging, the start of something great
- The character should look excited and ready for action
- Keep the composition centered and balanced for a square format
`,
	},
	{
		filename: 'family-plan.png',
		name: 'ファミリープラン',
		prompt: `Create a product illustration for a children's gamification app subscription plan called "Family Plan".

Reference character: The attached image is the app's mascot — a cute child adventurer with a golden helmet, blue cape, and magic wand with a star. Use this character as the main element, but show a FAMILY scene.

${COMMON_STYLE}

DESIGN FOR THIS PRODUCT (Family Plan — the premium family subscription):
- The main mascot character in the center, slightly larger
- 2-3 smaller companion characters (siblings/friends) in similar adventure outfits gathered around, each with slightly different colors (one with a pink cape, one with a green cape)
- Multiple golden stars floating above the group
- Background: rich gradient from soft purple (#F3E5F5) to light blue (#E3F2FD)
- Subtle decorative elements: sparkles, a family emblem/crest frame, small hearts
- A golden crown or special emblem above the group to indicate premium status
- Feeling: "The whole family's adventure!" — togetherness, special, premium
- More elaborate decorative elements than the Standard version to convey higher value
- Keep the composition centered and balanced for a square format
`,
	},
];

async function generateImage(product) {
	console.log(`Generating ${product.name} (${product.filename})...`);

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
						{ text: product.prompt },
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
				const outputPath = path.join(OUTPUT_DIR, product.filename);
				fs.writeFileSync(outputPath, imageData);
				console.log(`  ✓ Saved: ${outputPath} (${(imageData.length / 1024).toFixed(0)} KB)`);
				return true;
			}
		}

		console.warn(`  ⚠ No image data in response for ${product.name}`);
		return false;
	} catch (error) {
		console.error(`  ✗ Error generating ${product.name}:`, error.message);
		return false;
	}
}

async function main() {
	console.log('=== Stripe 商品画像ジェネレーター ===');
	console.log(`Reference logo: ${LOGO_PATH}`);
	console.log(`Output: ${OUTPUT_DIR}\n`);

	let successCount = 0;
	for (const product of PRODUCTS) {
		const success = await generateImage(product);
		if (success) successCount++;
		// Rate limit between requests
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}

	console.log(`\n完了: ${successCount}/${PRODUCTS.length} 画像生成`);
	if (successCount > 0) {
		console.log('\n生成された画像を確認し、Stripe Dashboard の各商品にアップロードしてください。');
		console.log('Stripe Dashboard → 商品カタログ → 商品を編集 → 画像をアップロード');
	}
}

main();
