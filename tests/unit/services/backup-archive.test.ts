// tests/unit/services/backup-archive.test.ts
// #3376 (EPIC #3374 Sub-2): 共有 backup-archive の parseBackupZip / isZipBytes 検証。
// buildFullBackupZip は storage 依存のため、ここでは fflate で同形式の ZIP を組んで
// parseBackupZip の解析・manifest 照合・zip-bomb/欠落検出を固定する。

import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportData } from '../../../src/lib/domain/export-format';
import {
	BackupSizeLimitError,
	buildFullBackupZip,
	isZipBytes,
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
}));
vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const enc = (s: string) => new TextEncoder().encode(s);

const SAMPLE_EXPORT = {
	format: 'ganbari-quest-backup',
	version: '1.3.0',
	exportedAt: '2026-06-28T00:00:00.000Z',
	family: { children: [{ id: 1, nickname: 'テスト' }] },
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

	it('manifest と中身が食い違う ZIP は破損として弾く', async () => {
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
		expect(res.error).toContain('破損');
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

	it('静的ファイル取得失敗時は JSON のみで graceful degrade (round-trip 可)', async () => {
		mockListFiles.mockRejectedValue(new Error('storage down'));

		const zip = await buildFullBackupZip('T1', SAMPLE_EXPORT, false);
		const res = await parseBackupZip(zip);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(Object.keys(res.value.staticFiles)).toEqual([]);
	});

	it('同梱対象が上限 (100MB) を超えたら fail-closed で BackupSizeLimitError を throw する (silent truncation 禁止)', async () => {
		// 1 ファイルで MAX_ZIP_SIZE を超過させ、残りを silent skip せずエラーになることを固定する
		mockListFiles.mockResolvedValue(['t/T1/voices/1/huge.webm']);
		mockReadFile.mockResolvedValue({ data: Buffer.allocUnsafe(MAX_ZIP_SIZE + 1) });

		await expect(buildFullBackupZip('T1', SAMPLE_EXPORT, false)).rejects.toBeInstanceOf(
			BackupSizeLimitError,
		);
	});

	it('上限超過エラーはユーザー向け文言 (上限 MB) を持つ', async () => {
		mockListFiles.mockResolvedValue(['t/T1/voices/1/huge.webm']);
		mockReadFile.mockResolvedValue({ data: Buffer.allocUnsafe(MAX_ZIP_SIZE + 1) });

		await expect(buildFullBackupZip('T1', SAMPLE_EXPORT, false)).rejects.toThrow('100MB');
	});
});
