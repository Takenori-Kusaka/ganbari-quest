#!/usr/bin/env tsx
// scripts/generate-pwa-icons.ts
// PWA 用アイコンを favicon.svg から生成する
// 使用方法: npx tsx scripts/generate-pwa-icons.ts
// 依存: npm install -D sharp (初回のみ)

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SVG_PATH = join(ROOT, 'static', 'favicon.svg');
const ICONS_DIR = join(ROOT, 'static', 'icons');

const SIZES = [192, 512] as const;

async function main() {
	// sharp を動的にインポート（dev dependency）
	const sharp = (await import('sharp')).default;

	if (!existsSync(ICONS_DIR)) {
		mkdirSync(ICONS_DIR, { recursive: true });
	}

	const svg = readFileSync(SVG_PATH);

	for (const size of SIZES) {
		// 通常アイコン
		await sharp(svg).resize(size, size).png().toFile(join(ICONS_DIR, `icon-${size}.png`));
		console.log(`Generated icon-${size}.png`);
	}

	// Maskable アイコン（セーフゾーン用に80%サイズで中央配置、背景色付き）
	const maskableSize = 512;
	const innerSize = Math.round(maskableSize * 0.8);
	const offset = Math.round((maskableSize - innerSize) / 2);

	const innerIcon = await sharp(svg).resize(innerSize, innerSize).png().toBuffer();

	await sharp({
		create: {
			width: maskableSize,
			height: maskableSize,
			channels: 4,
			background: { r: 74, g: 144, b: 217, alpha: 1 }, // #4A90D9
		},
	})
		.composite([{ input: innerIcon, left: offset, top: offset }])
		.png()
		.toFile(join(ICONS_DIR, 'icon-maskable-512.png'));

	console.log('Generated icon-maskable-512.png');
	console.log('Done! Icons saved to static/icons/');
}

main().catch(console.error);
