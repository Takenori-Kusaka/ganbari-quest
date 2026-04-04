import { describe, expect, it } from 'vitest';
import {
	detectMimeType,
	validateAudioMagicBytes,
	validateBase64ImageMagicBytes,
	validateImageMagicBytes,
} from '$lib/server/security/magic-bytes';

describe('detectMimeType', () => {
	it('JPEG を検出する', () => {
		const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		expect(detectMimeType(data, 'image')).toBe('image/jpeg');
	});

	it('PNG を検出する', () => {
		const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(detectMimeType(data, 'image')).toBe('image/png');
	});

	it('WebP を検出する', () => {
		// RIFF....WEBP
		const data = new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
		]);
		expect(detectMimeType(data, 'image')).toBe('image/webp');
	});

	it('MP3 (ID3) を検出する', () => {
		const data = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
		expect(detectMimeType(data, 'audio')).toBe('audio/mpeg');
	});

	it('MP3 (sync word) を検出する', () => {
		const data = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
		expect(detectMimeType(data, 'audio')).toBe('audio/mpeg');
	});

	it('WAV を検出する', () => {
		// RIFF....WAVE
		const data = new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
		]);
		expect(detectMimeType(data, 'audio')).toBe('audio/wav');
	});

	it('OGG を検出する', () => {
		const data = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]);
		expect(detectMimeType(data, 'audio')).toBe('audio/ogg');
	});

	it('M4A (ftyp) を検出する', () => {
		// ....ftyp
		const data = new Uint8Array([
			0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
		]);
		expect(detectMimeType(data, 'audio')).toBe('audio/mp4');
	});

	it('WebM を検出する', () => {
		const data = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93]);
		expect(detectMimeType(data, 'audio')).toBe('audio/webm');
	});

	it('不明なバイト列は null を返す', () => {
		const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
		expect(detectMimeType(data, 'image')).toBeNull();
	});

	it('空データは null を返す', () => {
		const data = new Uint8Array([]);
		expect(detectMimeType(data, 'image')).toBeNull();
	});
});

describe('validateImageMagicBytes', () => {
	it('正しい JPEG は valid', () => {
		const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
		expect(validateImageMagicBytes(data, 'image/jpeg')).toEqual({ valid: true });
	});

	it('正しい PNG は valid', () => {
		const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(validateImageMagicBytes(data, 'image/png')).toEqual({ valid: true });
	});

	it('JPEG を PNG と宣言すると invalid', () => {
		const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
		const result = validateImageMagicBytes(data, 'image/png');
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.detected).toBe('image/jpeg');
		}
	});

	it('不明なデータは invalid', () => {
		const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
		const result = validateImageMagicBytes(data, 'image/jpeg');
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.detected).toBeNull();
		}
	});
});

describe('validateAudioMagicBytes', () => {
	it('正しい MP3 (ID3) は valid', () => {
		const data = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
		expect(validateAudioMagicBytes(data, 'audio/mpeg')).toEqual({ valid: true });
	});

	it('audio/x-m4a は audio/mp4 のエイリアスとして扱う', () => {
		const data = new Uint8Array([
			0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
		]);
		expect(validateAudioMagicBytes(data, 'audio/x-m4a')).toEqual({ valid: true });
	});

	it('OGG データを MP3 と宣言すると invalid', () => {
		const data = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]);
		const result = validateAudioMagicBytes(data, 'audio/mpeg');
		expect(result.valid).toBe(false);
	});
});

describe('validateBase64ImageMagicBytes', () => {
	it('JPEG の base64 を検証できる', () => {
		// FF D8 FF E0 → /9j/4A== in base64
		const base64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
		expect(validateBase64ImageMagicBytes(base64, 'image/jpeg')).toEqual({ valid: true });
	});

	it('PNG の base64 を検証できる', () => {
		const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
		expect(validateBase64ImageMagicBytes(base64, 'image/png')).toEqual({ valid: true });
	});

	it('テキストデータを画像と宣言すると invalid', () => {
		const base64 = Buffer.from('Hello, World!').toString('base64');
		const result = validateBase64ImageMagicBytes(base64, 'image/jpeg');
		expect(result.valid).toBe(false);
	});
});
