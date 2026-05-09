/**
 * scripts/__tests__/check-screenshot-freshness.test.mjs (#1893)
 *
 * check-screenshot-freshness.mjs のユニットテスト。Issue #1893 (PO-4-7、8 回目指摘)
 * で導入する SS 鮮度 CI が以下を満たすことを保証する:
 *   - parseArgs: --max-age-minutes / --site-dir の正常系・異常系
 *   - listWebpFiles: site/screenshots/ 配下の *.webp のみを抽出
 *   - getFileAgeMinutes: mtime と現在時刻の差分(分)を正確に返す
 *   - checkFreshness: 全 webp が新しい / 一部が古い / ディレクトリ空 の各シナリオ
 *
 * 実行: node --test scripts/__tests__/check-screenshot-freshness.test.mjs
 *
 * AC マッピング (Issue #1893):
 *   - AC4: scripts/check-screenshot-freshness.mjs 新設、site/screenshots/*.webp の最終更新が
 *     pages.yml 直近 run より古ければ exit 1
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	checkFreshness,
	getFileAgeMinutes,
	listWebpFiles,
	parseArgs,
} from '../check-screenshot-freshness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helper: 一時ディレクトリ作成と cleanup
// ---------------------------------------------------------------------------

/**
 * 一時 site/screenshots/ レイアウトを作成して absolute path を返す。
 * cleanup は呼び出し側で `fs.rmSync(dir, { recursive: true })` を実行する。
 *
 * Note: REPO_ROOT 内に作成しないと `path.relative(REPO_ROOT, ...)` が `..` を含むため、
 *       本テストでは REPO_ROOT 内 `tmp/` 配下に独立 site dir を作成する。
 */
