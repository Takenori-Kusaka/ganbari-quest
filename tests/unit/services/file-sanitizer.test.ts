import {
	safeContentType,
	sanitizeAudio,
	sanitizeImage,
	stripId3v2Tag,
} from '$lib/server/security/file-sanitizer';
import { describe, expect, it } from 'vitest';

describe('sanitizeImage', () => {
	it('JPEG を re-encode できる', async () => {
		// 1x1 赤ピクセルの最小 JPEG（sharp が処理可能な有効な画像）
		const sharp = (await import('sharp')).default;
		const original = await sharp({
			create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
		})
			.jpeg()
			.toBuffer();

		const result = await sanitizeImage(original, 'image/jpeg');
		expect(result.mimeType).toBe('image/jpeg');
		expect(result.buffer.length).toBeGreaterThan(0);
		// re-encode されるのでバイト列は異なる可能性がある
		expect(result.buffer[0]).toBe(0xff); // JPEG マジックバイト
		expect(result.buffer[1]).toBe(0xd8);
	});

	it('PNG を re-encode できる', async () => {
		const sharp = (await import('sharp')).default;
		const original = await sharp({
			create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
		})
			.png()
			.toBuffer();

		const result = await sanitizeImage(original, 'image/png');
		expect(result.mimeType).toBe('image/png');
		expect(result.buffer[0]).toBe(0x89); // PNG マジックバイト
	});

	it('WebP を re-encode できる', async () => {
		const sharp = (await import('sharp')).default;
		const original = await sharp({
			create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 255, b: 0 } },
		})
			.webp()
			.toBuffer();

		const result = await sanitizeImage(original, 'image/webp');
		expect(result.mimeType).toBe('image/webp');
		expect(result.buffer[0]).toBe(0x52); // RIFF
	});

	it('EXIF メタデータが除去される', async () => {
		const sharp = (await import('sharp')).default;
		// EXIF 付き JPEG を作成
		const withExif = await sharp({
			create: { width: 10, height: 10, channels: 3, background: { r: 128, g: 128, b: 128 } },
		})
			.jpeg()
			.withMetadata({ exif: { IFD0: { Copyright: 'Test metadata that should be removed' } } })
			.toBuffer();

		const result = await sanitizeImage(withExif, 'image/jpeg');
		// re-encode 後のメタデータを確認
		const metadata = await sharp(result.buffer).metadata();
		expect(metadata.exif).toBeUndefined();
	});

	it('不正な画像データではエラーを投げる', async () => {
		const invalidData = Buffer.from('not an image');
		await expect(sanitizeImage(invalidData, 'image/jpeg')).rejects.toThrow();
	});

	it('サポートされないMIMEタイプではエラーを投げる', async () => {
		const sharp = (await import('sharp')).default;
		const valid = await sharp({
			create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
		})
			.jpeg()
			.toBuffer();

		await expect(sanitizeImage(valid, 'image/gif')).rejects.toThrow(
			'Unsupported image type for sanitization',
		);
	});
});

describe('stripId3v2Tag', () => {
	it('ID3v2 タグを除去する', () => {
		// ID3v2.3 ヘッダー + 100バイトのタグデータ + MP3 sync word
		const tagSize = 100;
		const header = Buffer.alloc(10);
		header[0] = 0x49; // 'I'
		header[1] = 0x44; // 'D'
		header[2] = 0x33; // '3'
		header[3] = 0x03; // version major
		header[4] = 0x00; // version minor
		header[5] = 0x00; // flags
		// syncsafe size encoding: 100 = 0b1100100
		header[6] = 0x00;
		header[7] = 0x00;
		header[8] = 0x00;
		header[9] = tagSize & 0x7f;

		const tagData = Buffer.alloc(tagSize, 0x42); // タグ本体（'B' で埋め）
		const audioData = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]); // MP3 sync word

		const input = Buffer.concat([header, tagData, audioData]);
		const result = stripId3v2Tag(input);

		// タグが除去され、音声データだけ残る
		expect(result.length).toBe(audioData.length);
		expect(result[0]).toBe(0xff);
		expect(result[1]).toBe(0xfb);
	});

	it('ID3v2 タグがないデータはそのまま返す', () => {
		const data = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
		const result = stripId3v2Tag(data);
		expect(result).toEqual(data);
	});

	it('空データはそのまま返す', () => {
		const data = Buffer.alloc(0);
		const result = stripId3v2Tag(data);
		expect(result.length).toBe(0);
	});

	it('10バイト未満のデータはそのまま返す', () => {
		const data = Buffer.from([0x49, 0x44, 0x33]);
		const result = stripId3v2Tag(data);
		expect(result).toEqual(data);
	});
});

describe('sanitizeAudio', () => {
	it('MP3 の ID3v2 タグを除去する', () => {
		const header = Buffer.alloc(10);
		header[0] = 0x49;
		header[1] = 0x44;
		header[2] = 0x33;
		header[3] = 0x03;
		header[9] = 10; // 10バイトのタグ
		const tag = Buffer.alloc(10, 0x00);
		const audio = Buffer.from([0xff, 0xfb]);
		const input = Buffer.concat([header, tag, audio]);

		const result = sanitizeAudio(input, 'audio/mpeg');
		expect(result[0]).toBe(0xff);
		expect(result[1]).toBe(0xfb);
	});

	it('非 MP3 はそのまま返す', () => {
		const data = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // OGG
		const result = sanitizeAudio(data, 'audio/ogg');
		expect(result).toEqual(data);
	});
});

describe('safeContentType', () => {
	it('安全な Content-Type はそのまま返す', () => {
		expect(safeContentType('image/jpeg')).toBe('image/jpeg');
		expect(safeContentType('image/png')).toBe('image/png');
		expect(safeContentType('audio/mpeg')).toBe('audio/mpeg');
	});

	it('不明な Content-Type は application/octet-stream にフォールバック', () => {
		expect(safeContentType('text/html')).toBe('application/octet-stream');
		expect(safeContentType('application/javascript')).toBe('application/octet-stream');
		expect(safeContentType('')).toBe('application/octet-stream');
	});
});
