// tests/unit/services/backup-archive.test.ts
// #3376 (EPIC #3374 Sub-2): 共有 backup-archive の parseBackupZip / isZipBytes 検証。
// buildFullBackupZip は storage 依存のため、ここでは fflate で同形式の ZIP を組んで
// parseBackupZip の解析・manifest 照合・zip-bomb/欠落検出を固定する。

import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportData } from '../../../src/lib/domain/export-format';
import { SETTINGS_LABELS } from '../../../src/lib/domain/labels';
import {
	BackupSizeLimitError,
	buildFullBackupZip,
	isZipBytes,
	MAX_ENTRY_UNCOMPRESSED_BYTES,
	MAX_ZIP_SIZE,
	parseBackupZip,
} from '../../../src/lib/server/services/backup-archive';
import {
	BACKUP_MANIFEST_FILENAME,
	buildBackupManifest,
} from '../../../src/lib/server/services/backup-manifest';

// #3376: buildFullBackupZip は storage backend (listFiles / readFile) に依存するためモックする。
const mockListFiles = vi.fn();
const mockReadFile = vi.fn();
vi.mock('$lib/server/storage', () => ({
	listFiles: (...a: unknown[]) => mockListFiles(...a),
	readFile: (...a: unknown[]) => mockReadFile(...a),
}));
vi.mock('$lib/server/storage-keys', () => ({
	tenantPrefix: (tenantId: string) => `t/${tenantId}/`,
	// #4720: 置換インポートの復旧用 ZIP (recovery/) は backup 収集から除外される
	RECOVERY_PREFIX_SEGMENT: 'recovery/',
}));
vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const enc = (s: string) => new TextEncoder().encode(s);

const SAMPLE_EXPORT = {
	format: 'ganbari-quest-backup',
	version: '1.3.0',
	exportedAt: '2026-06-28T00:00:00.000Z',
	family: { children: [{ id: '1', nickname: 'テスト' }] },
	data: {},
} as unknown as ExportData;

const VALID_DATA_JSON = JSON.stringify({
	format: 'ganbari-quest-backup',
	version: '1.3.0',
	exportedAt: '2026-06-28T00:00:00.000Z',
});

/** export と同型 (per-entry store/deflate + manifest) の ZIP を組む。 */
async function buildSampleZip(
	files: Record<string, Uint8Array>,
	opts?: { withManifest?: boolean },
): Promise<Uint8Array> {
	const all = { ...files };
	if (opts?.withManifest !== false) {
		const manifest = await buildBackupManifest(files, '1.3.0', {}, '2026-06-28T00:00:00.000Z');
		all[BACKUP_MANIFEST_FILENAME] = enc(JSON.stringify(manifest));
	}
	const zipEntries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
	for (const [p, b] of Object.entries(all)) {
		const isStatic = p !== 'data.json' && p !== BACKUP_MANIFEST_FILENAME;
		zipEntries[p] = [b, { level: isStatic ? 0 : 6 }];
	}
	return zipSync(zipEntries);
}

describe('isZipBytes (#3376)', () => {
	it('ZIP マジックバイト PK\\x03\\x04 を判定する', () => {
		expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe(true);
	});
	it('JSON テキストは ZIP でない', () => {
		expect(isZipBytes(enc('{"format":"ganbari-quest-backup"}'))).toBe(false);
	});
	it('短すぎるバイト列は ZIP でない', () => {
		expect(isZipBytes(new Uint8Array([0x50, 0x4b]))).toBe(false);
	});
});

