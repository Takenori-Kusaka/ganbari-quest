/**
 * scripts/__tests__/capture-ss-fakes.test.mjs (#2059)
 *
 * SS 偽装検出 (Before / After sha256 同一性ガード) のユニットテスト。
 *
 * 設計背景: PR #2024 / #2025 / #2040 / #2043 / #2054 で 5 件連続発生した
 * 「Before SS と After SS が 1 byte も違わない完全同一画像」偽装事例への
 * capture script 側ガード (#2063 CI gate と相補)。
 *
 * AC マッピング (Issue #2059):
 *   - AC1: capture flow に Before/After sha256 同一検出ガードを追加
 *   - AC6 (a): Before/After sha256 完全一致を検知できること (本ファイル)
 *
 * 実行: node --test scripts/__tests__/capture-ss-fakes.test.mjs
 *
 * scripts/ 配下 unit test の慣行 (check-screenshot-freshness / check-pr-screenshot /
 * check-ss-blob-sha-uniqueness) に整合し node:test runner を採用。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
	checkBeforeAfterIdentical,
	detectIdenticalBeforeAfterPairs,
	findBeforeAfterPairs,
	sha256OfFile,
} from '../lib/screenshot-helpers.mjs';

// ---------------------------------------------------------------------------
// sha256OfFile — 基本動作
// ---------------------------------------------------------------------------

describe('sha256OfFile', () => {
	/** @type {string} */
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-ss-fakes-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('同一バイト列のファイルは同じ hex digest を返す', () => {
		const a = path.join(tmpDir, 'a.bin');
		const b = path.join(tmpDir, 'b.bin');
		fs.writeFileSync(a, 'identical-content');
		fs.writeFileSync(b, 'identical-content');
		assert.equal(sha256OfFile(a), sha256OfFile(b));
	});

	it('異なるバイト列のファイルは異なる hex digest を返す', () => {
		const a = path.join(tmpDir, 'a.bin');
		const b = path.join(tmpDir, 'b.bin');
		fs.writeFileSync(a, 'content-a');
		fs.writeFileSync(b, 'content-b');
		assert.notEqual(sha256OfFile(a), sha256OfFile(b));
	});

	it('返り値は 64 hex chars (sha256 digest 長)', () => {
		const a = path.join(tmpDir, 'a.bin');
		fs.writeFileSync(a, '');
		const sha = sha256OfFile(a);
		assert.equal(sha.length, 64);
		assert.match(sha, /^[0-9a-f]{64}$/);
	});
});

// ---------------------------------------------------------------------------
// findBeforeAfterPairs — ペア抽出ロジック
// ---------------------------------------------------------------------------

describe('findBeforeAfterPairs', () => {
	it('同一 dir の before-X / after-X をペアにする', () => {
		const paths = [
			'tmp/screenshots/pr-2059/before-index-mobile.png',
			'tmp/screenshots/pr-2059/after-index-mobile.png',
		];
		const pairs = findBeforeAfterPairs(paths);
		assert.equal(pairs.length, 1);
		assert.equal(pairs[0].before, paths[0]);
		assert.equal(pairs[0].after, paths[1]);
	});

	it('複数ペアを正しく抽出する', () => {
		const paths = [
			'tmp/ss/before-index-mobile.png',
			'tmp/ss/after-index-mobile.png',
			'tmp/ss/before-index-desktop.png',
			'tmp/ss/after-index-desktop.png',
		];
		const pairs = findBeforeAfterPairs(paths);
		assert.equal(pairs.length, 2);
	});

	it('before のみ / after のみは pair に含めない', () => {
		const paths = [
			'tmp/ss/before-orphan.png',
			'tmp/ss/after-another.png',
			'tmp/ss/before-paired.png',
			'tmp/ss/after-paired.png',
		];
		const pairs = findBeforeAfterPairs(paths);
		assert.equal(pairs.length, 1);
		assert.equal(path.basename(pairs[0].before), 'before-paired.png');
	});

	it('異なる dir の before-X / after-X はペアにならない (誤検知防止)', () => {
		const paths = ['tmp/ss-old/before-x.png', 'tmp/ss-new/after-x.png'];
		const pairs = findBeforeAfterPairs(paths);
		assert.equal(pairs.length, 0);
	});

	it('before- / after- prefix を含まないファイルは無視される', () => {
		const paths = [
			'tmp/ss/index-mobile.png',
			'tmp/ss/feature-x.png',
			'tmp/ss/before-paired.png',
			'tmp/ss/after-paired.png',
		];
		const pairs = findBeforeAfterPairs(paths);
		assert.equal(pairs.length, 1);
	});
});

