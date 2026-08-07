// ファイルサニタイズ — アップロードファイルからメタデータ・埋め込みペイロードを除去する
// Polyglot攻撃、EXIFインジェクション、ID3タグインジェクションへの防御

import { logger } from '$lib/server/logger';
import { PLACEHOLDER_AVATAR_BASENAME } from '$lib/server/storage-keys';

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

/**
 * inline 配信して安全な (= top-level navigation でも script を実行し得ない) Content-Type。
 * ラスタ画像のみ。SVG は image だが XML 文書として script を実行し得るため除外する (#3105)。
 */
const INLINE_SAFE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * user 由来データの静的配信時に使う Content-Disposition を返す (#3105)。
 *
 * 背景: ZIP import 復元 (#3083) で `image/svg+xml` を `inline` 配信していたため、認証済
 * owner/parent が script 入り SVG を含む ZIP を import → その SVG へ top-level navigation すると
 * CSP `unsafe-inline` 下で inline script が実行される stored XSS が成立していた (avatar 防御の非対称)。
 *
 * 対策: ラスタ画像 (jpeg/png/webp) のみ `inline`、それ以外 (SVG / audio / octet-stream 等) は
 * `attachment` とし、document としてレンダリングさせない (= top-level navigation では download)。
 * `<img src>` 等の subresource 読込は Content-Disposition を無視するため、正規の fallback SVG
 * avatar 等の `<img>` 表示は維持される (script も img 経由 SVG では実行されない)。
 *
 * user データを静的配信する全経路 (tenants / uploads/avatars 等) は本関数を経由すること
 * (横展開 #3105、安全配信ユーティリティへの集約)。
 */
export function safeContentDisposition(contentType: string): 'inline' | 'attachment' {
	return INLINE_SAFE_CONTENT_TYPES.has(contentType) ? 'inline' : 'attachment';
}

/**
 * 固定名キー (内容が差し替わっても URL が変わらない) の max-age。
 *
 * **300 に計測上の根拠はなく、以下の定性判断で置いた値である**:
 * ここを 0 (= 毎回 origin に問い合わせ) にすると、子供一覧を開くたびに人数分の Lambda 呼び出しが
 * 増える。逆に長くすると更新が見えない。仮アバターが変わるのは保護者がニックネーム / テーマを
 * 変えた直後だけなので、その 1 回だけ最大 5 分古く見えるコストを取る。
 *
 * **再取得は 304 ではなく全量転送になる**: 本経路は `ETag` / `Last-Modified` を返しておらず、
 * `readFile()` もバイト列だけを返し metadata を持たないため、条件付き再検証を実装しても
 * Lambda 起動 + storage 読み取りは同じだけ発生し、節約できるのは body の転送量だけである。
 * 仮アバター SVG は実測 480 bytes (`buildPlaceholderAvatarSvg`、256x256 の頭文字 1 文字) なので、
 * ETag 導入で節約できるのは 1 回あたり 0.5KB 程度にとどまる。複雑さに見合わないため導入しない。
 * 写真アバター (数百 KB) は uuid キー = `immutable` で再検証自体が起きないため影響を受けない。
 */
const MUTABLE_ASSET_MAX_AGE_SECONDS = 300;

/** 内容が差し替わっても URL が変わらない (= immutable ではない) キーのファイル名 (拡張子なし)。 */
const MUTABLE_FIXED_NAME_STEMS = new Set<string>([PLACEHOLDER_AVATAR_BASENAME]);

/**
 * user 由来データの静的配信時に使う Cache-Control を返す。
 *
 * **`public` を付けない**: これらの経路は認証 + tenant 一致を通してから配信する
 * (`/tenants/[...path]` の #3133 IDOR ガード / `/uploads/avatars` の所有権 anchor)。`public` は
 * CloudFront・中間 proxy などの**共有**キャッシュに「誰にでも配ってよい」と伝えるディレクティブで、
 * 子供の顔写真という最も配ってはいけないものに付けてはならない。`private` ならブラウザの
 * private cache は従来どおり効くため、顧客体感の速度は落ちない。
 *
 * **`immutable` はキーが実際に immutable なときだけ**: `avatarKey` / `voiceKey` (uuid) と
 * `generatedImageKey` (prompt hash) は内容が変われば URL も変わるので 1 年 immutable が正しい。
 * 一方 `placeholderAvatarKey` は childId ごとの固定名で、ニックネームやテーマを変えると
 * **同じパスの中身が差し替わる** (#4453 で editChild が実際に差し替える)。`avatar_url` には
 * `?v=<中身の版>` が付くため通常の表示経路は即座に切り替わるが、**パス自体は依然 mutable**
 * (版を持たない旧データ / パス直アクセス) なので、ここに 1 年 immutable は付けられない
 * (再検証しないのが immutable の意味)。よって短命 max-age にする。
 *
 * user データを静的配信する全経路は本関数を経由すること (安全配信ユーティリティへの集約、#3105 同様)。
 */
export function safeCacheControl(storagePath: string): string {
	const basename = storagePath.split('/').pop() ?? '';
	const stem = basename.replace(/\.[^.]*$/, '');
	return MUTABLE_FIXED_NAME_STEMS.has(stem)
		? `private, max-age=${MUTABLE_ASSET_MAX_AGE_SECONDS}`
		: 'private, max-age=31536000, immutable';
}
