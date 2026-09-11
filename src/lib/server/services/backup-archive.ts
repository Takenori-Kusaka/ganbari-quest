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
import { SETTINGS_LABELS } from '$lib/domain/labels';
import { logger } from '$lib/server/logger';
import { listFiles, readFile } from '$lib/server/storage';
import { RECOVERY_PREFIX_SEGMENT, tenantPrefix } from '$lib/server/storage-keys';
import {
	BACKUP_MANIFEST_FILENAME,
	type BackupManifest,
	buildBackupManifest,
	parseBackupManifest,
	verifyBackupManifest,
} from './backup-manifest';

// ZIP サイズ上限。**圧縮後 (= 実際に保管 / 転送される ZIP バイト列) の上限** (#3077 / #3405)。
// #3405-1: 旧実装はこの上限を data.json + 静的ファイルの **非圧縮合計** に対して判定していたため、
// deflate で実 ZIP が余裕で収まる正当 backup (巨大だが高圧縮な data.json 等) を誤 reject していた
// (silent loss を false-positive throw に trade)。判定を **結果 ZIP サイズ基準** に是正する。
export const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB（構築後 ZIP バイト列の上限）

// #3078 zip-bomb 防御 + #3405-3 build/parse 対称化: 展開後 (uncompressed) サイズ上限。
// build (buildFullBackupZip) と parse (parseBackupZip) の双方が同一定数を参照し、
// 「build が作れる ZIP は必ず parse で復元できる」対称性を担保する (export SSOT)。
// - per-entry (25MB): 個々の静的ファイル (avatar/voice) 単体の上限。data.json / manifest.json は
//   構造化データで大きくなり得るため per-entry 対象外 (合計上限で bound する)。
// - total (200MB): 展開後合計の上限 (メモリ / zip-bomb 防御)。
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // 静的エントリ単体 25MB
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 展開後合計 200MB

/** per-entry / total 上限の対象外 (構造化データは合計上限のみで bound する)。 */
function isStructuralEntry(path: string): boolean {
	return path === 'data.json' || path === BACKUP_MANIFEST_FILENAME;
}

/**
 * #3376 fail-closed: フルバックアップ同梱対象 (data.json + 静的ファイル) が上限を超えたときに throw する
 * 番兵 error。
 *
 * 旧実装は上限到達時に残りの静的ファイルを silent skip し、manifest を **truncated set から構築**して
 * いた。結果「フルバックアップ」と銘打ちながら再生成不能な avatar/voice が無警告で欠落し、manifest /
 * verifyBackupManifest も「truncated set 内で完全整合」と判定して検証を素通りしていた (#3379 と同型の
 * 「manifest = 内部整合のみ」教訓の再発)。本 error で不完全な ZIP を生成せず親に明示する。
 *
 * #3405: 上限種別で userMessage を出し分ける。
 * - total (既定): 結果 ZIP が {@link MAX_ZIP_SIZE} を超過。
 * - entry: 個々の静的ファイルが {@link MAX_ENTRY_UNCOMPRESSED_BYTES} を超過 (parse 側 filter と対称)。
 *
 * 呼び出し元 (export/+server / export/cloud/+server) は本 error を捕捉してユーザー向け文言
 * (labels SSOT、ADR-0062) を返す。
 */
export class BackupSizeLimitError extends Error {
	/** ユーザー向け文言 (labels SSOT、内部例外を露出しない / ADR-0062)。 */
	readonly userMessage: string;
	constructor(userMessage?: string) {
		const maxMb = Math.floor(MAX_ZIP_SIZE / (1024 * 1024));
		const message = userMessage ?? SETTINGS_LABELS.dataExportTooLarge(String(maxMb));
		super(message);
		this.name = 'BackupSizeLimitError';
		this.userMessage = message;
	}

