// マジックバイト検証 — Content-Type の偽装を検出する
// ファイル先頭バイトを確認し、実際のファイル形式を判定する

/** マジックバイトのシグネチャ定義 */
interface MagicSignature {
	mime: string;
	bytes: number[];
	offset?: number;
}

const IMAGE_SIGNATURES: MagicSignature[] = [
	// JPEG: FF D8 FF
	{ mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	{ mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	// WebP: RIFF....WEBP
	{ mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" prefix; WEBP at offset 8 checked separately
];

const AUDIO_SIGNATURES: MagicSignature[] = [
	// MP3: ID3 tag or MPEG sync word
	{ mime: 'audio/mpeg', bytes: [0x49, 0x44, 0x33] }, // "ID3"
	{ mime: 'audio/mpeg', bytes: [0xff, 0xfb] }, // MPEG sync
	{ mime: 'audio/mpeg', bytes: [0xff, 0xf3] }, // MPEG sync (Layer III)
	{ mime: 'audio/mpeg', bytes: [0xff, 0xf2] }, // MPEG sync
	// WAV: RIFF....WAVE
	{ mime: 'audio/wav', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
	// OGG (Vorbis/Opus): OggS
	{ mime: 'audio/ogg', bytes: [0x4f, 0x67, 0x67, 0x53] }, // "OggS"
	// M4A/MP4: ftyp at offset 4
	{ mime: 'audio/mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp"
	// WebM: EBML header (1A 45 DF A3)
	{ mime: 'audio/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
];

function matchesSignature(data: Uint8Array, sig: MagicSignature): boolean {
	const offset = sig.offset ?? 0;
	if (data.length < offset + sig.bytes.length) return false;
	return sig.bytes.every((byte, i) => data[offset + i] === byte);
}

/**
 * バイナリデータからファイル形式を推定する
 * @returns 検出された MIME タイプ、または null（不明な形式）
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
export function detectMimeType(
	data: Uint8Array | Buffer,
	category: 'image' | 'audio',
): string | null {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	const signatures = category === 'image' ? IMAGE_SIGNATURES : AUDIO_SIGNATURES;

	for (const sig of signatures) {
		if (matchesSignature(bytes, sig)) {
			// WebP: RIFF prefix + "WEBP" at offset 8
			if (sig.mime === 'image/webp' && bytes.length >= 12) {
				if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
					return 'image/webp';
				}
				continue; // RIFF but not WEBP → might be WAV
			}
			// WAV: RIFF prefix + "WAVE" at offset 8
			if (sig.mime === 'audio/wav' && bytes.length >= 12) {
				if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
					return 'audio/wav';
				}
				continue; // RIFF but not WAVE → might be WebP
			}
			return sig.mime;
		}
	}

	return null;
}

/** 画像ファイルの MIME タイプを宣言値とマジックバイトで二重検証 */
export function validateImageMagicBytes(
	data: Uint8Array | Buffer,
	declaredMime: string,
): { valid: true } | { valid: false; detected: string | null } {
	const detected = detectMimeType(data, 'image');
	if (!detected) {
		return { valid: false, detected: null };
	}
	// 宣言された MIME タイプと一致するか（正規化して比較）
	const normalizedDeclared = declaredMime.toLowerCase().trim();
	const normalizedDetected = detected.toLowerCase();
	if (normalizedDeclared !== normalizedDetected) {
		return { valid: false, detected };
	}
	return { valid: true };
}

/** 音声ファイルの MIME タイプを宣言値とマジックバイトで二重検証 */
export function validateAudioMagicBytes(
	data: Uint8Array | Buffer,
	declaredMime: string,
): { valid: true } | { valid: false; detected: string | null } {
	const detected = detectMimeType(data, 'audio');
	if (!detected) {
		return { valid: false, detected: null };
	}
	// MIME タイプの正規化（audio/x-m4a → audio/mp4, audio/m4a → audio/mp4 等）
	const mimeAliases: Record<string, string> = {
		'audio/x-m4a': 'audio/mp4',
		'audio/m4a': 'audio/mp4',
		'audio/mp4a-latm': 'audio/mp4',
		'audio/x-wav': 'audio/wav',
		'audio/wave': 'audio/wav',
		'audio/vnd.wave': 'audio/wav',
		'audio/x-ogg': 'audio/ogg',
		'audio/vorbis': 'audio/ogg',
		'audio/opus': 'audio/ogg',
	};
	const normalizedDeclared =
		mimeAliases[declaredMime.toLowerCase().trim()] ?? declaredMime.toLowerCase().trim();
	const normalizedDetected = mimeAliases[detected.toLowerCase()] ?? detected.toLowerCase();
	if (normalizedDeclared !== normalizedDetected) {
		return { valid: false, detected };
	}
	return { valid: true };
}

/**
 * base64 文字列の先頭からマジックバイトを検証する
 * ocr-receipt エンドポイント用
 */
export function validateBase64ImageMagicBytes(
	base64Data: string,
	declaredMime: string,
): { valid: true } | { valid: false; detected: string | null } {
	// base64 の先頭 16 バイトだけデコードすれば十分
	const headerChars = base64Data.slice(0, 24); // 24 chars → 18 bytes
	const bytes = Buffer.from(headerChars, 'base64');
	return validateImageMagicBytes(bytes, declaredMime);
}
