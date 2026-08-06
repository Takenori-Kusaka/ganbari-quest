/**
 * scripts/__tests__/check-orphan-utils.test.mjs (EPIC #2362 follow-up)
 *
 * orphan detection 共通 utility (`scripts/lib/ci/orphan-utils.mjs`) の unit test。
 *
 * 実行: node --test scripts/__tests__/check-orphan-utils.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
	parseArgs,
	loadBaseline,
	saveBaseline,
	walkDir,
	escapeRegex,
	collectReferences,
	reportFindings,
} = await import('../lib/ci/orphan-utils.mjs');

describe('parseArgs', () => {
	it('--report → report=true', () => {
		const a = parseArgs(['node', 'foo.mjs', '--report']);
		assert.equal(a.report, true);
		assert.equal(a.updateBaseline, false);
	});

	it('--update-baseline → updateBaseline=true', () => {
		const a = parseArgs(['node', 'foo.mjs', '--update-baseline']);
		assert.equal(a.updateBaseline, true);
	});

	it('no flag → check=true (default CI mode)', () => {
		const a = parseArgs(['node', 'foo.mjs']);
		assert.equal(a.check, true);
		assert.equal(a.report, false);
	});
});

describe('escapeRegex', () => {
	it('regex meta-chars を escape する', () => {
		assert.equal(escapeRegex('foo.bar'), 'foo\\.bar');
		assert.equal(escapeRegex('a+b'), 'a\\+b');
		assert.equal(escapeRegex('a(b)c'), 'a\\(b\\)c');
		assert.equal(escapeRegex('a[b]c'), 'a\\[b\\]c');
	});
	it('plain string はそのまま', () => {
		assert.equal(escapeRegex('foo'), 'foo');
	});
});

describe('loadBaseline / saveBaseline', () => {
	it('存在しない baseline は empty allowed を返す', () => {
		const b = loadBaseline(`nonexistent-category-${Math.random()}`);
		assert.deepEqual(b.allowed, []);
		assert.deepEqual(b.reasons, {});
	});

	it('saveBaseline + loadBaseline で round-trip 可能', () => {
		// テンポラリ category 名 (実 baseline と衝突回避)
		const cat = `__test_${process.pid}_${Date.now()}`;
		try {
			saveBaseline(cat, {
				allowed: ['b', 'a', 'c'],
				reasons: { a: 'first', b: 'second', c: 'third' },
				version: '1.0.0',
			});
			const loaded = loadBaseline(cat);
			// allowed は sorted で保存される
			assert.deepEqual(loaded.allowed, ['a', 'b', 'c']);
			assert.equal(loaded.reasons.a, 'first');
		} finally {
			// クリーンアップ — Windows 対応で fileURLToPath 経由
			const p = path.join(path.dirname(__dirname), 'orphan-baselines', `${cat}.json`);
			if (fs.existsSync(p)) fs.unlinkSync(p);
		}
	});
});

describe('#4030 AC6 --update-baseline は免除理由を自動投入しない', () => {
	// 生成側にも検査側と同じ規律を置く。検査 (check mode) だけ直して生成側が
	// 検出理由 / 'auto-added by --update-baseline' を書き込み続けると、
	// **「追加した瞬間に落ちる entry」を量産する**だけで運用が改善しない。
	it('検出理由を reasons に流用せず、未記入のまま exit 1 を返す', () => {
		const cat = `__test_ac6_${process.pid}_${Date.now()}`;
		const baselinePath = path.join(path.dirname(__dirname), 'orphan-baselines', `${cat}.json`);
		const writeOut = process.stdout.write.bind(process.stdout);
		const writeErr = process.stderr.write.bind(process.stderr);
		process.stdout.write = () => true;
		process.stderr.write = () => true;
		try {
			const code = reportFindings(
				cat,
				[
					{
						name: 'src/lib/server/db/dsql/example-repo.ts',
						// script が組み立てる「検出理由」= 機械が書いた現象の説明
						reason:
							'repo file "example-repo.ts" は db facade / factory から import されていません。',
						allowlisted: false,
					},
				],
				{ mode: 'update-baseline', baseline: { allowed: [], reasons: {}, version: '1.0.0' } },
			);
			process.stdout.write = writeOut;
			process.stderr.write = writeErr;

			assert.equal(code, 1, '理由未記入のまま baseline を更新したのに 0 を返している');
			const saved = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
			assert.deepEqual(saved.allowed, ['src/lib/server/db/dsql/example-repo.ts']);
			assert.deepEqual(
				saved.reasons,
				{},
				'検出理由 / auto-added 文字列を免除理由の欄に書き込んでいる',
			);
		} finally {
			process.stdout.write = writeOut;
			process.stderr.write = writeErr;
			if (fs.existsSync(baselinePath)) fs.unlinkSync(baselinePath);
		}
	});
});

describe('walkDir', () => {
	let tmpdir;

	it('指定拡張子のファイルのみを返す', () => {
		tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'));
		try {
			fs.writeFileSync(path.join(tmpdir, 'a.ts'), 'foo');
			fs.writeFileSync(path.join(tmpdir, 'b.md'), 'bar');
			fs.writeFileSync(path.join(tmpdir, 'c.ts'), 'baz');
			const files = walkDir(tmpdir, { extensions: ['.ts'] });
			assert.equal(files.length, 2);
			assert.ok(files.every((f) => f.endsWith('.ts')));
		} finally {
			fs.rmSync(tmpdir, { recursive: true, force: true });
		}
	});

	it('node_modules / .git は自動 skip', () => {
		tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'));
		try {
			fs.mkdirSync(path.join(tmpdir, 'node_modules'));
			fs.writeFileSync(path.join(tmpdir, 'node_modules', 'x.ts'), 'foo');
			fs.writeFileSync(path.join(tmpdir, 'real.ts'), 'foo');
			const files = walkDir(tmpdir, { extensions: ['.ts'] });
			assert.equal(files.length, 1);
			assert.ok(files[0].endsWith('real.ts'));
		} finally {
			fs.rmSync(tmpdir, { recursive: true, force: true });
		}
	});

	it('excludePatterns で除外できる', () => {
		tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'));
		try {
			fs.writeFileSync(path.join(tmpdir, 'a.ts'), 'foo');
			fs.writeFileSync(path.join(tmpdir, 'b.test.ts'), 'foo');
			const files = walkDir(tmpdir, { extensions: ['.ts'], excludePatterns: [/\.test\.ts$/] });
			assert.equal(files.length, 1);
			assert.ok(files[0].endsWith('a.ts'));
		} finally {
			fs.rmSync(tmpdir, { recursive: true, force: true });
		}
	});

	it('存在しない dir は空配列', () => {
		const files = walkDir('/nonexistent/path/foo/bar', { extensions: ['.ts'] });
		assert.deepEqual(files, []);
	});
});

describe('collectReferences (boundary match)', () => {
	let tmpdir;
	it('単語境界で識別子を一致させる', () => {
		tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'));
		try {
			fs.writeFileSync(
				path.join(tmpdir, 'a.ts'),
				`
const fooBar = 1;
const fooBarBaz = 2; // 部分一致は除外
const x = fooBar + 1;
`,
			);
			const files = walkDir(tmpdir, { extensions: ['.ts'] });
			const refs = collectReferences(['fooBar'], files, { boundary: true });
			// 'fooBar' は 2 行で一致 (declaration + reference)、'fooBarBaz' を含む行は除外
			const found = refs.get('fooBar') || [];
			// 厳密 boundary: `fooBar = 1` で 1 件 + `x = fooBar + 1` で 1 件 = 2 件
			// `fooBarBaz` の行は `\bfooBar\b` の境界で外れる
			assert.ok(found.length >= 1, `expected >=1 ref, got ${found.length}`);
			// fooBarBaz を含む行が混入していないこと
			assert.ok(!found.some((r) => r.snippet.includes('fooBarBaz')));
		} finally {
			fs.rmSync(tmpdir, { recursive: true, force: true });
		}
	});

	it('参照ゼロの needle は空配列', () => {
		tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'));
		try {
			fs.writeFileSync(path.join(tmpdir, 'a.ts'), 'const foo = 1;');
			const files = walkDir(tmpdir, { extensions: ['.ts'] });
			const refs = collectReferences(['NEVER_USED'], files, { boundary: true });
			assert.deepEqual(refs.get('NEVER_USED'), []);
		} finally {
			fs.rmSync(tmpdir, { recursive: true, force: true });
		}
	});
});