function createTempSiteDir() {
	const tmpRoot = path.join(
		REPO_ROOT,
		'tmp',
		`freshness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	const screenshotsDir = path.join(tmpRoot, 'screenshots');
	fs.mkdirSync(screenshotsDir, { recursive: true });
	return { tmpRoot, screenshotsDir };
}

/**
 * 指定 mtime で WebP file を作成する (中身は dummy bytes)。
 *
 * @param {string} filePath
 * @param {Date} mtime
 */
function writeFileWithMtime(filePath, mtime) {
	fs.writeFileSync(filePath, 'dummy webp content');
	fs.utimesSync(filePath, mtime, mtime);
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
	it('引数なしで default 値 (maxAgeMinutes=30, siteDir=site) を返す', () => {
		const result = parseArgs([]);
		assert.equal(result.maxAgeMinutes, 30);
		assert.equal(result.siteDir, 'site');
		assert.equal(result.verbose, false);
	});

	it('--max-age-minutes 60 を解釈する', () => {
		const result = parseArgs(['--max-age-minutes', '60']);
		assert.equal(result.maxAgeMinutes, 60);
	});

	it('--site-dir で site dir を変更する', () => {
		const result = parseArgs(['--site-dir', 'custom-site']);
		assert.equal(result.siteDir, 'custom-site');
	});

	it('--verbose フラグを認識する', () => {
		const result = parseArgs(['--verbose']);
		assert.equal(result.verbose, true);
	});

	it('--max-age-minutes に負の値を渡すと throw する', () => {
		assert.throws(() => parseArgs(['--max-age-minutes', '-1']));
	});

	it('--max-age-minutes に 0 を渡すと throw する', () => {
		assert.throws(() => parseArgs(['--max-age-minutes', '0']));
	});

	it('--max-age-minutes に非数を渡すと throw する', () => {
		assert.throws(() => parseArgs(['--max-age-minutes', 'abc']));
	});

	it('--site-dir 値なしで throw する', () => {
		assert.throws(() => parseArgs(['--site-dir']));
	});
});

// ---------------------------------------------------------------------------
// listWebpFiles
// ---------------------------------------------------------------------------

describe('listWebpFiles', () => {
	it('site/screenshots/ が存在しなければ空配列を返す', () => {
		const result = listWebpFiles('non-existent-dir-12345');
		assert.deepEqual(result, []);
	});

	it('webp 以外のファイルは除外する', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			fs.writeFileSync(path.join(screenshotsDir, 'a.webp'), 'x');
			fs.writeFileSync(path.join(screenshotsDir, 'b.png'), 'x');
			fs.writeFileSync(path.join(screenshotsDir, 'c.jpg'), 'x');
			const siteDir = path.relative(REPO_ROOT, tmpRoot);
			const result = listWebpFiles(siteDir);
			assert.equal(result.length, 1);
			assert.ok(result[0].endsWith('a.webp'));
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it('複数 webp を全て返す', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			fs.writeFileSync(path.join(screenshotsDir, 'a.webp'), 'x');
			fs.writeFileSync(path.join(screenshotsDir, 'b.webp'), 'x');
			fs.writeFileSync(path.join(screenshotsDir, 'c.webp'), 'x');
			const siteDir = path.relative(REPO_ROOT, tmpRoot);
			const result = listWebpFiles(siteDir);
			assert.equal(result.length, 3);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// getFileAgeMinutes
// ---------------------------------------------------------------------------

describe('getFileAgeMinutes', () => {
	it('現在時刻と同じ mtime ファイルは ~0 分を返す', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			const filePath = path.join(screenshotsDir, 'now.webp');
			const now = new Date();
			writeFileWithMtime(filePath, now);
			const age = getFileAgeMinutes(filePath, now);
			assert.ok(age >= 0 && age < 0.1, `age=${age}`);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it('60 分前 mtime ファイルは 60 分を返す', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			const filePath = path.join(screenshotsDir, 'old.webp');
			const now = new Date('2026-05-09T12:00:00Z');
			const past = new Date('2026-05-09T11:00:00Z');
			writeFileWithMtime(filePath, past);
			const age = getFileAgeMinutes(filePath, now);
			assert.equal(Math.round(age), 60);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// checkFreshness
// ---------------------------------------------------------------------------

describe('checkFreshness', () => {
	it('site/screenshots/ が空のとき skipped=true で ok=true を返す', () => {
		const result = checkFreshness({
			maxAgeMinutes: 30,
			siteDir: 'non-existent-dir-67890',
		});
		assert.equal(result.ok, true);
		assert.equal(result.skipped, true);
		assert.equal(result.total, 0);
	});

	it('全 webp が maxAgeMinutes 以内なら ok=true', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			const now = new Date('2026-05-09T12:00:00Z');
			writeFileWithMtime(path.join(screenshotsDir, 'a.webp'), new Date('2026-05-09T11:50:00Z')); // 10 min old
			writeFileWithMtime(path.join(screenshotsDir, 'b.webp'), new Date('2026-05-09T11:55:00Z')); // 5 min old
			const siteDir = path.relative(REPO_ROOT, tmpRoot);
			const result = checkFreshness({ maxAgeMinutes: 30, siteDir, now });
			assert.equal(result.ok, true);
			assert.equal(result.skipped, false);
			assert.equal(result.total, 2);
			assert.equal(result.stale.length, 0);
			assert.equal(result.fresh.length, 2);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it('1 件でも maxAgeMinutes より古ければ ok=false', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			const now = new Date('2026-05-09T12:00:00Z');
			writeFileWithMtime(path.join(screenshotsDir, 'a.webp'), new Date('2026-05-09T11:50:00Z')); // 10 min old (fresh)
			writeFileWithMtime(path.join(screenshotsDir, 'b.webp'), new Date('2026-05-09T10:00:00Z')); // 120 min old (stale)
			const siteDir = path.relative(REPO_ROOT, tmpRoot);
			const result = checkFreshness({ maxAgeMinutes: 30, siteDir, now });
			assert.equal(result.ok, false);
			assert.equal(result.total, 2);
			assert.equal(result.stale.length, 1);
			assert.equal(result.fresh.length, 1);
			// stale entry には path と ageMinutes が含まれる
			assert.match(result.stale[0].path, /b\.webp$/);
			assert.ok(result.stale[0].ageMinutes >= 120);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it('全 webp が古ければ全 stale 報告', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			const now = new Date('2026-05-09T12:00:00Z');
			writeFileWithMtime(path.join(screenshotsDir, 'a.webp'), new Date('2026-05-08T12:00:00Z')); // 24h old
			writeFileWithMtime(path.join(screenshotsDir, 'b.webp'), new Date('2026-05-07T12:00:00Z')); // 48h old
			const siteDir = path.relative(REPO_ROOT, tmpRoot);
			const result = checkFreshness({ maxAgeMinutes: 30, siteDir, now });
			assert.equal(result.ok, false);
			assert.equal(result.total, 2);
			assert.equal(result.stale.length, 2);
			assert.equal(result.fresh.length, 0);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it('境界値: maxAgeMinutes と等しい age は fresh とみなす', () => {
		const { tmpRoot, screenshotsDir } = createTempSiteDir();
		try {
			const now = new Date('2026-05-09T12:00:00Z');
			writeFileWithMtime(path.join(screenshotsDir, 'a.webp'), new Date('2026-05-09T11:30:00Z')); // exactly 30 min
			const siteDir = path.relative(REPO_ROOT, tmpRoot);
			const result = checkFreshness({ maxAgeMinutes: 30, siteDir, now });
			// Age が `maxAgeMinutes 超` で stale なので、ちょうど 30 分は fresh
			assert.equal(result.ok, true);
			assert.equal(result.fresh.length, 1);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});
