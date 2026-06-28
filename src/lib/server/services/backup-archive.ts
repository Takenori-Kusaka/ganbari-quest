// src/lib/server/services/backup-archive.ts
// #3376 (EPIC #3374 Sub-2): バックアップ ZIP（data.json + 静的ファイル + manifest.json）の
// 構築 / 解析を一元化する共有モジュール。
//
// 背景: 旧来は ZIP 構築が export/+server.ts に、解析が import/+server.ts に重複実装されていた。
// Sub-2 で「クラウドバックアップ（S3）も画像込み ZIP 化」するにあたり、ローカル DL とクラウドで
// 同一の ZIP 形式 / zip-bomb 防御 / manifest 整合性検証を共有する必要があるため抽出した
// (DRY、3 つ目の zip-build/parse site を作らない方針)。
//
// セキュリティ: zip-bomb 防御（per-entry / 合計 上限）+ #3375 manifest 整合性検証を内包する。
// zip-slip 防御は復元側 (import-service.importStaticFiles の isSafeRelativePath) が担う（本モジュールは
// バイト集合の抽出までで、ファイルシステムへは書かない）。

import type { ExportData } from '$lib/domain/export-format';
import { logger } from '$lib/server/logger';
import { listFiles, readFile } from '$lib/server/storage';
import { tenantPrefix } from '$lib/server/storage-keys';
import {
	BACKUP_MANIFEST_FILENAME,
	buildBackupManifest,
	parseBackupManifest,
	verifyBackupManifest,
} from './backup-manifest';

// ZIP サイズ上限。export / import で整合させる (#3077)。
export const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB（構築時の同梱合計上限）
// #3078 zip-bomb 防御: 展開後 (uncompressed) サイズ上限。
const MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // エントリ単体 25MB
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 展開後合計 200MB

/**
 * #3375: ExportData から主要エンティティ件数を数える (manifest の sanity check 用)。
 * sanity 情報であり、export-format の任意フィールド欠落 (旧版 / 部分データ) でも crash させない
 * よう防御的に `?.length ?? 0` で数える。
 */
function countExportItems(exportData: ExportData): Record<string, number> {
	const d = exportData.data;
	return {
		children: exportData.family?.children?.length ?? 0,
		childActivities: d?.childActivities?.length ?? 0,
		activityLogs: d?.activityLogs?.length ?? 0,
		pointLedger: d?.pointLedger?.length ?? 0,
		specialRewards: d?.specialRewards?.length ?? 0,
		checklistTemplates: d?.checklistTemplates?.length ?? 0,
		checklistLogs: d?.checklistLogs?.length ?? 0,
	};
}

/**
 * 全体バックアップ ZIP を構築する（data.json + テナントの静的ファイル + manifest.json）。
 *
 * - 静的ファイル (avatars/voices/generated) を storage から収集し、合計が MAX_ZIP_SIZE を
 *   超えたら以降をスキップ（ログ警告）。
 * - #3375: manifest.json に全エントリの SHA-256 + バイト数 + dataVersion + itemCounts を記録。
 * - per-entry 圧縮制御: 既圧縮画像 = store(level 0) / 構造化(data.json/manifest.json) = deflate(level 6)。
 *
 * ローカル DL (export/+server.ts) とクラウド full export (cloud-export-service) が共有する。
 *
 * @returns ZIP バイト列。
 */
export async function buildFullBackupZip(
	tenantId: string,
	exportData: ExportData,
	compact: boolean,
): Promise<Uint8Array> {
	const { zipSync, strToU8 } = await import('fflate');

	const files: Record<string, Uint8Array> = {};

	// 1. data.json
	const jsonStr = compact ? JSON.stringify(exportData) : JSON.stringify(exportData, null, 2);
	files['data.json'] = strToU8(jsonStr);
	let totalSize = files['data.json'].length;

	// 2. 静的ファイル（S3/ローカルストレージ）。既圧縮画像のため store で同梱する。
	const staticPaths = new Set<string>();
	try {
		const prefix = tenantPrefix(tenantId);
		const fileKeys = await listFiles(prefix);
		for (const key of fileKeys) {
			if (totalSize >= MAX_ZIP_SIZE) {
				logger.warn('[backup-archive] ZIP サイズ上限に到達、残りファイルをスキップ', {
					context: { tenantId, totalSize },
				});
				break;
			}
			const fileData = await readFile(key);
			if (fileData) {
				const relativePath = key.replace(prefix, '');
				files[relativePath] = new Uint8Array(fileData.data);
				staticPaths.add(relativePath);
				totalSize += fileData.data.length;
			}
		}
	} catch (err) {
		logger.warn('[backup-archive] 静的ファイル取得に失敗（JSONのみでバックアップ）', {
			error: String(err),
		});
	}

	// 3. #3375: 整合性 manifest
	const manifest = await buildBackupManifest(
		files,
		exportData.version,
		countExportItems(exportData),
		new Date().toISOString(),
	);
	files[BACKUP_MANIFEST_FILENAME] = strToU8(JSON.stringify(manifest));

	// 4. per-entry 圧縮制御
	const zipEntries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
	for (const [path, bytes] of Object.entries(files)) {
		zipEntries[path] = [bytes, { level: staticPaths.has(path) ? 0 : 6 }];
	}
	return zipSync(zipEntries);
}

