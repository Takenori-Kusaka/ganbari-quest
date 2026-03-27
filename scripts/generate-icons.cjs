/**
 * SVG → PNG icon generator for PWA/favicon
 * Usage: node scripts/generate-icons.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'static', 'favicon.svg');
const outDir = path.join(__dirname, '..', 'static');
const iconsDir = path.join(outDir, 'icons');

async function generate() {
	const svgBuf = fs.readFileSync(svgPath);

	// favicon-32x32.png
	await sharp(svgBuf).resize(32, 32).png().toFile(path.join(outDir, 'favicon-32x32.png'));
	console.log('  favicon-32x32.png');

	// icon-192.png
	await sharp(svgBuf).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'));
	console.log('  icons/icon-192.png');

	// icon-512.png
	await sharp(svgBuf).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'));
	console.log('  icons/icon-512.png');

	// Maskable icon (512x512 with padding — icon fills 80% of canvas)
	const innerSize = Math.round(512 * 0.8); // 410
	const padding = Math.round((512 - innerSize) / 2); // 51
	const innerBuf = await sharp(svgBuf).resize(innerSize, innerSize).png().toBuffer();
	await sharp({
		create: { width: 512, height: 512, channels: 4, background: { r: 74, g: 144, b: 217, alpha: 1 } },
	})
		.composite([{ input: innerBuf, left: padding, top: padding }])
		.png()
		.toFile(path.join(iconsDir, 'icon-maskable-512.png'));
	console.log('  icons/icon-maskable-512.png');

	// Apple touch icon (180x180)
	await sharp(svgBuf).resize(180, 180).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'));
	console.log('  icons/apple-touch-icon.png');

	console.log('Done!');
}

generate().catch((err) => {
	console.error(err);
	process.exit(1);
});
