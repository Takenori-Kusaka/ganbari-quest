// src/lib/server/services/backup-manifest.ts
// #3375 (EPIC #3374 Sub-1): バックアップ ZIP の整合性マニフェスト。
//
// 背景: 全体バックアップ ZIP は data.json + 静的ファイル (avatars/voices/generated) を同梱するが、
// 既存の checksum (#1254 G4 / export-format.ts ExportData.checksum) は **data.json の論理内容のみ**を
// 保護し、**同梱した静的バイナリ (画像等) は無保護**だった。途中欠損・破損した画像が import で
// サイレントに復元され得る。本モジュールは ZIP 内の **全エントリ (data.json 含む) の SHA-256 + バイト数**を
// manifest.json に記録し、import 前に照合して **偶発的破損 (accidental corruption)** を検出する
// (deep research: SHA-256 manifest が Pre-PMF 現実解。Reed-Solomon/par2 は過剰 / ADR-0010)。
//
// 保護対象と非対象 (truth、ADR-0013):
// - 検出できる: 転送/保存中の偶発的破損 (SHA-256 / バイト数の不一致)、manifest 記載ファイルの欠落、
//   manifest 記載外ファイルの混入 (注入)。
// - 検出できない (将来スコープ): **意図的改竄の防止**。manifest は未署名のため、攻撃者は改竄後に
//   manifest を再計算でき検証を通せる。また manifest.json を削除した旧 ZIP は後方互換で検証スキップ
//   される (downgrade)。改竄防止が必要になったら署名 (HMAC / 公開鍵) を別途導入する。
//
// 後方互換: manifest.json を持たない旧 ZIP / 旧 JSON バックアップは検証スキップ (従来どおり復元可)。
//
// dataVersion / itemCounts は manifest に記録するが、**現状 import 側 (verifyBackupManifest /
// verifyManifestIfPresent) では未使用の将来用メタデータ**である (件数照合による部分欠損検査・
// 復元マイグレーション dispatch は未実装。配線時に本コメントを更新する)。

/** manifest 内の 1 エントリの整合性情報。 */
export interface BackupManifestFileEntry {
	/** エントリのバイト数 (展開後)。 */
	bytes: number;
	/** `sha256:<hex>` 形式の SHA-256 ダイジェスト (既存 ExportData.checksum と同形式)。 */
	sha256: string;
}

/** バックアップ ZIP の整合性マニフェスト (manifest.json の中身)。 */
export interface BackupManifest {
	/** マニフェストコンテナ自体のバージョン (本モジュールの形式版)。 */
	manifestVersion: number;
	/** バックアップ識別子。 */
	format: 'ganbari-quest-backup';
	/** 同梱 data.json の ExportData.version。将来用メタデータ (現状 import では未使用)。 */
	dataVersion: string;
	/** 生成時刻 (ISO8601)。 */
	createdAt: string;
	/** path → 整合性情報 (data.json と全静的ファイルを含む)。 */
	files: Record<string, BackupManifestFileEntry>;
	/** 主要エンティティの件数。将来用メタデータ (現状 import では未使用。件数照合による部分欠損検査は未実装)。 */
	itemCounts: Record<string, number>;
}

/** manifest.json の ZIP 内ファイル名。 */
export const BACKUP_MANIFEST_FILENAME = 'manifest.json';

/** manifest コンテナ形式の現行バージョン。 */
export const BACKUP_MANIFEST_VERSION = 1;

/**
 * バイト列の SHA-256 を `sha256:<hex>` 形式で返す (既存 computeChecksum と同形式)。
 * Web Crypto (globalThis.crypto.subtle) を使う (Node 18+ / Lambda / ブラウザ共通)。
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	// SharedArrayBuffer を避けるため ArrayBuffer ビューを明示的に切り出す。
	const view =
		bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
	const digest = await globalThis.crypto.subtle.digest('SHA-256', view as unknown as ArrayBuffer);
	const hashArray = Array.from(new Uint8Array(digest));
	return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * ZIP に同梱する全ファイル (data.json + 静的ファイル) から manifest を構築する。
 *
 * @param files path → bytes (data.json を含む)。
 * @param dataVersion 同梱 data.json の ExportData.version (将来用メタデータ、現状 import 未使用)。
 * @param itemCounts 主要エンティティ件数 (将来用メタデータ、現状 import 未使用)。
 * @param createdAt 生成時刻 ISO8601。
 */
