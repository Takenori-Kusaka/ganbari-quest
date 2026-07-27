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
 * 実行中プロセスの一覧を {pid → {pid, ppid, name, cmd}} で返す。
 *
 * 1 回の spawn で全件を取る。祖先 1 段ごとに spawn すると、hook の実行時間が
 * 段数分だけ伸びるため。
 *
 * @returns {Map<number, ProcInfo>}
 */
export function snapshotProcesses() {
	/** @type {Map<number, ProcInfo>} */
	const table = new Map();
	if (process.platform === 'win32') {
		const script =
			'[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
			'@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) ' +
			'| ConvertTo-Json -Compress -Depth 3';
		const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		});
		if (r.status !== 0 || !r.stdout) return table;
		let rows;
		try {
			rows = JSON.parse(r.stdout);
		} catch {
			return table;
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
		return table;
	}

	const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' });
	if (r.status !== 0 || !r.stdout) return table;
	for (const line of r.stdout.split('\n')) {
		const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
		if (!m) continue;
		const pid = Number(m[1]);
		table.set(pid, { pid, ppid: Number(m[2]) || 0, name: m[3] ?? '', cmd: m[4] ?? '' });
	}
	return table;
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
