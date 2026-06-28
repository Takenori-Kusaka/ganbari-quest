// src/lib/server/services/backup-manifest.ts
// #3375 (EPIC #3374 Sub-1): バックアップ ZIP の整合性マニフェスト。
//
// 背景: 全体バックアップ ZIP は data.json + 静的ファイル (avatars/voices/generated) を同梱するが、
// 既存の checksum (#1254 G4 / export-format.ts ExportData.checksum) は **data.json の論理内容のみ**を
// 保護し、**同梱した静的バイナリ (画像等) は無保護**だった。途中欠損・破損・改竄した画像が import で
// サイレントに復元され得る。本モジュールは ZIP 内の **全エントリ (data.json 含む) の SHA-256 + バイト数**を
// manifest.json に記録し、import 前に照合して破損を検出する (deep research: SHA-256 manifest が
// Pre-PMF 現実解。Reed-Solomon/par2 は過剰 / ADR-0010)。
//
// 後方互換: manifest.json を持たない旧 ZIP / 旧 JSON バックアップは検証スキップ (従来どおり復元可)。
// formatVersion: dataVersion (ExportData.version) を併記し、将来の復元マイグレーション dispatch の
// 起点にする (本 Sub では枠組みのみ。実際のデータ移行は export-format の optional フィールド後方互換が担う)。

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
	/** 同梱 data.json の ExportData.version (将来の復元マイグレーション dispatch 用)。 */
	dataVersion: string;
	/** 生成時刻 (ISO8601)。 */
	createdAt: string;
	/** path → 整合性情報 (data.json と全静的ファイルを含む)。 */
	files: Record<string, BackupManifestFileEntry>;
	/** 主要エンティティの件数 (破損・部分欠損の sanity check 用)。 */
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
 * @param dataVersion 同梱 data.json の ExportData.version。
 * @param itemCounts 主要エンティティ件数。
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
	| { ok: false; reason: 'missing-file' | 'size-mismatch' | 'checksum-mismatch'; path: string };

/**
 * 展開済み ZIP エントリ群を manifest と照合する (#3375)。
 *
 * manifest.files の各エントリについて (a) ZIP 内に存在する (b) バイト数一致 (c) SHA-256 一致 を検証する。
 * 1 件でも不一致なら破損として失敗を返す。manifest に無い余剰ファイルは検証対象外
 * (importStaticFiles 側の zip-slip / path 検証で別途守られる)。
 *
 * @param entries 展開済み ZIP エントリ (path → bytes、manifest.json 自体は呼び出し側で除外して渡してよい)。
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
