// ファイルサニタイズ — アップロードファイルからメタデータ・埋め込みペイロードを除去する
// Polyglot攻撃、EXIFインジェクション、ID3タグインジェクションへの防御

import { logger } from '$lib/server/logger';

/**
 * 画像を re-encode してメタデータ・埋め込みペイロードを完全に除去する
 * Sharp はデコード→ピクセルデータ→再エンコードを行い、EXIF/XMP/コメント等を全て消す
 * Note: sharp は動的 import（ネイティブモジュールのため、未使用ページでクラッシュ防止）
 */
export async function sanitizeImage(
	data: Buffer,
	mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
	const { default: sharp } = await import('sharp');
	let pipeline = sharp(data);

	switch (mimeType) {
		case 'image/jpeg':
			pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
			break;
		case 'image/png':
			pipeline = pipeline.png({ compressionLevel: 6 });
			break;
		case 'image/webp':
			pipeline = pipeline.webp({ quality: 90 });
			break;
		default:
			throw new Error(`Unsupported image type for sanitization: ${mimeType}`);
	}

	const buffer = await pipeline.toBuffer();
	return { buffer, mimeType };
}

/**
 * MP3 の ID3v2 タグを除去する（ID3v2 はファイル先頭にある）
 * ID3v2 ヘッダーフォーマット: "ID3" + version(2bytes) + flags(1byte) + size(4bytes syncsafe)
 */
export function stripId3v2Tag(data: Buffer): Buffer {
	if (data.length < 10) return data;

	// ID3v2 ヘッダーチェック
	if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) {
		return data; // ID3v2 タグなし
	}

	// syncsafe integer でタグサイズを読む（先頭10バイト + タグ本体）
	const b6 = data[6] ?? 0;
	const b7 = data[7] ?? 0;
	const b8 = data[8] ?? 0;
	const b9 = data[9] ?? 0;
	const size = ((b6 & 0x7f) << 21) | ((b7 & 0x7f) << 14) | ((b8 & 0x7f) << 7) | (b9 & 0x7f);
	const tagEnd = 10 + size;

	if (tagEnd >= data.length) {
		return data; // タグが壊れている場合はそのまま返す
	}

	logger.debug('[file-sanitizer] ID3v2 tag stripped', { context: { tagSize: tagEnd } });
	return data.subarray(tagEnd);
}

/**
 * 音声ファイルのメタデータを可能な範囲で除去する
 * MP3: ID3v2タグを除去
 * その他: マジックバイト検証済みなのでそのまま返す（WAV/OGG/M4A/WebMのメタデータ攻撃リスクは低い）
 */
export function sanitizeAudio(data: Buffer, mimeType: string): Buffer {
	if (mimeType === 'audio/mpeg') {
		return stripId3v2Tag(data);
	}
	return data;
}

/** 配信時に安全な Content-Type かどうかをチェックする */
const SAFE_CONTENT_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/svg+xml',
	'audio/mpeg',
	'audio/mp4',
	'audio/wav',
	'audio/webm',
	'audio/ogg',
	'audio/x-m4a',
]);

/**
 * Content-Type をホワイトリストで検証し、不明な場合は安全なフォールバックを返す
 */
export function safeContentType(contentType: string): string {
	return SAFE_CONTENT_TYPES.has(contentType) ? contentType : 'application/octet-stream';
}
