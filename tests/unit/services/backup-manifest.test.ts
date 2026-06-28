// tests/unit/services/backup-manifest.test.ts
// #3375 (EPIC #3374 Sub-1): バックアップ整合性 manifest の検証。
// data.json の論理 checksum では守れない「同梱静的バイナリの破損/欠損/改竄」を
// SHA-256 + バイト数の manifest 照合で検出できることを固定する。

import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	BACKUP_MANIFEST_FILENAME,
	type BackupManifest,
	buildBackupManifest,
	parseBackupManifest,
	sha256Hex,
	verifyBackupManifest,
} from '../../../src/lib/server/services/backup-manifest';

const enc = (s: string) => new TextEncoder().encode(s);

function sampleFiles(): Record<string, Uint8Array> {
	return {
		'data.json': enc('{"format":"ganbari-quest-backup","version":"1.3.0"}'),
		'avatars/1/a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
		'voices/2/b.bin': new Uint8Array([9, 8, 7, 6, 5]),
	};
}

describe('backup-manifest sha256Hex (#3375)', () => {
	it('同一バイト列は同一ハッシュ、1 バイト違いで変化する', async () => {
		const a = await sha256Hex(new Uint8Array([1, 2, 3]));
		const a2 = await sha256Hex(new Uint8Array([1, 2, 3]));
		const b = await sha256Hex(new Uint8Array([1, 2, 4]));
		expect(a).toBe(a2);
		expect(a).not.toBe(b);
		expect(a.startsWith('sha256:')).toBe(true);
	});

	it('Uint8Array の byteOffset 付きビューでも正しくハッシュする', async () => {
		const backing = new Uint8Array([99, 1, 2, 3, 99]);
		const view = backing.subarray(1, 4); // [1,2,3]
		expect(await sha256Hex(view)).toBe(await sha256Hex(new Uint8Array([1, 2, 3])));
	});
});

describe('buildBackupManifest (#3375)', () => {
	it('全ファイルの bytes/sha256 + version + itemCounts を記録する', async () => {
		const files = sampleFiles();
		const counts = { children: 2, activityLogs: 10 };
		const manifest = await buildBackupManifest(files, '1.3.0', counts, '2026-06-28T00:00:00.000Z');

		expect(manifest.format).toBe('ganbari-quest-backup');
		expect(manifest.manifestVersion).toBe(1);
		expect(manifest.dataVersion).toBe('1.3.0');
		expect(manifest.itemCounts).toEqual(counts);
		expect(Object.keys(manifest.files).sort()).toEqual([
			'avatars/1/a.png',
			'data.json',
			'voices/2/b.bin',
		]);
		const avatarBytes = files['avatars/1/a.png'];
		expect(avatarBytes).toBeDefined();
		const avatarEntry = manifest.files['avatars/1/a.png'];
		expect(avatarEntry?.bytes).toBe(7);
		expect(avatarEntry?.sha256).toBe(await sha256Hex(avatarBytes as Uint8Array));
	});
});

describe('verifyBackupManifest (#3375)', () => {
	async function build(files: Record<string, Uint8Array>): Promise<BackupManifest> {
		return buildBackupManifest(files, '1.3.0', {}, '2026-06-28T00:00:00.000Z');
	}

	it('改竄なしなら ok', async () => {
		const files = sampleFiles();
		const manifest = await build(files);
		expect(await verifyBackupManifest(files, manifest)).toEqual({ ok: true });
	});

	it('静的バイナリが 1 バイト改竄されると checksum-mismatch を検出する', async () => {
		const files = sampleFiles();
		const manifest = await build(files);
		// 画像を破壊（同じ長さ・中身違い）
		const tampered = {
			...files,
			'avatars/1/a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 9]),
		};
		const verdict = await verifyBackupManifest(tampered, manifest);
		expect(verdict).toEqual({ ok: false, reason: 'checksum-mismatch', path: 'avatars/1/a.png' });
	});

	it('サイズが変わると size-mismatch を検出する', async () => {
		const files = sampleFiles();
		const manifest = await build(files);
		const tampered = { ...files, 'voices/2/b.bin': new Uint8Array([9, 8, 7]) };
		const verdict = await verifyBackupManifest(tampered, manifest);
		expect(verdict).toEqual({ ok: false, reason: 'size-mismatch', path: 'voices/2/b.bin' });
	});

	it('ファイル欠損で missing-file を検出する', async () => {
		const files = sampleFiles();
		const manifest = await build(files);
		const { 'voices/2/b.bin': _omit, ...partial } = files;
		const verdict = await verifyBackupManifest(partial, manifest);
		expect(verdict).toEqual({ ok: false, reason: 'missing-file', path: 'voices/2/b.bin' });
	});
});

describe('parseBackupManifest (#3375)', () => {
	it('正常 manifest をパースする', async () => {
		const manifest = await buildBackupManifest(
			sampleFiles(),
			'1.3.0',
			{},
			'2026-06-28T00:00:00.000Z',
		);
		const parsed = parseBackupManifest(new TextEncoder().encode(JSON.stringify(manifest)));
		expect(parsed?.format).toBe('ganbari-quest-backup');
	});

	it('壊れた JSON は null', () => {
		expect(parseBackupManifest(enc('{not json'))).toBeNull();
	});

	it('format 不一致は null（別ファイルの誤読込防止）', () => {
		expect(parseBackupManifest(enc('{"manifestVersion":1,"files":{}}'))).toBeNull();
	});
});

describe('ZIP round-trip 統合 (#3375)', () => {
	it('export と同型の zip → unzip → verify が通る（per-entry store/deflate 混在）', async () => {
		const files = sampleFiles();
		const manifest = await buildBackupManifest(files, '1.3.0', {}, '2026-06-28T00:00:00.000Z');
		const withManifest = { ...files, [BACKUP_MANIFEST_FILENAME]: enc(JSON.stringify(manifest)) };

		// export と同じ per-entry 圧縮制御（画像=store, 構造化=deflate）で固める
		const zipEntries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
		for (const [path, bytes] of Object.entries(withManifest)) {
			const isStatic = path !== 'data.json' && path !== BACKUP_MANIFEST_FILENAME;
			zipEntries[path] = [bytes, { level: isStatic ? 0 : 6 }];
		}
		const zip = zipSync(zipEntries);

		const entries = unzipSync(zip);
		const manifestEntry = entries[BACKUP_MANIFEST_FILENAME];
		expect(manifestEntry).toBeDefined();
		const parsed = parseBackupManifest(manifestEntry as Uint8Array);
		expect(parsed).not.toBeNull();
		const entriesForVerify: Record<string, Uint8Array> = {};
		for (const [p, b] of Object.entries(entries)) {
			if (p !== BACKUP_MANIFEST_FILENAME) entriesForVerify[p] = b;
		}
		expect(await verifyBackupManifest(entriesForVerify, parsed as BackupManifest)).toEqual({
			ok: true,
		});
	});
});
