/**
 * scripts/__tests__/check-doc-code-references.test.mjs
 *
 * #2240 Split A — check-doc-code-references.mjs CLI 動作テスト。
 * #2259 C2 fix: `--repo-root` / `--baseline-path` 引数で sandbox dir 内に閉じて実行する
 * (本番 baseline を破壊しない、本番 docs/ を走査しない)。
 * #2259 C1 fix: baseline 形式が path 配列 (`paths: { file: [...] }`) に変わったため
 * test も path 配列でセットアップする (旧 totals 形式は legacy フォールバックで継続サポート)。
 *
 * 実行: node --test scripts/__tests__/check-doc-code-references.test.mjs
 *
 * テストケース:
 * 1. baseline 内 (違反 0 件) → exit 0
 * 2. baseline 超過 (path-set diff で新規 1 件) → exit 1
 * 3. Deprecated marker (`<!-- doc-status: deprecated -->`) で該当ファイル全体が skip
 * 4. fenced code block (` ```bash ... ``` `) 内のパスは検出対象外
 * 5. --update-baseline 後の再実行は exit 0
 * 6. inline code と bare path の区別表示
 * 7. **swap シナリオ (#2259 C1)**: 同一ファイル内で 1 件 fix + 1 件新規追加した場合、
 *    count 維持でも path-set diff で fail することを検証
 * 8. **sandbox 隔離 (#2259 C2)**: --update-baseline がスクリプトデフォルトの本番 baseline を
 *    破壊しないことを検証 (test sandbox 用 baseline-path に書き込む)
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_PATH = path.resolve(path.dirname(__filename), '..', 'check-doc-code-references.mjs');
const REAL_BASELINE_PATH = path.resolve(
	path.dirname(__filename),
	'..',
	'doc-code-references-baseline.json',
);

/**
 * sandbox dir に最小構成 (docs/ + 任意 md ファイル) を作る。
 * baseline 引数を渡すと sandbox 内の scripts/doc-code-references-baseline.json に
 * 新フォーマット (paths) で書き出す。`legacyBaseline` を渡すと旧 totals 形式で書く。
 */
function setupSandbox({ files = {}, baseline = null, legacyBaseline = null } = {}) {
	const sandbox = mkdtempSync(path.join(tmpdir(), 'check-doc-code-references-'));
	mkdirSync(path.join(sandbox, 'docs'), { recursive: true });
	mkdirSync(path.join(sandbox, 'src'), { recursive: true });
	mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });

	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(sandbox, rel);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	}

	const sandboxBaselinePath = path.join(sandbox, 'scripts/doc-code-references-baseline.json');
	if (baseline) {
		writeFileSync(sandboxBaselinePath, JSON.stringify({ paths: baseline }));
	} else if (legacyBaseline) {
		writeFileSync(sandboxBaselinePath, JSON.stringify({ totals: legacyBaseline }));
	}

	return { sandbox, baselinePath: sandboxBaselinePath };
}

/**
 * sandbox 内でスクリプトを実行し { code, stdout, stderr } を返す。
 * sandbox の repo-root / baseline-path を CLI 引数で明示注入する (#2259 C2)。
 */
