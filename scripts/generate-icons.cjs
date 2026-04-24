/**
 * アイコン生成スクリプト
 * - favicon: SVGマスター（「が」レターマーク）から生成
 * - PWA/Apple: キャラクターPNGから生成
 * Usage: node scripts/generate-icons.cjs
 */
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs');

const faviconSvgPath = path.join(__dirname, '..', 'static', 'favicon-master.svg');
const characterPath = path.join(__dirname, '..', 'static', 'icon-character.png');
const outDir = path.join(__dirname, '..', 'static');
const iconsDir = path.join(outDir, 'icons');
const siteDir = path.join(__dirname, '..', 'site');

async function generate() {
	// --- Favicon (from SVG lettermark) ---
	console.log('Generating favicons from:', faviconSvgPath);

	// favicon-32x32.png
	await sharp(faviconSvgPath).resize(32, 32).png().toFile(path.join(outDir, 'favicon-32x32.png'));
	console.log('  favicon-32x32.png');

	// favicon-16x16.png
	await sharp(faviconSvgPath).resize(16, 16).png().toFile(path.join(outDir, 'favicon-16x16.png'));
	console.log('  favicon-16x16.png');

	// Sync to site/ if directory exists
	if (fs.existsSync(siteDir)) {
		fs.copyFileSync(
			path.join(outDir, 'favicon-32x32.png'),
			path.join(siteDir, 'favicon-32x32.png'),
		);
		fs.copyFileSync(
			path.join(outDir, 'favicon-16x16.png'),
			path.join(siteDir, 'favicon-16x16.png'),
		);
		console.log('  Synced favicons to site/');
	}

	// --- PWA / Apple icons (from character PNG) ---
	console.log('Generating PWA icons from:', characterPath);

	// icon-192.png
	await sharp(characterPath)
		.resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toFile(path.join(iconsDir, 'icon-192.png'));
	console.log('  icons/icon-192.png');

	// icon-512.png
	await sharp(characterPath)
		.resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toFile(path.join(iconsDir, 'icon-512.png'));
	console.log('  icons/icon-512.png');

	// Maskable icon (512x512 with padding — icon fills 80% of canvas)
	const innerSize = Math.round(512 * 0.8);
	const padding = Math.round((512 - innerSize) / 2);
	const innerBuf = await sharp(characterPath)
		.resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	await sharp({
		create: {
			width: 512,
			height: 512,
			channels: 4,
			background: { r: 232, g: 244, b: 253, alpha: 1 },
		},
	})
		.composite([{ input: innerBuf, left: padding, top: padding }])
		.png()
		.toFile(path.join(iconsDir, 'icon-maskable-512.png'));
	console.log('  icons/icon-maskable-512.png');

	// Apple touch icon (180x180)
	await sharp(characterPath)
		.resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toFile(path.join(iconsDir, 'apple-touch-icon.png'));
	console.log('  icons/apple-touch-icon.png');

	console.log('Done!');
}

generate().catch((err) => {
	console.error(err);
	process.exit(1);
});
