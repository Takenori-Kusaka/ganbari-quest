/**
 * Claude セッションの「安定した持ち主プロセス」を解決する。
 *
 * ## なぜ必要か (Issue #4013)
 *
 * #4009 の agent lock は持ち主を `process.ppid` で記録していたが、**hook の親プロセスは
 * 短命**である。2026-07-27 の実測では、同一 `sessionId` の lock 5 本すべてが別々の
 * `ownerPid` を記録し、取得の 1 分後には全て死んでいた。生存判定
 * (`isProcessAlive(ownerPid)`) が常に false を返すため、lock は取得直後から stale 扱いに
 * なり、**排他がまったく成立していなかった**。
 *
 * ## プロセスツリーの実測 (2026-07-27, Windows / Buzz)
 *
 * ```
 * buzz-acp.exe (30980)                    ← 全セッション共有。ここを持ち主にすると排他が消える
 *   buzz-acp.exe (33476)
 *     cmd.exe (25916)  /d /c ""…\claude-agent-acp.cmd""  ← cmdline に acp 名を含むがシェルなので除外
 *       node.exe @agentclientprotocol/claude-agent-acp (7840)   ← セッションごとに 1 個・常駐
 *         claude.exe (28348 / 33880 / 34768 / 9000 …)           ← 複数・後から増える
 *           bash.exe → bash.exe → node (hook)                   ← process.ppid はこの辺り
 * ```
 *
 * `claude.exe` は 1 セッションに複数存在し (実測で同一 acp 配下に 4 個、起動時刻は
 * 9:09 / 9:22 / 9:23 / 9:31)、持ち主として安定しない。対して **acp の node プロセスは
 * セッション開始時に 1 個だけ作られ常駐する**ので、これを持ち主とする。
 *
 * ## 解決規則
 *
 * `process.ppid` から祖先を辿り、**共有境界 (`buzz-acp`) に到達する前の、最も外側の
 * 「セッションらしい」プロセス**を選ぶ。セッションらしさは
 * 「実行ファイル名が `claude*`」または「コマンドラインに `claude-agent-acp` を含む」で判定する。
 *
 * - Buzz 経由: acp の node プロセスが選ばれる (最も外側)
 * - 素の Claude Code CLI: `claude` プロセスが選ばれる (acp が無いため)
 * - どちらも見つからない: `null` を返す。**呼び出し側は ppid へ黙って戻さず、TTL のみで
 *   判定する**こと (誤った生存判定より、判定しないほうが安全)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** 祖先を辿る上限。無限ループと、境界を越えて OS プロセスまで昇るのを防ぐ。 */
export const MAX_ANCESTOR_DEPTH = 16;

/** 全セッションで共有されるプロセス。ここへ到達したら打ち切る。 */
const SHARED_BOUNDARY =
	/^(buzz-acp(\.exe)?|explorer\.exe|services\.exe|wininit\.exe|systemd|init)$/i;

/**
 * 汎用シェル。持ち主にしない。
 *
 * acp を起動する `cmd.exe` の CommandLine は実測で
 * `cmd.exe /e:ON /v:OFF /d /c ""…\claude-agent-acp.cmd""` であり、
 * コマンドライン一致だけで判定すると**シェルのほうが外側なので選ばれてしまう**。
 * セッションごとに 1 個という性質は満たすが、持ち主として意味を持つのは実体である
 * acp の node プロセスなので、シェルは除外する。
 */
const SHELL_WRAPPER =
	/^(cmd(\.exe)?|bash(\.exe)?|sh|dash|zsh|powershell(\.exe)?|pwsh(\.exe)?|conhost\.exe)$/i;

/**
 * プロセス一覧の 1 行。`snapshotProcesses` / テスト table の共通の形。
 *
 * @typedef {object} ProcInfo
 * @property {number} pid
 * @property {number} ppid
 * @property {string} name 実行ファイル名
 * @property {string} cmd コマンドライン全体
 */

/**
 * セッションの持ち主になりうるか。
 *
 * @param {ProcInfo | undefined} proc
 * @returns {boolean}
 */
function isSessionLike(proc) {
	if (!proc) return false;
	if (SHELL_WRAPPER.test(proc.name ?? '')) return false;
	if (/^claude/i.test(proc.name ?? '')) return true;
	return /claude-agent-acp/i.test(proc.cmd ?? '');
}

/**
 * プロセス表の取得結果。
 *
 * **失敗を戻り値に載せる** (#4094 QA M4)。以前は失敗時に空 Map を返していたため、
 * 呼び出し側は「重い検証が 1 本も走っていない」と区別できなかった。#4083 の主防御は
 * プロセスの実在判定なので、表が取れないことが黙って素通りすると**主防御が無警告で
 * 消える**。空表と取得失敗は別の事実であり、別の値で返す。
 *
 * @typedef {object} ProcessSnapshot
 * @property {Map<number, ProcInfo>} table 取得できたプロセス表 (失敗時は空)
 * @property {boolean} ok 取得に成功したか
 * @property {string | null} error 失敗理由 (成功時 null)
 */

/**
 * テスト用の差し替え口。
 *
 * `AGENT_PROCESS_TABLE_FILE` に `[{pid, ppid, name, cmd}, ...]` の JSON ファイルを
 * 指すと、実プロセス表の代わりにそれを読む。hook 本体 (stdin → 判定 → exit code) を
 * **実プロセスに依存せず**検証するために要る — 実プロセス表を使う test は、たまたま
 * 走っている別セッションの検証プロセスで結果が変わってしまう (それ自体が本 PR で
 * 直している欠陥なので、test が同じ穴を踏んではいけない)。
 *
 * 明示的に env を置いたときだけ有効で、読めなければ **`ok:false`** に倒す (fail closed)。
 *
 * @returns {ProcessSnapshot | null} env 未設定なら null
 */