// ---------------------------------------------------------------------------
// detectIdenticalBeforeAfterPairs — sha256 比較 (mock hasher)
// ---------------------------------------------------------------------------

describe('detectIdenticalBeforeAfterPairs', () => {
	it('sha256 が同一なペアを violation として返す', () => {
		const pairs = [{ key: 'k', before: 'before.png', after: 'after.png' }];
		const hasher = () => 'same-sha';
		const violations = detectIdenticalBeforeAfterPairs(pairs, hasher);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].sha, 'same-sha');
	});

	it('sha256 が異なるペアは violation にならない', () => {
		const pairs = [{ key: 'k', before: 'before.png', after: 'after.png' }];
		const hashes = new Map([
			['before.png', 'sha-a'],
			['after.png', 'sha-b'],
		]);
		const hasher = (p) => hashes.get(p) ?? 'unknown';
		const violations = detectIdenticalBeforeAfterPairs(pairs, hasher);
		assert.equal(violations.length, 0);
	});

	it('複数ペアのうち同一 sha のもののみを抽出する', () => {
		const pairs = [
			{ key: 'k1', before: 'b1.png', after: 'a1.png' },
			{ key: 'k2', before: 'b2.png', after: 'a2.png' },
		];
		const hashes = new Map([
			['b1.png', 'sha-1'],
			['a1.png', 'sha-1'], // ← 同一 (偽装)
			['b2.png', 'sha-2-different'],
			['a2.png', 'sha-2-other'],
		]);
		const hasher = (p) => hashes.get(p) ?? 'unknown';
		const violations = detectIdenticalBeforeAfterPairs(pairs, hasher);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].before, 'b1.png');
	});
});

// ---------------------------------------------------------------------------
// checkBeforeAfterIdentical — 統合 API (capture.mjs から呼ばれる本体)
// ---------------------------------------------------------------------------

describe('checkBeforeAfterIdentical', () => {
	/** @type {string} */
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-ss-integ-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('AC6(a): 完全同一の Before/After ペア → fail (message 含む)', () => {
		const before = path.join(tmpDir, 'before-feature-mobile.png');
		const after = path.join(tmpDir, 'after-feature-mobile.png');
		const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
		fs.writeFileSync(before, payload);
		fs.writeFileSync(after, payload);

		const result = checkBeforeAfterIdentical([before, after]);
		assert.notEqual(result, null);
		assert.equal(result.violations.length, 1);
		// fail message に Before/After 撮影の運用説明を含むこと
		assert.match(result.message, /main HEAD/);
		assert.match(result.message, /PR HEAD/);
		assert.match(result.message, /sha256/);
	});

	it('Before/After が異なるバイト列なら null (偽陰性チェック)', () => {
		const before = path.join(tmpDir, 'before-feature.png');
		const after = path.join(tmpDir, 'after-feature.png');
		fs.writeFileSync(before, 'main-head-content');
		fs.writeFileSync(after, 'pr-head-content');

		const result = checkBeforeAfterIdentical([before, after]);
		assert.equal(result, null);
	});

	it('Before/After ペアが 0 件 (single side のみ) なら null', () => {
		const before = path.join(tmpDir, 'before-x.png');
		fs.writeFileSync(before, 'lone');

		const result = checkBeforeAfterIdentical([before]);
		assert.equal(result, null);
	});

	it('Before/After ペアなしの通常 SS のみなら null', () => {
		const fp = path.join(tmpDir, 'feature-mobile.png');
		fs.writeFileSync(fp, 'just-a-snapshot');

		const result = checkBeforeAfterIdentical([fp]);
		assert.equal(result, null);
	});

	it('複数ペアのうち 1 ペアのみ同一 → violation 1 件', () => {
		const b1 = path.join(tmpDir, 'before-index-mobile.png');
		const a1 = path.join(tmpDir, 'after-index-mobile.png');
		const b2 = path.join(tmpDir, 'before-index-desktop.png');
		const a2 = path.join(tmpDir, 'after-index-desktop.png');
		// mobile pair: 偽装 (同一)
		fs.writeFileSync(b1, 'identical');
		fs.writeFileSync(a1, 'identical');
		// desktop pair: 正常 (異なる)
		fs.writeFileSync(b2, 'main-head');
		fs.writeFileSync(a2, 'pr-head');

		const result = checkBeforeAfterIdentical([b1, a1, b2, a2]);
		assert.notEqual(result, null);
		assert.equal(result.violations.length, 1);
		assert.match(path.basename(result.violations[0].before), /before-index-mobile/);
	});
});
