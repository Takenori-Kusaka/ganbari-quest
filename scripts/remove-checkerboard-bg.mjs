#!/usr/bin/env node
/**
 * scripts/remove-checkerboard-bg.mjs (#4921)
 *
 * AI 画像生成 (Gemini) が「透過っぽい見た目」を表現する際に焼き込む市松模様
 * (チェッカーボード) を検出し、真の alpha チャンネル付き PNG に変換する。
 *
 * 背景は 2 トーンのグレー/白の市松模様として描画される (RGB が概ね等しい =
 * 無彩色)。画像の外周帯 (border band) をサンプリングして 2 トーンを k-means で
 * 推定し、その周辺色域に収まる無彩色ピクセルを透明化する。
 *
 * 使い方:
 *   node scripts/remove-checkerboard-bg.mjs <file1.png> [file2.png ...]
 *   node scripts/remove-checkerboard-bg.mjs --dir static/assets/battle/enemies
 *
 * オプション:
 *   --dir <path>       ディレクトリ配下の *.png を再帰的に対象化 (file 引数と併用可)
 *   --neutral-tol <n>  無彩色判定の許容差 (max-min channel、既定 12)
 *   --pad <n>          検出した 2 トーンの前後に広げる許容幅 (既定 22)
 *   --dry-run          変換率を表示するだけでファイルを書き換えない
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { isMain } from './lib/is-main.mjs';

function findPngsRecursive(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...findPngsRecursive(full));
		else if (extname(entry).toLowerCase() === '.png') out.push(full);
	}
	return out;
}

function parseArgs(argv) {
	const files = [];
	let dir = null;
	let neutralTol = 12;
	let pad = 22;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dir') {
			dir = argv[++i];
		} else if (a === '--neutral-tol') {
			neutralTol = Number(argv[++i]);
		} else if (a === '--pad') {
			pad = Number(argv[++i]);
		} else if (a === '--dry-run') {
			dryRun = true;
		} else if (a === '--help' || a === '-h') {
			console.log(
				'Usage: node scripts/remove-checkerboard-bg.mjs <file...> | --dir "<path>" [--neutral-tol N] [--pad N] [--dry-run]',
			);
			process.exit(0);
		} else {
			files.push(a);
		}
	}
	if (dir) files.push(...findPngsRecursive(resolve(dir)));
	return { files, neutralTol, pad, dryRun };
}

/**
 * 画像の外周帯 (border band) から無彩色サンプルを集め、1D k-means (k=2) で
 * 市松模様の 2 トーン (輝度) を推定する。
 */
function detectCheckerTones(data, width, height, channels, neutralTol) {
	const band = Math.min(24, Math.floor(Math.min(width, height) / 4));
	const samples = [];
	const consider = (x, y) => {
		const idx = (y * width + x) * channels;
		const r = data[idx];
		const g = data[idx + 1];
		const b = data[idx + 2];
		const maxC = Math.max(r, g, b);
		const minC = Math.min(r, g, b);
		if (maxC - minC <= neutralTol) samples.push((r + g + b) / 3);
	};
	for (let y = 0; y < band; y++) for (let x = 0; x < width; x++) consider(x, y);
	for (let y = height - band; y < height; y++) for (let x = 0; x < width; x++) consider(x, y);
	for (let x = 0; x < band; x++) for (let y = 0; y < height; y++) consider(x, y);
	for (let x = width - band; x < width; x++) for (let y = 0; y < height; y++) consider(x, y);

	if (samples.length === 0) return null;

	let c1 = Math.min(...samples);
	let c2 = Math.max(...samples);
	for (let iter = 0; iter < 12; iter++) {
		let sum1 = 0;
		let n1 = 0;
		let sum2 = 0;
		let n2 = 0;
		for (const v of samples) {
			if (Math.abs(v - c1) <= Math.abs(v - c2)) {
				sum1 += v;
				n1++;
			} else {
				sum2 += v;
				n2++;
			}
		}
		if (n1 > 0) c1 = sum1 / n1;
		if (n2 > 0) c2 = sum2 / n2;
	}
	return Math.abs(c1 - c2) < 8 ? [(c1 + c2) / 2] : [c1, c2];
}

/**
 * 市松模様の背景を透明化した RGBA バッファを返す。
 * @returns {{ buffer: Buffer, width: number, height: number, bgRatio: number } | null}
 */
export async function removeCheckerboardBackground(inputPath, { neutralTol = 12, pad = 22 } = {}) {
	const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	const size = width * height;
	const centers = detectCheckerTones(data, width, height, channels, neutralTol);
	if (!centers) return null;
	const bgLo = Math.min(...centers) - pad;
	const bgHi = Math.max(...centers) + pad;

	const out = Buffer.alloc(size * 4);
	let bgCount = 0;
	for (let i = 0; i < size; i++) {
		const o = i * channels;
		const oo = i * 4;
		const r = data[o];
		const g = data[o + 1];
		const b = data[o + 2];
		out[oo] = r;
		out[oo + 1] = g;
		out[oo + 2] = b;
		const maxC = Math.max(r, g, b);
		const minC = Math.min(r, g, b);
		const neutral = maxC - minC <= neutralTol;
		const bright = (r + g + b) / 3;
		const isBg = neutral && bright >= bgLo && bright <= bgHi;
		if (isBg) bgCount++;
		out[oo + 3] = isBg ? 0 : 255;
	}
	return { buffer: out, width, height, bgRatio: bgCount / size, centers };
}

async function main() {
	const { files, neutralTol, pad, dryRun } = parseArgs(process.argv.slice(2));
	const targets = files;
	if (targets.length === 0) {
		console.error('No input files. Pass file paths or --dir "<path>".');
		process.exit(1);
	}
	for (const rel of targets) {
		const abs = resolve(rel);
		if (!existsSync(abs)) {
			console.error(`SKIP (not found): ${rel}`);
			continue;
		}
		const result = await removeCheckerboardBackground(abs, { neutralTol, pad });
		if (!result) {
			console.error(`SKIP (no neutral samples found): ${rel}`);
			continue;
		}
		console.log(
			`${rel}: bgRatio=${result.bgRatio.toFixed(3)} centers=[${result.centers.map((c) => c.toFixed(1)).join(', ')}]`,
		);
		if (!dryRun) {
			// compressionLevel/effort を上げる (既定のままだと lossless でも数倍膨らむ実測あり、#4921)
			await sharp(result.buffer, {
				raw: { width: result.width, height: result.height, channels: 4 },
			})
				.png({ compressionLevel: 9, effort: 10 })
				.toFile(abs);
		}
	}
}

// CLI 実行時のみ main() を呼ぶ。テストから import される場合は副作用なし (#3969 SSOT)
if (isMain(import.meta.url)) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