describe('parseBackupZip (#3376)', () => {
	it('data.json + 静的ファイル + manifest を解析し body/staticFiles を返す', async () => {
		const zip = await buildSampleZip({
			'data.json': enc(VALID_DATA_JSON),
			'avatars/1/a.png': new Uint8Array([1, 2, 3]),
		});
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect((res.value.body as { format: string }).format).toBe('ganbari-quest-backup');
		expect(Object.keys(res.value.staticFiles)).toEqual(['avatars/1/a.png']);
	});

	it('manifest 無しの旧 ZIP も後方互換で解析できる', async () => {
		const zip = await buildSampleZip(
			{ 'data.json': enc(VALID_DATA_JSON), 'avatars/1/a.png': new Uint8Array([1, 2, 3]) },
			{ withManifest: false },
		);
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(Object.keys(res.value.staticFiles)).toEqual(['avatars/1/a.png']);
	});

	it('manifest と中身が食い違う ZIP は破損として弾く (#3386: 内部 reason/path を露出しない)', async () => {
		// manifest を正しく作った後、静的ファイルだけ差し替えた ZIP を組む
		const original = {
			'data.json': enc(VALID_DATA_JSON),
			'avatars/1/a.png': new Uint8Array([1, 2, 3]),
		};
		const manifest = await buildBackupManifest(original, '1.3.0', {}, '2026-06-28T00:00:00.000Z');
		const tamperedZip = zipSync({
			'data.json': enc(VALID_DATA_JSON),
			'avatars/1/a.png': new Uint8Array([9, 9, 9]), // 改竄
			[BACKUP_MANIFEST_FILENAME]: enc(JSON.stringify(manifest)),
		});
		const res = await parseBackupZip(tamperedZip);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		// ADR-0062: ユーザー向け文言は labels.ts SSOT 経由。内部 reason コード / 生パスを露出しない。
		expect(res.error).toBe(SETTINGS_LABELS.dataImportBackupCorrupt);
		expect(res.error).not.toContain('checksum-mismatch');
		expect(res.error).not.toContain('size-mismatch');
		expect(res.error).not.toContain('avatars/1/a.png');
	});

	it('#3386: manifest 記載外ファイルの混入は専用文言で弾く (内部 reason/path 非露出)', async () => {
		const original = { 'data.json': enc(VALID_DATA_JSON) };
		const manifest = await buildBackupManifest(original, '1.3.0', {}, '2026-06-28T00:00:00.000Z');
		const injectedZip = zipSync({
			'data.json': enc(VALID_DATA_JSON),
			'avatars/9/injected.png': new Uint8Array([7, 7, 7]), // manifest に無い注入ファイル
			[BACKUP_MANIFEST_FILENAME]: enc(JSON.stringify(manifest)),
		});
		const res = await parseBackupZip(injectedZip);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toBe(SETTINGS_LABELS.dataImportBackupUnexpectedFile);
		expect(res.error).not.toContain('unexpected-file');
		expect(res.error).not.toContain('avatars/9/injected.png');
	});

	it('#3386: 壊れた manifest.json は専用文言で弾く (内部詳細非露出)', async () => {
		const zip = zipSync({
			'data.json': enc(VALID_DATA_JSON),
			[BACKUP_MANIFEST_FILENAME]: enc('{ this is not valid json'),
		});
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toBe(SETTINGS_LABELS.dataImportManifestCorrupt);
	});

	it('#3386: manifest.itemCounts と data.json 実件数が食い違えば部分欠損として弾く', async () => {
		// data.json は children 1 件だが、manifest.itemCounts は children:5 を主張 → 部分欠損
		const dataJson = JSON.stringify({
			format: 'ganbari-quest-backup',
			version: '1.3.0',
			exportedAt: '2026-06-28T00:00:00.000Z',
			family: { children: [{ id: '1', nickname: 'A' }] },
			data: {},
		});
		const files = { 'data.json': enc(dataJson) };
		const manifest = await buildBackupManifest(
			files,
			'1.3.0',
			{ children: 5 }, // 実際は 1 件 → 照合で mismatch
			'2026-06-28T00:00:00.000Z',
		);
		const zip = zipSync({
			'data.json': enc(dataJson),
			[BACKUP_MANIFEST_FILENAME]: enc(JSON.stringify(manifest)),
		});
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toBe(SETTINGS_LABELS.dataImportBackupCountMismatch);
	});

	it('#3386: manifest.itemCounts が data.json 実件数と一致すれば通る', async () => {
		const dataJson = JSON.stringify({
			format: 'ganbari-quest-backup',
			version: '1.3.0',
			exportedAt: '2026-06-28T00:00:00.000Z',
			family: { children: [{ id: '1', nickname: 'A' }] },
			data: { activityLogs: [{ x: 1 }, { x: 2 }] },
		});
		const files = { 'data.json': enc(dataJson) };
		const manifest = await buildBackupManifest(
			files,
			'1.3.0',
			{ children: 1, activityLogs: 2 },
			'2026-06-28T00:00:00.000Z',
		);
		const zip = zipSync({
			'data.json': enc(dataJson),
			[BACKUP_MANIFEST_FILENAME]: enc(JSON.stringify(manifest)),
		});
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
	});

	it('data.json が無い ZIP はエラー', async () => {
		const zip = zipSync({ 'avatars/1/a.png': new Uint8Array([1, 2, 3]) });
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toContain('data.json');
	});

	it('ZIP でないバイト列は解凍エラー', async () => {
		const res = await parseBackupZip(enc('not a zip'));
		expect(res.ok).toBe(false);
	});
});