	/** #3405-3: 静的ファイル単体が per-entry 上限を超えたときの error。 */
	static forEntry(): BackupSizeLimitError {
		const maxMb = Math.floor(MAX_ENTRY_UNCOMPRESSED_BYTES / (1024 * 1024));
		return new BackupSizeLimitError(SETTINGS_LABELS.dataExportEntryTooLarge(String(maxMb)));
	}
}

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
 * - 静的ファイル (avatars/voices/generated) を storage から収集する。以下は **silent skip せず
 *   {@link BackupSizeLimitError} を throw**（fail-closed、#3376 / #3405）:
 *     - #3405-3: 静的ファイル単体が {@link MAX_ENTRY_UNCOMPRESSED_BYTES} 超過 (parse 側の per-entry
 *       filter と対称化。build が per-entry 無制限だと 25MB 超 entry を含む ZIP を作れてしまい、
 *       parse 側 filter が silent drop → manifest 不整合で復元不能 dead-end になる #3405-3 を根治)。
 *     - 展開後合計が {@link MAX_TOTAL_UNCOMPRESSED_BYTES} 超過 (メモリ / zip-bomb 防御、parse と対称)。
 *     - #3405-1: **構築後 ZIP** が {@link MAX_ZIP_SIZE} 超過 (圧縮後サイズ基準。非圧縮合計での誤 reject を撤廃)。
 *   「フルバックアップ」の意味論を守り、再生成不能な avatar/voice が無警告で欠落した不完全 ZIP を作らない。
 * - #3375: manifest.json に全エントリの SHA-256 + バイト数 + dataVersion + itemCounts を記録。
 * - per-entry 圧縮制御: 既圧縮画像 = store(level 0) / 構造化(data.json/manifest.json) = deflate(level 6)。
 *
 * ローカル DL (export/+server.ts) とクラウド full export (cloud-export-service) が共有する。
 *
 * @param dataJson #3518-1: 直列化済みの data.json 文字列。指定時は再 stringify せず流用する
 *   (export-service が checksum 計算と同一直列化を使い回すことで二重 JSON.stringify を解消する)。
 *   未指定時は従来どおり `exportData` を stringify する (後方互換)。
 * @returns ZIP バイト列。
 * @throws {BackupSizeLimitError} 静的ファイル単体 / 展開後合計 / 構築後 ZIP のいずれかが上限を超える場合。
 */
export async function buildFullBackupZip(
	tenantId: string,
	exportData: ExportData,
	compact: boolean,
	dataJson?: string,
): Promise<Uint8Array> {
	const { zipSync, strToU8 } = await import('fflate');

	const files: Record<string, Uint8Array> = {};

	// 1. data.json (#3518-1: 直列化済み文字列があれば流用、無ければ stringify)
	const jsonStr =
		dataJson ?? (compact ? JSON.stringify(exportData) : JSON.stringify(exportData, null, 2));
	files['data.json'] = strToU8(jsonStr);
	// data.json (構造化データ) は per-entry 対象外。展開後合計上限のみで bound する (#3405)。
	let totalUncompressed = files['data.json'].length;
	if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
		throw new BackupSizeLimitError();
	}

	// 2. 静的ファイル（S3/ローカルストレージ）。既圧縮画像のため store で同梱する。
	const staticPaths = new Set<string>();
	try {
		const prefix = tenantPrefix(tenantId);
		// #4720: 置換インポートの復旧用 snapshot (tenants/<id>/recovery/*.zip) は backup の対象外
		// (含めると backup の中に過去の backup が入れ子になり肥大化する)。
		const fileKeys = (await listFiles(prefix)).filter(
			(key) => !key.startsWith(`${prefix}${RECOVERY_PREFIX_SEGMENT}`),
		);
		for (const key of fileKeys) {
			const fileData = await readFile(key);
			if (fileData) {
				const relativePath = key.replace(prefix, '');
				const entryLen = fileData.data.length;
				// #3405-3 fail-closed: per-entry 上限超過は build 時点で明示エラー (parse 側 filter と対称)。
				// 25MB 超 entry を含む ZIP を作らせないことで「build 成功 → import で当該 entry を silent
				// drop → manifest 不整合で復元不能」の dead-end を根治する。
				if (entryLen > MAX_ENTRY_UNCOMPRESSED_BYTES) {
					throw BackupSizeLimitError.forEntry();
				}
				files[relativePath] = new Uint8Array(fileData.data);
				staticPaths.add(relativePath);
				totalUncompressed += entryLen;
				// 展開後合計上限 (メモリ / zip-bomb 防御、parse と対称)。silent skip せず明示エラー。
				if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
					throw new BackupSizeLimitError();
				}
			}
		}
	} catch (err) {
		// fail-closed の番兵 error は storage 失敗の graceful degrade (JSON のみ) に巻き込まない。
		if (err instanceof BackupSizeLimitError) throw err;
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
	const zip = zipSync(zipEntries);

	// #3405-1: 判定は **構築後 ZIP (圧縮後)** サイズ基準。deflate で収まる正当 backup を非圧縮合計で
	// 誤 reject しない。上限超過なら不完全な部分バックアップを返さず fail-closed で明示エラーにする。
	if (zip.length > MAX_ZIP_SIZE) {
		throw new BackupSizeLimitError();
	}
	return zip;
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
			// #3405-3 build/parse 対称化: per-entry 上限は静的ファイル (avatar/voice) のみに適用する。
			// data.json / manifest.json (構造化データ) は大きくなり得るため per-entry 対象外にし、
			// 展開後合計上限 (下記 MAX_TOTAL_UNCOMPRESSED_BYTES) のみで bound する。旧実装は data.json も
			// 25MB で filter していたため、25MB 超の正当 data.json が silent drop → 「data.json 不在」で
			// 復元不能になっていた (#3405-1 で許容する巨大 backup と整合しない矛盾を根治)。
			filter: (file) =>
				isStructuralEntry(file.name) || file.originalSize <= MAX_ENTRY_UNCOMPRESSED_BYTES,
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

	// #3386: itemCounts 件数照合 (選択肢 B の配線)。manifest.itemCounts (エクスポート時の主要エンティティ件数)
	// と、実際に data.json から数え直した件数が食い違えば、data.json 側の部分欠損 (途中切詰め/改竄) として
	// fail-closed で弾く。件数不一致は「ファイルの一部が欠けている」旨の汎用文言を返し、内部差分は log のみ。
	if (manifestCheck.manifest?.itemCounts) {
		const actual = countExportItems(body as ExportData);
		const countError = findItemCountMismatch(manifestCheck.manifest.itemCounts, actual);
		if (countError) {
			logger.warn('[backup-archive] itemCounts 照合に失敗 (data.json 部分欠損の疑い)', {
				context: countError,
			});
			return { ok: false, error: SETTINGS_LABELS.dataImportBackupCountMismatch };
		}
	}

	return { ok: true, value: { body, staticFiles: collectStaticFiles(entries) } };
}