/** {@link parseBackupZip} の成功結果。 */
export interface ParsedBackupZip {
	/** data.json をパースした export body（検証は呼び出し側 validateExportData が担う）。 */
	body: unknown;
	/** 復元対象の静的ファイル (相対パス → bytes)。manifest.json / data.json は除外済。 */
	staticFiles: Record<string, Uint8Array>;
}

/**
 * ZIP バイト列を解析し、data.json (body) と静的ファイルを取り出す（#3077 / #3078 / #3375）。
 *
 * - zip-bomb 防御: per-entry / 展開後合計 の上限超過を拒否。
 * - #3375: manifest.json があれば SHA-256 / サイズ / 集合一致を照合し、破損・欠落・混入を検出。
 *   manifest が無い旧 ZIP は検証スキップ（後方互換）。
 *
 * @param zipBytes ZIP バイト列。
 */
export async function parseBackupZip(
	zipBytes: Uint8Array,
): Promise<{ ok: true; value: ParsedBackupZip } | { ok: false; error: string }> {
	let entries: Record<string, Uint8Array>;
	try {
		const { unzipSync } = await import('fflate');
		entries = unzipSync(zipBytes, {
			filter: (file) => file.originalSize <= MAX_ENTRY_UNCOMPRESSED_BYTES,
		});
	} catch {
		return { ok: false, error: 'ZIPの解凍に失敗しました' };
	}

	// #3078 zip-bomb 防御: 展開後合計サイズ上限。
	let totalUncompressed = 0;
	for (const bytes of Object.values(entries)) {
		totalUncompressed += bytes.length;
		if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
			return { ok: false, error: '展開後のファイルサイズが大きすぎます（最大200MB）' };
		}
	}

	const dataJson = entries['data.json'];
	if (!dataJson) {
		return { ok: false, error: 'ZIP内に data.json が見つかりません' };
	}

	// #3375: 整合性 manifest 検証
	const manifestCheck = await verifyManifestIfPresent(entries);
	if (!manifestCheck.ok) {
		return { ok: false, error: manifestCheck.error };
	}

	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(dataJson));
	} catch {
		return { ok: false, error: 'data.json の解析に失敗しました' };
	}

	return { ok: true, value: { body, staticFiles: collectStaticFiles(entries) } };
}

/**
 * #3375: 展開済み ZIP エントリに manifest.json があれば整合性照合する。
 * manifest が無い旧 ZIP は検証スキップ（後方互換）で ok を返す。
 */
async function verifyManifestIfPresent(
	entries: Record<string, Uint8Array>,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const manifestBytes = entries[BACKUP_MANIFEST_FILENAME];
	if (!manifestBytes) return { ok: true };

	const manifest = parseBackupManifest(manifestBytes);
	if (!manifest) {
		return { ok: false, error: 'バックアップの manifest.json が壊れています' };
	}

	const entriesForVerify: Record<string, Uint8Array> = {};
	for (const [path, bytes] of Object.entries(entries)) {
		if (path === BACKUP_MANIFEST_FILENAME) continue;
		entriesForVerify[path] = bytes;
	}

	const verdict = await verifyBackupManifest(entriesForVerify, manifest);
	if (!verdict.ok) {
		const detail =
			verdict.reason === 'unexpected-file'
				? `manifest に記載のないファイルが含まれています（${verdict.path}）`
				: `バックアップが破損しています（${verdict.path}: ${verdict.reason}）`;
		return { ok: false, error: `${detail}。再エクスポートしてください` };
	}
	return { ok: true };
}

/**
 * 展開済み ZIP エントリから復元対象の静的ファイルを抽出する。
 * data.json / manifest.json / ディレクトリエントリ / 空ファイルは除外する。
 */
function collectStaticFiles(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
	const staticFiles: Record<string, Uint8Array> = {};
	for (const [path, bytes] of Object.entries(entries)) {
		if (path === 'data.json' || path === BACKUP_MANIFEST_FILENAME) continue;
		if (path.endsWith('/') || bytes.length === 0) continue;
		staticFiles[path] = bytes;
	}
	return staticFiles;
}

/** ZIP マジックバイト (PK\x03\x04) で ZIP かどうかを判定する（cloud full の zip/json 後方互換判別用）。 */
export function isZipBytes(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}
