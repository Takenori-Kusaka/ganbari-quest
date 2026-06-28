// tests/unit/services/backup-archive.test.ts
// #3376 (EPIC #3374 Sub-2): 共有 backup-archive の parseBackupZip / isZipBytes 検証。
// buildFullBackupZip は storage 依存のため、ここでは fflate で同形式の ZIP を組んで
// parseBackupZip の解析・manifest 照合・zip-bomb/欠落検出を固定する。

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isZipBytes, parseBackupZip } from '../../../src/lib/server/services/backup-archive';
import {
	BACKUP_MANIFEST_FILENAME,
	buildBackupManifest,
} from '../../../src/lib/server/services/backup-manifest';

const enc = (s: string) => new TextEncoder().encode(s);

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