export async function buildBackupManifest(
	files: Record<string, Uint8Array>,
	dataVersion: string,
	itemCounts: Record<string, number>,
	createdAt: string,
): Promise<BackupManifest> {
	const fileEntries: Record<string, BackupManifestFileEntry> = {};
	for (const [path, bytes] of Object.entries(files)) {
		fileEntries[path] = { bytes: bytes.length, sha256: await sha256Hex(bytes) };
	}
	return {
		manifestVersion: BACKUP_MANIFEST_VERSION,
		format: 'ganbari-quest-backup',
		dataVersion,
		createdAt,
		files: fileEntries,
		itemCounts,
	};
}

/** {@link verifyBackupManifest} の結果。 */
export type ManifestVerifyResult =
	| { ok: true }
	| {
			ok: false;
			reason: 'missing-file' | 'size-mismatch' | 'checksum-mismatch' | 'unexpected-file';
			path: string;
	  };

/**
 * 展開済み ZIP エントリ群を manifest と照合する (#3375)。
 *
 * 双方向に集合一致を検証する (fail-closed):
 * - manifest.files の各エントリについて (a) ZIP 内に存在する (b) バイト数一致 (c) SHA-256 一致。
 * - 逆に entries 側に manifest.files へ無いエントリ (= 注入ファイル) があれば `unexpected-file` で失敗。
 *   manifest がある以上「復元対象集合 = manifest 記載集合」を強制し、記載外ファイルの素通り復元を塞ぐ。
 * 1 件でも不一致なら失敗を返す。
 *
 * 注: 本検証は偶発的破損 + 集合不一致 (欠落 / 注入) を検出する。manifest は未署名のため意図的改竄の
 * 防止は対象外 (本ファイル冒頭コメント参照)。
 *
 * @param entries 展開済み ZIP エントリ (path → bytes、manifest.json 自体は呼び出し側で除外して渡すこと)。
 * @param manifest 照合する manifest。
 */
export async function verifyBackupManifest(
	entries: Record<string, Uint8Array>,
	manifest: BackupManifest,
): Promise<ManifestVerifyResult> {
	for (const [path, entry] of Object.entries(manifest.files)) {
		const bytes = entries[path];
		if (!bytes) return { ok: false, reason: 'missing-file', path };
		if (bytes.length !== entry.bytes) return { ok: false, reason: 'size-mismatch', path };
		const actual = await sha256Hex(bytes);
		if (actual !== entry.sha256) return { ok: false, reason: 'checksum-mismatch', path };
	}
	// injection gap の fail-closed 化: entries(復元対象) ⊆ manifest.files を強制する。
	// manifest 記載外のファイルが ZIP に混入していたら拒否し、注入ファイルの素通り復元を防ぐ。
	for (const path of Object.keys(entries)) {
		if (!manifest.files[path]) return { ok: false, reason: 'unexpected-file', path };
	}
	return { ok: true };
}

/**
 * manifest.json の bytes をパースし、最低限の構造検証をして {@link BackupManifest} を返す。
 * 不正構造なら null (= 検証スキップでなく、manifest 破損として呼び出し側でエラーにする想定)。
 */
export function parseBackupManifest(bytes: Uint8Array): BackupManifest | null {
	let obj: unknown;
	try {
		obj = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
	if (typeof obj !== 'object' || obj === null) return null;
	const m = obj as Record<string, unknown>;
	if (m.format !== 'ganbari-quest-backup') return null;
	if (typeof m.manifestVersion !== 'number') return null;
	if (typeof m.files !== 'object' || m.files === null) return null;
	return obj as BackupManifest;
}
