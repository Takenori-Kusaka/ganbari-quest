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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
	/**
	 * `withIsMain: true` のとき、実物を複製する代わりにこの中身で `scripts/lib/is-main.mjs` を作る。
	 *
	 * 「module は解決できるが `isMain` を export していない」劣化 module を模すのに使う。
	 * import 解決失敗 (`ERR_MODULE_NOT_FOUND`) とは別経路で、こちらは `isMain` が `undefined`
	 * になるため呼び出すと `TypeError` になる = 素通し側に倒れうる。
	 */
	isMainSource?: string;
	/**
	 * 複製から **除外** する repo 相対パス (#4075)。
	 *
	 * `is-main.mjs` 以外の sibling module (`./command-execution-tools.mjs` 等) が欠落した
	 * checkout を再現するために使う。#3999 が `is-main.mjs` だけを fail-closed 化した結果、
	 * 同 class の穴が別の import に残っていた (= 同 class の網羅漏れ) ことを probe できる。
	 */
	omitRelPaths?: string[];
	/** hook プロセスに追加で渡す環境変数 (`CLAUDE_SUBAGENT_ID` 等) */
	env?: Record<string, string>;
	/** hook に渡す stdin (Claude Code の PreToolUse payload JSON) */
	stdin: string;
}

function copyInto(root: string, relPath: string): void {
	const dest = path.join(root, ...relPath.split('/'));
	mkdirSync(path.dirname(dest), { recursive: true });
	copyFileSync(path.join(REPO_ROOT, ...relPath.split('/')), dest);
}

/**
 * hook script が相対パスで import している `.mjs` module を複製する (static / dynamic 両方)。
 *
 * `scripts/lib/is-main.mjs` (= 意図的に有無を切り替える対象) と違い、これらは
 * **probe が再現したい欠落ではなく、単に一緒に無いと hook が起動しない付随依存**である。
 * 明示列挙にすると依存が増えるたびに probe が腐って「fail-closed が効いた」ではなく
 * 「依存が無くて落ちた」を測る test に化けるため、hook 本文から機械的に抽出する。
 *
 * 対象は `./` / `../` 始まりの相対 import 全部 (#4027 で `.claude/hooks/gate-approve.mjs` が
 * `../../scripts/lib/gh-command.mjs` を、`scripts/claude-hook-prevent-qa-account-pr.mjs` が
 * `./lib/gh-command.mjs` を読むようになったため、同階層限定では足りない)。
 * `is-main.mjs` だけは **除外** し、`withIsMain` の明示制御に委ねる。
 */
function copyRelativeImports(root: string, hookRelPath: string, omit: string[] = []): void {
	const hookDir = hookRelPath.split('/').slice(0, -1).join('/');
	const source = readFileSync(path.join(REPO_ROOT, ...hookRelPath.split('/')), 'utf8');
	// `from '<rel>'` (static) と `import('<rel>')` (dynamic) の両方を拾う
	const patterns = [/from\s+'(\.[^']+\.mjs)'/g, /import\(\s*'(\.[^']+\.mjs)'\s*\)/g];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			const spec = match[1] as string;
			// hookDir 基準で解決して repo 相対 (POSIX 区切り) に正規化する
			const rel = path.posix.normalize(path.posix.join(hookDir, spec));
			if (rel === IS_MAIN_REL) continue; // withIsMain で制御する対象は複製しない
			if (omit.includes(rel)) continue; // 欠落を再現したい module (#4075)
			copyInto(root, rel);
		}
	}
}

/**
 * hook を隔離 tree で起動し、exit code と出力を返す。
 *
 * `cwd` は temp tree root にする。hook が参照する `tmp/adversarial-evidence/` も
 * temp tree 側を見るため、実 repo の evidence file に結果が左右されない。
 */
export function runHookInIsolatedTree(options: HookProbeOptions): HookProbeResult {
	const { hookRelPath, withIsMain, isMainSource, stdin, omitRelPaths, env } = options;
	const root = mkdtempSync(path.join(tmpdir(), 'gq-hook-probe-'));
	try {
		copyInto(root, hookRelPath);
		copyRelativeImports(root, hookRelPath, omitRelPaths);
		if (withIsMain) {
			if (isMainSource === undefined) {
				copyInto(root, IS_MAIN_REL);
			} else {
				const dest = path.join(root, ...IS_MAIN_REL.split('/'));
				mkdirSync(path.dirname(dest), { recursive: true });
				writeFileSync(dest, isMainSource, 'utf8');
			}
		}

		const res = spawnSync(process.execPath, [path.join(root, ...hookRelPath.split('/'))], {
			cwd: root,
			input: stdin,
			encoding: 'utf8',
			// `CLAUDE_SUBAGENT_ID` は実セッションの env に混ざりうる。probe 側で明示指定が
			// 無いときは必ず外し、「たまたま env が立っていたので通った」を作らない (#4082 R2)。
			env: { ...process.env, CLAUDE_SUBAGENT_ID: undefined, ...env },
		});
		const stdout = `${res.stdout ?? ''}`;
		const stderr = `${res.stderr ?? ''}`;
		return { status: res.status, stdout, stderr, combined: `${stdout}${stderr}` };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/**
 * `isMain` を export しない `scripts/lib/is-main.mjs` の代替中身。
 *
 * import は成功するが `isMain` が `undefined` になるため、hook が素朴に呼ぶと `TypeError`
 * (= exit 1 = 素通し) になる。`isMainSource` に渡して「劣化 module」を再現する。
 */
export const IS_MAIN_WITHOUT_EXPORT = 'export const somethingElse = true;\n';

/** Claude Code の PreToolUse payload を組み立てる */
export function bashPayload(command: string): string {
	return JSON.stringify({ session_id: 'probe', tool_name: 'Bash', tool_input: { command } });
}