function runScript({ sandbox, baselinePath, args = [] }) {
	const fullArgs = [
		SCRIPT_PATH,
		'--repo-root',
		sandbox,
		'--baseline-path',
		baselinePath,
		...args,
	];
	try {
		const stdout = execFileSync('node', fullArgs, {
			cwd: sandbox,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, stdout, stderr: '' };
	} catch (err) {
		return {
			code: err.status ?? 1,
			stdout: err.stdout?.toString() ?? '',
			stderr: err.stderr?.toString() ?? '',
		};
	}
}

describe('check-doc-code-references.mjs CLI', () => {
	it('baseline 内 (違反 0 件) → exit 0', () => {
		const ctx = setupSandbox({
			files: {
				'docs/sample.md': '# OK\n\nReference: `src/existing-file.ts`\n',
				'src/existing-file.ts': '// real file',
			},
		});
		try {
			const result = runScript({ ...ctx, args: ['--json'] });
			assert.equal(result.code, 0);
			const json = JSON.parse(result.stdout);
			assert.equal(json.totalViolations, 0);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('baseline 超過 → exit 1', () => {
		const ctx = setupSandbox({
			files: {
				'docs/bad.md': '# Bad\n\nRef: `src/nonexistent/foo.ts`\n',
			},
			baseline: {},
		});
		try {
			const result = runScript(ctx);
			assert.equal(result.code, 1);
			assert.match(result.stderr + result.stdout, /baseline exceeded|EXCEEDS|new path/);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('Deprecated marker (`<!-- doc-status: deprecated -->`) でファイル全体が skip される', () => {
		const ctx = setupSandbox({
			files: {
				'docs/old.md':
					'# Old\n\n<!-- doc-status: deprecated -->\n\nObsolete ref: `src/gone-away.ts`\n',
			},
			baseline: {},
		});
		try {
			const result = runScript({ ...ctx, args: ['--json'] });
			assert.equal(result.code, 0, 'Deprecated marker があれば違反として上がってこない');
			const json = JSON.parse(result.stdout);
			assert.equal(json.totalViolations, 0);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('fenced code block 内の bare path は検出対象外', () => {
		const ctx = setupSandbox({
			files: {
				'docs/example.md': [
					'# Example',
					'',
					'```bash',
					'cd src/imaginary-path && ls',
					'```',
					'',
					'fenced 内なのでパス参照は検出対象外。',
				].join('\n'),
			},
			baseline: {},
		});
		try {
			const result = runScript({ ...ctx, args: ['--json'] });
			assert.equal(result.code, 0, 'fenced code block 内のパスは違反として検出されない');
			const json = JSON.parse(result.stdout);
			assert.equal(json.totalViolations, 0);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('--update-baseline で baseline 更新後の再実行は exit 0', () => {
		const ctx = setupSandbox({
			files: {
				'docs/many-bad.md': '# Many\n\nRef A: `src/missing-a.ts`\nRef B: `src/missing-b.ts`\n',
			},
			baseline: {},
		});
		try {
			const update = runScript({ ...ctx, args: ['--update-baseline'] });
			assert.equal(update.code, 0);
			const verify = runScript(ctx);
			assert.equal(verify.code, 0, 'baseline 更新後は既存違反が pin され exit 0');
			// 新フォーマットで保存されていることを assert (#2259 C1)
			const written = JSON.parse(readFileSync(ctx.baselinePath, 'utf-8'));
			assert.ok(written.paths, 'baseline は paths key を持つ新フォーマット');
			assert.ok(Array.isArray(written.paths['docs/many-bad.md']));
			assert.deepEqual(
				written.paths['docs/many-bad.md'].sort(),
				['src/missing-a.ts', 'src/missing-b.ts'].sort(),
			);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('inline code と bare path を区別表示する', () => {
		const ctx = setupSandbox({
			files: {
				'docs/mixed.md': '# Mixed\n\nInline: `src/missing-inline.ts`\nBare: src/missing-bare.ts\n',
			},
			baseline: {},
		});
		try {
			const result = runScript(ctx);
			assert.equal(result.code, 1);
			const out = result.stderr + result.stdout;
			assert.match(out, /inline code/);
			assert.match(out, /bare path/);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('#2259 C1: 同一ファイル内 swap (1 fix + 1 新規) は count 維持でも fail する', () => {
		// baseline: docs/swap.md に [src/old-1.ts, src/old-2.ts] が pin されている
		// 現状: docs/swap.md は src/old-1.ts (維持) + src/new-3.ts (新規)
		//       → count は 2 のまま、ただし new-3 は baseline path-set に無い
		// 旧 totals フォーマット (count のみ) では count: 2 == baseline: 2 で素通りした
		// 新 path 配列フォーマットでは set diff で new-3 が検出され fail する
		const ctx = setupSandbox({
			files: {
				'docs/swap.md': '# Swap\n\nKept: `src/old-1.ts`\nNew: `src/new-3.ts`\n',
			},
			baseline: {
				'docs/swap.md': ['src/old-1.ts', 'src/old-2.ts'],
			},
		});
		try {
			const result = runScript({ ...ctx, args: ['--json'] });
			assert.equal(
				result.code,
				1,
				'count 維持でも path-set diff で新規 src/new-3.ts が検出され fail',
			);
			const json = JSON.parse(result.stdout);
			assert.equal(json.exceedances.length, 1);
			assert.deepEqual(json.exceedances[0].newPaths, ['src/new-3.ts']);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('#2259 C2: --update-baseline は --baseline-path で指定したファイルにのみ書き込む (本番 baseline 不変)', () => {
		// 本番 baseline (リポジトリ実体) の最終 mtime / 内容を記録
		const realBaselineBefore = existsSync(REAL_BASELINE_PATH)
			? readFileSync(REAL_BASELINE_PATH, 'utf-8')
			: null;

		const ctx = setupSandbox({
			files: {
				'docs/x.md': '# X\n\nRef: `src/missing-foo.ts`\n',
			},
			baseline: {},
		});
		try {
			const update = runScript({ ...ctx, args: ['--update-baseline'] });
			assert.equal(update.code, 0);

			// sandbox 内 baseline は更新済
			const sandboxWritten = JSON.parse(readFileSync(ctx.baselinePath, 'utf-8'));
			assert.ok(sandboxWritten.paths['docs/x.md']);
			assert.deepEqual(sandboxWritten.paths['docs/x.md'], ['src/missing-foo.ts']);

			// 本番 baseline は不変
			const realBaselineAfter = existsSync(REAL_BASELINE_PATH)
				? readFileSync(REAL_BASELINE_PATH, 'utf-8')
				: null;
			assert.equal(
				realBaselineAfter,
				realBaselineBefore,
				'本番 baseline は --baseline-path 指定時に絶対に書き換わらない',
			);
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});

	it('#2259 C1 backward compat: 旧 totals フォーマット baseline でも legacy-count フォールバックで読み込む', () => {
		const ctx = setupSandbox({
			files: {
				'docs/legacy.md': '# Legacy\n\nRef: `src/missing-1.ts`\n',
			},
			legacyBaseline: {
				'docs/legacy.md': 1,
			},
		});
		try {
			const result = runScript({ ...ctx, args: ['--json'] });
			// legacy-count mode は count <= baseline なら fail しない
			assert.equal(result.code, 0, 'legacy totals フォーマット baseline で count 維持なら exit 0');
		} finally {
			rmSync(ctx.sandbox, { recursive: true, force: true });
		}
	});
});
