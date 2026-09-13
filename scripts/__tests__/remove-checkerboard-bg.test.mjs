/**
 * scripts/__tests__/remove-checkerboard-bg.test.mjs (#4921)
 *
 * `scripts/remove-checkerboard-bg.mjs` の checkerboard → alpha 変換ロジックの unit test。
 * 合成した市松模様 (+ 中央の彩色オブジェクト) JPEG を作り、背景だけが透明化されることを検証する。
 *
 * 実行: node --test scripts/__tests__/remove-checkerboard-bg.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

const { removeCheckerboardBackground } = await import('../remove-checkerboard-bg.mjs');

/** size×size の市松模様 (無彩色 2 トーン) を生成し、中央に彩色オブジェクトを置いた JPEG バッファを返す。 */
async function makeCheckerboardFixture({
	size = 128,
	cell = 8,
	toneA = 235,
	toneB = 255,
	objectSize = 32,
} = {}) {
	const channels = 3;
	const buf = Buffer.alloc(size * size * channels);
	const objLo = (size - objectSize) / 2;
	const objHi = objLo + objectSize;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const idx = (y * size + x) * channels;
			const isObject = x >= objLo && x < objHi && y >= objLo && y < objHi;
			if (isObject) {
				// 彩色オブジェクト（R 突出、無彩色ではない）
				buf[idx] = 220;
				buf[idx + 1] = 40;
				buf[idx + 2] = 40;
			} else {
				const parity = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
				const tone = parity === 0 ? toneA : toneB;
				buf[idx] = tone;
				buf[idx + 1] = tone;
				buf[idx + 2] = tone;
			}
		}
	}
	// JPEG で書き出す (実際の Gemini 出力を模す — 圧縮で軽微なノイズが乗る)
	return sharp(buf, { raw: { width: size, height: size, channels } })
		.jpeg({ quality: 92 })
		.toBuffer();
}

describe('removeCheckerboardBackground', () => {
	it('市松模様の背景を alpha=0 にし、彩色オブジェクトは alpha=255 のまま残す', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkerboard-test-'));
		const inputPath = path.join(tmpDir, 'fixture.png');
		const jpegBuf = await makeCheckerboardFixture();
		fs.writeFileSync(inputPath, jpegBuf);

		const result = await removeCheckerboardBackground(inputPath);
		assert.ok(result, 'result should not be null');
		assert.equal(result.width, 128);
		assert.equal(result.height, 128);

		// bg ratio: 背景 (128*128 - 32*32) / (128*128) ≈ 0.9375 のはず。緩めの許容 (JPEG ノイズ考慮)。
		assert.ok(result.bgRatio > 0.7, `bgRatio too low: ${result.bgRatio}`);

		// 中央オブジェクト (彩色) は不透明のまま
		const centerIdx = (64 * 128 + 64) * 4;
		assert.equal(result.buffer[centerIdx + 3], 255, 'center (colored object) should stay opaque');
		assert.equal(result.buffer[centerIdx], 220, 'center RGB should be preserved');

		// 四隅 (checkerboard 背景) は透明
		const cornerIdx = (2 * 128 + 2) * 4;
		assert.equal(
			result.buffer[cornerIdx + 3],
			0,
			'corner (checkerboard bg) should become transparent',
		);

		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('CLI toFile 経由で書き出すと sharp.metadata().hasAlpha === true になる', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkerboard-test-'));
		const inputPath = path.join(tmpDir, 'fixture.png');
		fs.writeFileSync(inputPath, await makeCheckerboardFixture());

		const result = await removeCheckerboardBackground(inputPath);
		const outPath = path.join(tmpDir, 'out.png');
		await sharp(result.buffer, { raw: { width: result.width, height: result.height, channels: 4 } })
			.png()
			.toFile(outPath);

		const meta = await sharp(outPath).metadata();
		assert.equal(meta.hasAlpha, true);
		assert.equal(meta.format, 'png');

		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('無彩色サンプルが無い画像 (単色の彩色画像) は null を返す', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkerboard-test-'));
		const inputPath = path.join(tmpDir, 'fixture.png');
		const size = 64;
		const channels = 3;
		const buf = Buffer.alloc(size * size * channels);
		for (let i = 0; i < size * size; i++) {
			buf[i * channels] = 200;
			buf[i * channels + 1] = 30;
			buf[i * channels + 2] = 30;
		}
		fs.writeFileSync(
			inputPath,
			await sharp(buf, { raw: { width: size, height: size, channels } })
				.png()
				.toBuffer(),
		);

		const result = await removeCheckerboardBackground(inputPath);
		assert.equal(result, null);

		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});