/**
 * #3386: manifest.itemCounts と data.json 実件数を照合し、最初の不一致 key を返す (一致なら null)。
 * manifest に記載のある key のみ照合する (将来 key 追加時の後方互換: 旧 backup に無い key は無視)。
 */
function findItemCountMismatch(
	expected: Record<string, number>,
	actual: Record<string, number>,
): { key: string; expected: number; actual: number } | null {
	for (const [key, expectedCount] of Object.entries(expected)) {
		const actualCount = actual[key] ?? 0;
		if (actualCount !== expectedCount) {
			return { key, expected: expectedCount, actual: actualCount };
		}
	}
	return null;
}

/**
 * #3375: 展開済み ZIP エントリに manifest.json があれば整合性照合する。
 * manifest が無い旧 ZIP は検証スキップ（後方互換）で ok を返す（manifest は undefined）。
 *
 * #3386 (ADR-0062): ユーザーに返す `error` は内部 reason コード (`checksum-mismatch` /
 * `size-mismatch` / `missing-file` / `unexpected-file`) と生パスを **露出させない** 汎用文言にする。
 * 内部 reason / path は診断用に logger にのみ残す (監視で追える + 保護者には無害な文言を出す)。
 */
async function verifyManifestIfPresent(
	entries: Record<string, Uint8Array>,
): Promise<{ ok: true; manifest?: BackupManifest } | { ok: false; error: string }> {
	const manifestBytes = entries[BACKUP_MANIFEST_FILENAME];
	if (!manifestBytes) return { ok: true };

	const manifest = parseBackupManifest(manifestBytes);
	if (!manifest) {
		logger.warn('[backup-archive] manifest.json のパース/構造検証に失敗', {});
		return { ok: false, error: SETTINGS_LABELS.dataImportManifestCorrupt };
	}

	const entriesForVerify: Record<string, Uint8Array> = {};
	for (const [path, bytes] of Object.entries(entries)) {
		if (path === BACKUP_MANIFEST_FILENAME) continue;
		entriesForVerify[path] = bytes;
	}

	const verdict = await verifyBackupManifest(entriesForVerify, manifest);
	if (!verdict.ok) {
		// 内部 reason / path は診断用 log のみ。ユーザー文言では露出しない (ADR-0062)。
		logger.warn('[backup-archive] manifest 整合性検証に失敗', {
			context: { reason: verdict.reason, path: verdict.path },
		});
		const error =
			verdict.reason === 'unexpected-file'
				? SETTINGS_LABELS.dataImportBackupUnexpectedFile
				: SETTINGS_LABELS.dataImportBackupCorrupt;
		return { ok: false, error };
	}
	return { ok: true, manifest };
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
