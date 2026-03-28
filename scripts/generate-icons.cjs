/**
 * PNG → 各サイズアイコン生成スクリプト
 * D3勇者キャラクター透過PNGからfavicon/PWAアイコンを生成
 * Usage: node scripts/generate-icons.cjs
 */
const sharp = require('sharp');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'static', 'icon-character.png');
const outDir = path.join(__dirname, '..', 'static');
const iconsDir = path.join(outDir, 'icons');

async function generate() {
	console.log('Generating icons from:', srcPath);

	// favicon-32x32.png
	await sharp(srcPath).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(outDir, 'favicon-32x32.png'));
	console.log('  favicon-32x32.png');

	// icon-192.png
	await sharp(srcPath).resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(iconsDir, 'icon-192.png'));
	console.log('  icons/icon-192.png');

	// icon-512.png
	await sharp(srcPath).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(iconsDir, 'icon-512.png'));
	console.log('  icons/icon-512.png');

	// Maskable icon (512x512 with padding — icon fills 80% of canvas)
	const innerSize = Math.round(512 * 0.8); // 410
	const padding = Math.round((512 - innerSize) / 2); // 51
	const innerBuf = await sharp(srcPath).resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
	await sharp({
		create: { width: 512, height: 512, channels: 4, background: { r: 232, g: 244, b: 253, alpha: 1 } },
	})
		.composite([{ input: innerBuf, left: padding, top: padding }])
		.png()
		.toFile(path.join(iconsDir, 'icon-maskable-512.png'));
	console.log('  icons/icon-maskable-512.png');

	// Apple touch icon (180x180)
	await sharp(srcPath).resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'));
	console.log('  icons/apple-touch-icon.png');

	console.log('Done!');
}

generate().catch((err) => {
	console.error(err);
	process.exit(1);
});
