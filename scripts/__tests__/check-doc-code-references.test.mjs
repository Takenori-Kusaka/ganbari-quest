/**
 * scripts/__tests__/check-doc-code-references.test.mjs
 *
 * #2240 Split A — check-doc-code-references.mjs CLI 動作テスト。
 *
 * 実行: node --test scripts/__tests__/check-doc-code-references.test.mjs
 *
 * テストケースは以下の主要動作を網羅する:
 * 1. baseline 内 (totalViolations == baseline) → exit 0
 * 2. baseline 超過 (1 ファイル +1 件) → exit 1
 * 3. Deprecated marker (`<!-- doc-status: deprecated -->`) で該当ファイルが skip される
 * 4. fenced code block (` ```bash ... ``` `) 内のパスは検出対象外
 * 5. inline code と bare path の区別
 *
 * テスト方針: 本番の `docs/` / `CLAUDE.md` には触らず、tmpdir に最小ドキュメント
 * 構成を作って sandbox cwd で実行する。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_PATH = path.resolve(path.dirname(__filename), '..', 'check-doc-code-references.mjs');

/**
 * sandbox dir に最小構成 (docs/ + 任意 md ファイル) を作る。
 * baseline 必要なら baseline 引数を渡す。
 */
function setupSandbox({ files = {}, baseline = null } = {}) {
	const sandbox = mkdtempSync(path.join(tmpdir(), 'check-doc-code-references-'));
	mkdirSync(path.join(sandbox, 'docs'), { recursive: true });
	mkdirSync(path.join(sandbox, 'src'), { recursive: true });
	mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });

	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(sandbox, rel);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	}

	if (baseline) {
		writeFileSync(
			path.join(sandbox, 'scripts/doc-code-references-baseline.json'),
			JSON.stringify({ totals: baseline }),
		);
	}

	return sandbox;
}

/**
 * sandbox 内でスクリプトを実行し { code, stdout, stderr } を返す。
 */
function runScript(sandbox, args = []) {
	try {
		const stdout = execFileSync('node', [SCRIPT_PATH, ...args], {
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
		const sandbox = setupSandbox({
			files: {
				'docs/sample.md': '# OK\n\nReference: `src/existing-file.ts`\n',
				'src/existing-file.ts': '// real file',
			},
		});
		try {
			const result = runScript(sandbox, ['--json']);
			assert.equal(result.code, 0);
			const json = JSON.parse(result.stdout);
			assert.equal(json.totalViolations, 0);
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});

	it('baseline 超過 → exit 1', () => {
		const sandbox = setupSandbox({
			files: {
				'docs/bad.md': '# Bad\n\nRef: `src/nonexistent/foo.ts`\n',
			},
			baseline: {}, // 何も pin されていない状態
		});
		try {
			const result = runScript(sandbox);
			assert.equal(result.code, 1);
			assert.match(result.stderr + result.stdout, /baseline exceeded|EXCEEDS/);
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});

	it('Deprecated marker (`<!-- doc-status: deprecated -->`) でファイル全体が skip される', () => {
		const sandbox = setupSandbox({
			files: {
				'docs/old.md':
					'# Old\n\n<!-- doc-status: deprecated -->\n\nObsolete ref: `src/gone-away.ts`\n',
			},
			baseline: {}, // 違反を pin していない
		});
		try {
			const result = runScript(sandbox, ['--json']);
			assert.equal(result.code, 0, 'Deprecated marker があれば違反として上がってこない');
			const json = JSON.parse(result.stdout);
			assert.equal(json.totalViolations, 0);
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});

	it('fenced code block 内の bare path は検出対象外', () => {
		const sandbox = setupSandbox({
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
			const result = runScript(sandbox, ['--json']);
			assert.equal(result.code, 0, 'fenced code block 内のパスは違反として検出されない');
			const json = JSON.parse(result.stdout);
			assert.equal(json.totalViolations, 0);
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});

	it('--update-baseline で baseline 更新後の再実行は exit 0', () => {
		const sandbox = setupSandbox({
			files: {
				'docs/many-bad.md': '# Many\n\nRef A: `src/missing-a.ts`\nRef B: `src/missing-b.ts`\n',
			},
			baseline: {},
		});
		try {
			const update = runScript(sandbox, ['--update-baseline']);
			assert.equal(update.code, 0);
			const verify = runScript(sandbox);
			assert.equal(verify.code, 0, 'baseline 更新後は既存違反が pin され exit 0');
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});

	it('inline code と bare path を区別表示する', () => {
		const sandbox = setupSandbox({
			files: {
				'docs/mixed.md': '# Mixed\n\nInline: `src/missing-inline.ts`\nBare: src/missing-bare.ts\n',
			},
			baseline: {},
		});
		try {
			const result = runScript(sandbox);
			assert.equal(result.code, 1);
			const out = result.stderr + result.stdout;
			assert.match(out, /inline code/);
			assert.match(out, /bare path/);
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});
});