function readInjectedTable() {
	const path = process.env.AGENT_PROCESS_TABLE_FILE;
	if (!path) return null;
	/** @type {Map<number, ProcInfo>} */
	const table = new Map();
	try {
		const rows = JSON.parse(readFileSync(path, 'utf8'));
		for (const row of Array.isArray(rows) ? rows : []) {
			const pid = Number(row?.pid);
			if (!Number.isInteger(pid)) continue;
			table.set(pid, {
				pid,
				ppid: Number(row?.ppid) || 0,
				name: String(row?.name ?? ''),
				cmd: String(row?.cmd ?? ''),
			});
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			table: new Map(),
			ok: false,
			error: `AGENT_PROCESS_TABLE_FILE を読めません: ${message}`,
		};
	}
	return { table, ok: true, error: null };
}

/**
 * 実行中プロセスの一覧を取得し、**成否つき**で返す。
 *
 * 1 回の spawn で全件を取る。祖先 1 段ごとに spawn すると、hook の実行時間が
 * 段数分だけ伸びるため。
 *
 * @returns {ProcessSnapshot}
 */
export function snapshotProcessesResult() {
	const injected = readInjectedTable();
	if (injected) return injected;

	/** @type {Map<number, ProcInfo>} */
	const table = new Map();
	if (process.platform === 'win32') {
		const script =
			'[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
			'@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) ' +
			'| ConvertTo-Json -Compress -Depth 3';
		let r;
		try {
			r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { table, ok: false, error: `powershell を起動できません: ${message}` };
		}
		if (r.error) return { table, ok: false, error: `powershell 起動失敗: ${r.error.message}` };
		if (r.status !== 0 || !r.stdout) {
			return {
				table,
				ok: false,
				error: `Get-CimInstance が失敗しました (status=${r.status}): ${String(r.stderr ?? '').slice(0, 200)}`,
			};
		}
		let rows;
		try {
			rows = JSON.parse(r.stdout);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { table, ok: false, error: `プロセス表の JSON を解釈できません: ${message}` };
		}
		for (const row of Array.isArray(rows) ? rows : [rows]) {
			const pid = Number(row?.ProcessId);
			if (!Number.isInteger(pid)) continue;
			table.set(pid, {
				pid,
				ppid: Number(row?.ParentProcessId) || 0,
				name: String(row?.Name ?? ''),
				cmd: String(row?.CommandLine ?? ''),
			});
		}
		return { table, ok: true, error: null };
	}

	let r;
	try {
		r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { table, ok: false, error: `ps を起動できません: ${message}` };
	}
	if (r.error) return { table, ok: false, error: `ps 起動失敗: ${r.error.message}` };
	if (r.status !== 0 || !r.stdout) {
		return { table, ok: false, error: `ps が失敗しました (status=${r.status})` };
	}
	for (const line of r.stdout.split('\n')) {
		const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
		if (!m) continue;
		const pid = Number(m[1]);
		table.set(pid, { pid, ppid: Number(m[2]) || 0, name: m[3] ?? '', cmd: m[4] ?? '' });
	}
	return { table, ok: true, error: null };
}

/**
 * 実行中プロセスの一覧を {pid → {pid, ppid, name, cmd}} で返す。
 *
 * **取得失敗を知りたい呼び出し側は `snapshotProcessesResult()` を使うこと。**
 * 本関数は失敗時も空 Map を返すが、その場合は stderr に警告を出す (無言で
 * 主防御を失わないため、#4094 QA M4)。
 *
 * @returns {Map<number, ProcInfo>}
 */
export function snapshotProcesses() {
	const result = snapshotProcessesResult();
	if (!result.ok) {
		process.stderr.write(
			`[session-owner] WARN: プロセス表を取得できませんでした (${result.error})。` +
				' 実在ベースの並走判定は行われていません。\n',
		);
	}
	return result.table;
}

/**
 * 祖先を辿ってセッションの持ち主プロセスを決める。
 *
 * @param {number} startPid 辿り始める PID (通常は `process.ppid`)
 * @param {Map<number, ProcInfo>} [table] プロセス一覧 (テストから差し替える)
 * @returns {{pid: number | null, name: string | null, via: string, chain: number[]}}
 *   `via` は判定経路の記録。lock ファイルに残し、実環境での挙動を後から検証できるようにする。
 */
export function resolveSessionOwner(startPid, table) {
	const procs = table ?? snapshotProcesses();
	if (procs.size === 0) return { pid: null, name: null, via: 'no-process-table', chain: [] };

	/** @type {number[]} */
	const chain = [];
	const seen = new Set();
	/** @type {ProcInfo | null} */
	let owner = null;
	let cursor = Number(startPid);

	for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
		if (!Number.isInteger(cursor) || cursor <= 0 || seen.has(cursor)) break;
		seen.add(cursor);
		const proc = procs.get(cursor);
		if (!proc) break;
		// 共有境界に到達したら、そこから先は全セッションで同じプロセスになる。
		if (SHARED_BOUNDARY.test(proc.name)) break;
		chain.push(proc.pid);
		// 最も外側のセッションらしいプロセスを採用するため、見つけても打ち切らずに更新し続ける。
		if (isSessionLike(proc)) owner = proc;
		cursor = proc.ppid;
	}

	if (!owner) return { pid: null, name: null, via: 'not-found', chain };
	return { pid: owner.pid, name: owner.name, via: 'ancestor', chain };
}
