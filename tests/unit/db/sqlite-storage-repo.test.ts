// tests/unit/db/sqlite-storage-repo.test.ts
// #3078: ローカルストレージ (NUC) の zip-slip 防御検証。
// import 経由の悪意ある ZIP key (`..` で static/ を抜け出す) で writeFileSync が
// static/ ディレクトリ外へ書き込まないことを保証する。

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from '$lib/server/db/sqlite/storage-repo';

describe('sqlite storage-repo saveFile — zip-slip 防御 (#3078)', () => {
	let workDir: string;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), 'gq-storage-test-'));
		// saveFile は process.cwd()/static を基準にするため、隔離した temp dir を cwd に見せる
		cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
	});

	afterEach(() => {
		cwdSpy.mockRestore();
		rmSync(workDir, { recursive: true, force: true });
	});

	it('正常な key は static/ 配下に書き込まれる', async () => {
		await saveFile('tenants/t1/avatars/101/ok.png', Buffer.from([1, 2, 3]), 'image/png');
		const dest = resolve(workDir, 'static', 'tenants/t1/avatars/101/ok.png');
		expect(existsSync(dest)).toBe(true);
		expect(readFileSync(dest)).toEqual(Buffer.from([1, 2, 3]));
	});

	it('`..` で static/ を抜け出す key は throw し、外部に何も書き込まない', async () => {
		const escapeKey = 'avatars/101/../../../../escaped-passwd';
		await expect(
			saveFile(escapeKey, Buffer.from([6, 6, 6]), 'application/octet-stream'),
		).rejects.toThrow(/static/);

		// workDir 直下 (static/ の外) に書き込まれていないこと
		expect(existsSync(join(workDir, 'escaped-passwd'))).toBe(false);
		// 念のため resolve した escape 先にも存在しないこと
		expect(existsSync(resolve(workDir, 'static', escapeKey))).toBe(false);
	});

	it('backslash を使った escape も拒否される', async () => {
		await expect(
			saveFile('avatars\\101\\..\\..\\..\\evil.png', Buffer.from([7]), 'image/png'),
		).rejects.toThrow(/static/);
	});
});