describe('buildFullBackupZip (#3376 AC8)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('storage の静的ファイルを同梱し、parseBackupZip で round-trip できる (manifest 整合 OK)', async () => {
		const avatarBytes = new Uint8Array([10, 20, 30, 40]);
		const voiceBytes = new Uint8Array([99, 98, 97]);
		mockListFiles.mockResolvedValue(['t/T1/avatars/1/a.png', 't/T1/voices/1/v.webm']);
		mockReadFile.mockImplementation(async (key: string) => {
			if (key.endsWith('a.png')) return { data: Buffer.from(avatarBytes) };
			if (key.endsWith('v.webm')) return { data: Buffer.from(voiceBytes) };
			return null;
		});

		const zip = await buildFullBackupZip('T1', SAMPLE_EXPORT, false);
		expect(isZipBytes(zip)).toBe(true);

		// round-trip: parseBackupZip は manifest 照合まで通って ok を返す (truncation していたら欠落で fail する)
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect((res.value.body as { format: string }).format).toBe('ganbari-quest-backup');
		// avatar / voice の両方が無欠で同梱されている (silent skip されていない)
		expect(Object.keys(res.value.staticFiles).sort()).toEqual([
			'avatars/1/a.png',
			'voices/1/v.webm',
		]);
		expect(res.value.staticFiles['avatars/1/a.png']).toEqual(avatarBytes);
		expect(res.value.staticFiles['voices/1/v.webm']).toEqual(voiceBytes);
	});

	it('#4720: 置換インポートの復旧用 ZIP (recovery/) は同梱しない (backup の入れ子防止)', async () => {
		const avatarBytes = new Uint8Array([1, 2, 3]);
		mockListFiles.mockResolvedValue([
			't/T1/avatars/1/a.png',
			't/T1/recovery/replace-import-2026-08-20T00-00-00-000Z.zip',
		]);
		mockReadFile.mockImplementation(async (key: string) => {
			if (key.endsWith('a.png')) return { data: Buffer.from(avatarBytes) };
			// recovery ZIP を読もうとしたら除外漏れ (読ませない)
			return { data: Buffer.from(new Uint8Array([9, 9, 9])) };
		});

		const zip = await buildFullBackupZip('T1', SAMPLE_EXPORT, false);
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(Object.keys(res.value.staticFiles)).toEqual(['avatars/1/a.png']);
		expect(mockReadFile).not.toHaveBeenCalledWith(
			't/T1/recovery/replace-import-2026-08-20T00-00-00-000Z.zip',
		);
	});

	it('静的ファイル取得失敗時は JSON のみで graceful degrade (round-trip 可)', async () => {
		mockListFiles.mockRejectedValue(new Error('storage down'));

		const zip = await buildFullBackupZip('T1', SAMPLE_EXPORT, false);
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(Object.keys(res.value.staticFiles)).toEqual([]);
	});

	it('#3405-3: 静的ファイル単体が per-entry 上限 (25MB) を超えたら build 時点で fail-closed する (parse filter と対称)', async () => {
		// build 側に per-entry 上限が無いと、25MB 超 entry を含む ZIP を作れてしまい import で silent drop
		// → manifest 不整合で復元不能 dead-end になる (#3405-3)。build 時点で明示エラーにして根治する。
		mockListFiles.mockResolvedValue(['t/T1/voices/1/big.webm']);
		mockReadFile.mockResolvedValue({ data: Buffer.alloc(MAX_ENTRY_UNCOMPRESSED_BYTES + 1) });

		await expect(buildFullBackupZip('T1', SAMPLE_EXPORT, false)).rejects.toBeInstanceOf(
			BackupSizeLimitError,
		);
		// total (100MB) ではなく per-entry (25MB) の文言であること。
		await expect(buildFullBackupZip('T1', SAMPLE_EXPORT, false)).rejects.toThrow('25MB');
	});

	it('#3405-1: 構築後 ZIP が上限 (100MB) を超えたら fail-closed で BackupSizeLimitError を throw する (100MB 文言)', async () => {
		// 各 25MB 未満 (per-entry OK) だが store 同梱で合計 ZIP が 100MB 超になる 5 ファイル。
		// 判定は圧縮後 ZIP サイズ基準 (非圧縮合計ではない) だが、store される静的ファイル群では ZIP ≈ 合計。
		const twentyOneMb = 21 * 1024 * 1024;
		mockListFiles.mockResolvedValue([1, 2, 3, 4, 5].map((n) => `t/T1/voices/1/v${n}.webm`));
		mockReadFile.mockResolvedValue({ data: Buffer.alloc(twentyOneMb) });

		await expect(buildFullBackupZip('T1', SAMPLE_EXPORT, false)).rejects.toThrow('100MB');
	});

	it('#3405-1: 非圧縮合計が 100MB 超でも圧縮後 ZIP が収まる backup は誤 reject しない (round-trip 可)', async () => {
		// 巨大だが高圧縮な data.json (非圧縮 > 100MB / deflate 後は極小) を dataJson で流し込む。
		// 旧実装は非圧縮合計 > 100MB で誤 reject していたが、判定を圧縮後 ZIP サイズ基準に是正したため通る。
		// data.json は per-entry 対象外 (構造化データ) のため parse 側 filter でも drop されず round-trip する。
		mockListFiles.mockResolvedValue([]);
		// data.json override は manifest.itemCounts (buildFullBackupZip は exportData から算出) と
		// 整合させる必要がある (#3386 の itemCounts 照合。本番では dataJson=exportData 直列化で常に一致)。
		// SAMPLE_EXPORT は children 1 件のため family も同一件数で埋める。
		const hugeCompressibleDataJson = `{"format":"ganbari-quest-backup","version":"1.3.0","family":{"children":[{"id":"1","nickname":"テスト"}]},"pad":"${'a'.repeat(
			MAX_ZIP_SIZE + 2 * 1024 * 1024,
		)}"}`;
		const zip = await buildFullBackupZip('T1', SAMPLE_EXPORT, false, hugeCompressibleDataJson);
		expect(isZipBytes(zip)).toBe(true);
		expect(zip.length).toBeLessThan(MAX_ZIP_SIZE);

		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect((res.value.body as { format: string }).format).toBe('ganbari-quest-backup');
		// #3661 same-class: ~102MB 文字列の deflate/inflate + zip 構築が CI runner で vitest 既定 5s
		// を超える (round-trip 検証に必要な実サイズ、mock 不可)。30s に緩和 (計算量は決定的)。
	}, 30_000);
});
