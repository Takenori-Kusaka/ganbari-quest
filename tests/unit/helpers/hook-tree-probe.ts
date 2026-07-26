/**
 * tests/unit/helpers/hook-tree-probe.ts (#3999)
 *
 * PreToolUse hook を「判定 SSOT (`scripts/lib/is-main.mjs`) を含まない checkout」で起動する probe。
 *
 * ## なぜ temp tree に複製するのか
 *
 * QM が PR #3979 のレビューで踏んだ再現手順は「実 repo の `scripts/lib/is-main.mjs` を
 * `mv` で退避して hook を叩く」だった。これを test でそのまま行うと、同時実行中の他 test /
 * 他セッション / pre-ready を巻き添えで壊す (実際に並走事故が起きている領域である)。
 *
 * 代わりに hook script 1 本だけを temp tree へ複製し、`scripts/lib/is-main.mjs` を
 * **置くか置かないか**だけを切り替える。hook 内の相対 import (`../../scripts/lib/is-main.mjs`
 * / `./lib/is-main.mjs`) は複製先 tree の中で解決されるため、非破壊かつ並列安全に
 * 「依存が欠落した checkout」を再現できる。
 *
 * 関連:
 *   - Issue #3999 AC2 (module 解決失敗を模した probe)
 *   - Issue #3969 / PR #3979 (判定 SSOT 化)
 *   - ADR-0056 (approve gate の設計 SSOT)
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** tests/unit/helpers/ から 3 階層上が repo root */
export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

/** 判定 SSOT の repo 相対パス (POSIX 区切り) */
const IS_MAIN_REL = 'scripts/lib/is-main.mjs';

export interface HookProbeResult {
	status: number | null;
	stdout: string;
	stderr: string;
	/** stdout + stderr (無出力 = main() 未到達の検出に使う) */
	combined: string;
}

export interface HookProbeOptions {
	/** hook script の repo 相対パス (POSIX 区切り、例 `.claude/hooks/gate-approve.mjs`) */
	hookRelPath: string;
	/** false にすると temp tree に `scripts/lib/is-main.mjs` を置かない = import 解決が失敗する */
	withIsMain: boolean;
	/** hook に渡す stdin (Claude Code の PreToolUse payload JSON) */
	stdin: string;
}

function copyInto(root: string, relPath: string): void {
	const dest = path.join(root, ...relPath.split('/'));
	mkdirSync(path.dirname(dest), { recursive: true });
	copyFileSync(path.join(REPO_ROOT, ...relPath.split('/')), dest);
}

/**
 * hook を隔離 tree で起動し、exit code と出力を返す。
 *
 * `cwd` は temp tree root にする。hook が参照する `tmp/adversarial-evidence/` も
 * temp tree 側を見るため、実 repo の evidence file に結果が左右されない。
 */
export function runHookInIsolatedTree(options: HookProbeOptions): HookProbeResult {
	const { hookRelPath, withIsMain, stdin } = options;
	const root = mkdtempSync(path.join(tmpdir(), 'gq-hook-probe-'));
	try {
		copyInto(root, hookRelPath);
		if (withIsMain) copyInto(root, IS_MAIN_REL);

		const res = spawnSync(process.execPath, [path.join(root, ...hookRelPath.split('/'))], {
			cwd: root,
			input: stdin,
			encoding: 'utf8',
		});
		const stdout = `${res.stdout ?? ''}`;
		const stderr = `${res.stderr ?? ''}`;
		return { status: res.status, stdout, stderr, combined: `${stdout}${stderr}` };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/** Claude Code の PreToolUse payload を組み立てる */
export function bashPayload(command: string): string {
	return JSON.stringify({ session_id: 'probe', tool_name: 'Bash', tool_input: { command } });
}
