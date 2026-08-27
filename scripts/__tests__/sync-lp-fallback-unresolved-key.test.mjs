/**
 * scripts/__tests__/sync-lp-fallback-unresolved-key.test.mjs
 *
 * #4626: `--check` が「生成物に key が無い data-lp-key」を見逃さないことの検証。
 *
 * 旧実装は生成物に対応 key が無い data-lp-key を `skippedMissing` に積むだけで、
 * `--verbose` を付けない限り何も言わずに「同期済み」と答えていた。
 * その結果、generate-lp-labels が key を落とした瞬間に本 script の照合対象からも消え、
 * LP が HTML 直書きの古い文言を出し続けても CI は緑のままになる。
 *
 * 実行: node --test scripts/__tests__/sync-lp-fallback-unresolved-key.test.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findUnresolvedHtmlKeys, HTML_LP_KEY_EXCLUSIONS } from '../sync-lp-fallback.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '..', 'sync-lp-fallback.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('生成物に無い data-lp-key の検出 (#4626)', () => {
	it('除外に無い未解決 key は全件報告される', () => {
		const result = findUnresolvedHtmlKeys(
			[
				{ relPath: 'site/index.html', dottedKey: 'hero.gone' },
				{ relPath: 'site/index.html', dottedKey: 'hero.gone' },
				{ relPath: 'site/pricing.html', dottedKey: 'plan.gone' },
			],
			{},
		);
		assert.deepEqual(result.unresolved, [
			'site/index.html: hero.gone',
			'site/pricing.html: plan.gone',
		]);
		assert.deepEqual(result.invalidExclusions, []);
		assert.deepEqual(result.staleExclusions, []);
	});

	it('理由付き除外は通り、理由なし除外は fail する', () => {
		const occurrences = [{ relPath: 'site/index.html', dottedKey: 'hero.gone' }];
		const ok = findUnresolvedHtmlKeys(occurrences, {
			'hero.gone': '外部 CMS から差し込むため labels.ts では持たない',
		});
		assert.deepEqual(ok.unresolved, []);
		assert.deepEqual(ok.invalidExclusions, []);

		for (const badReason of ['', 'TODO', '未定']) {
			const bad = findUnresolvedHtmlKeys(occurrences, { 'hero.gone': badReason });
			assert.deepEqual(bad.unresolved, []);
			assert.deepEqual(
				bad.invalidExclusions,
				['hero.gone'],
				`理由 ${JSON.stringify(badReason)} が受理されてしまった`,
			);
		}
	});

	it('もう該当しない除外エントリ (stale) は fail する', () => {
		const result = findUnresolvedHtmlKeys([], { 'hero.gone': 'すでに解決済みになった key の除外' });
		assert.deepEqual(result.staleExclusions, ['hero.gone']);
	});

	it('現状の除外リストは空 (実 HTML の data-lp-key は全て生成物で解決できる)', () => {
		assert.deepEqual(Object.keys(HTML_LP_KEY_EXCLUSIONS), []);
	});

	it('--check は未解決 key を含む HTML で exit 1 になる (CLI 経路)', () => {
		const tmpRoot = path.join(REPO_ROOT, 'scripts', '__tests__', '__tmp__');
		fs.mkdirSync(tmpRoot, { recursive: true });
		const tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'unresolved-lp-key-'));
		try {
			const relPath = path
				.relative(REPO_ROOT, path.join(tmpDir, 'unresolved.html'))
				.split(path.sep)
				.join('/');
			fs.writeFileSync(
				path.join(tmpDir, 'unresolved.html'),
				'<!doctype html><html><body><p data-lp-key="hero.noSuchKeyForTest">古い文言</p></body></html>',
				'utf-8',
			);
			const result = spawnSync('node', [SCRIPT_PATH, '--check'], {
				cwd: REPO_ROOT,
				env: { ...process.env, SYNC_LP_FALLBACK_TARGETS: relPath },
				encoding: 'utf-8',
			});
			assert.equal(
				result.status,
				1,
				`未解決 key があるのに exit 0 で通ってしまった\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
			);
			assert.match(result.stderr ?? '', /hero\.noSuchKeyForTest/);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
