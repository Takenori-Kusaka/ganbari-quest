#!/usr/bin/env node

/**
 * .claude/hooks/heavy-run-lock.mjs
 *
 * Claude Code `PreToolUse` hook。重い検証コマンド (pre-ready / vitest / playwright /
 * svelte-check) の実行前に**マシン全体で 1 本**の lock を取り、取れなければ exit 2 で block する。
 *
 * ## なぜ hook か (CLAUDE.md の記述では足りない理由)
 *
 * 並走を止める規律を prompt に書いても、それを読むのは**自分のセッションだけ**である。
 * 実際に踏むのは他セッションであり、他セッションのプロセスを kill するのは相手の証跡を
 * 壊す破壊的操作なので取れない。よって「各セッションの自制」では原理的に防げない。
 * 決定論的に効く層 = hook でしか止められない。
 *
 * ## 入力 (stdin, JSON)
 *
 *   { "session_id": "...", "tool_name": "Bash", "tool_input": { "command": "npm run pre-ready" } }
 *
 * ## 出力
 *
 *   - allow: exit 0 (無出力)
 *   - block: exit 2 + stderr に保持者と対処
 *
 * **exit 1 は block にならない** (Claude Code の PreToolUse は exit 2 のみ block)。
 * 想定外の例外で exit 1 に落ちると素通しになるため、本 hook は全経路を try/catch で
 * 囲み、判定不能はすべて exit 2 (fail closed) にする。これは Issue #3999 で
 * `gate-approve.mjs` が踏んだ失敗モードと同一 class である。
 *
 * ## 関連
 *   - scripts/lib/agent-lock.mjs (lock 実体)
 *   - scripts/lib/agent-lock-policy.mjs (対象コマンド判定)
 *   - .claude/hooks/heavy-run-unlock.mjs (PostToolUse で解放)
 *   - docs/sessions/agent-concurrency.md (運用 SSOT)
 */

const HEAVY_KEY = 'heavy';

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString('utf8');
}

function blockWithHolder(holder, describeHolder) {
	process.stderr.write('[heavy-run-lock] BLOCK: 重い検証が既に別セッションで実行中です。\n');
	process.stderr.write(`  保持者: ${describeHolder(holder)}\n`);
	process.stderr.write('  対処 (待たない):\n');
	process.stderr.write('    1. チャンネルに「他セッションが重い検証中のため見送った」と報告する\n');
	process.stderr.write('    2. PR 本文整備 / Issue 起票 / レビュー対応など別の作業に移る\n');
	process.stderr.write('    3. CI で代替できるならローカル実行を諦めて CI を正とする\n');
	process.stderr.write(
		'  Why: 並走した検証結果は「落ちた」も「通った」も根拠にならない (docs/sessions/agent-concurrency.md)\n',
	);
	process.exit(2);
}

/**
 * 現在の branch 名を返す。取得できなければ null (task lock は諦めて heavy 判定のみ行う)。
 * git 呼び出しは push 系コマンドのときだけ行う — 全 Bash 呼び出しで毎回 spawn すると遅い。
 *
 * `cwd` は **コマンドが実行される場所** を渡す (`resolveCommandCwd`)。hook プロセスの
 * `process.cwd()` はセッションの起動ディレクトリであり、Buzz エージェントではリポジトリ外
 * (`~/.buzz`) になる (#4013)。加えて payload の cwd も「セッションの作業ディレクトリ」
 * であってコマンドの実行先とは限らない (#4076)。
 *
 * @param {string | null} cwd
 */
async function currentBranch(cwd) {
	const { spawnSync } = await import('node:child_process');
	const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
		encoding: 'utf8',
		cwd: cwd || undefined,
	});
	if (r.status !== 0) return null;
	return (r.stdout || '').trim() || null;
}

/**
 * イメージ名一括 kill を止める (#4069 AC4)。
 *
 * @param {string} command
 */
function blockBulkKill(command) {
	process.stderr.write(
		'[heavy-run-lock] BLOCK: 全 node プロセスの一括停止は、他セッションの実行中検証を巻き込みます。\n',
	);
	process.stderr.write(`  検出したコマンド: ${command}\n`);
	process.stderr.write('  対処 (所有権単位で掃除する):\n');
	process.stderr.write('    1. npm run agent:cleanup           # 自分の残骸を一覧 (kill しない)\n');
	process.stderr.write('    2. npm run agent:cleanup -- --kill  # lock 保持者を除外して自分の分だけ停止\n');
	process.stderr.write('    3. 特定 PID だけ落とす場合は taskkill /F /PID <pid> を使う\n');
	process.stderr.write(
		'  Why: 2026-07-29 に `taskkill /F /IM node.exe` が lock 保持中の別セッション (PR #4063) を停止させた (#4069)\n',
	);
	process.exit(2);
}

async function main() {
	// 動的 import。解決に失敗しても catch して exit 2 に倒すため static import にしない (#3999)。
	const [
		{ acquire, describeHolder },
		{
			isHeavyCommand,
			isBranchPublishCommand,
			isBulkProcessKillCommand,
			extractTarget,
			taskKeyFromBranch,
			resolvePushRefBranch,
			resolveCommandCwd,
		},
		{ resolveSessionOwner, snapshotProcesses },
		{ findHeavyProcesses, collectDescendants },
	] = await Promise.all([
		import('../../scripts/lib/agent-lock.mjs'),
		import('../../scripts/lib/agent-lock-policy.mjs'),
		import('../../scripts/lib/session-owner.mjs'),
		import('../../scripts/lib/heavy-process.mjs'),
	]);

	const raw = await readStdin();
	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		// tool_input が読めない = 重い検証かどうか判定できない。素通しはしない。
		process.stderr.write('[heavy-run-lock] BLOCK: hook への入力 JSON を解釈できませんでした。\n');
		process.exit(2);
	}

	const command = payload?.tool_input?.command ?? '';
	const sessionId = payload?.session_id ?? null;
	const cwd = payload?.cwd ?? process.cwd();

	// イメージ名一括 kill は lock とは別軸で止める (#4069 AC4)。
	if (isBulkProcessKillCommand(command)) blockBulkKill(command);

	// 対象コマンドでなければ、プロセス一覧の取得 (spawn 1 回) すら不要。
	const needsLock = isBranchPublishCommand(command) || isHeavyCommand(command);
	if (!needsLock) process.exit(0);

	// `process.ppid` は hook 呼び出しごとに変わる短命プロセスなので持ち主にできない (#4013)。
	// 祖先を辿ってセッションプロセスを取り、解決できなければ PID なし (TTL のみ) で記録する。
	const owner = resolveSessionOwner(process.ppid);
	const common = {
		ownerPid: owner.pid,
		ownerVia: owner.via,
		// 辿った祖先鎖をそのまま残す。hook 経路の実祖先鎖は登録するまで観測できないため、
		// 「意図した acp の node を選べているか」を lock ファイルだけで後から検証できる
		// ようにしておく (#4013)。
		ownerChain: owner.chain,
		agent: process.env.BUZZ_AGENT_NAME ?? null,
		sessionId,
		cwd,
	};

	// task lock: 同じ branch (= 同じ Issue) を 2 セッションが押すのを止める。
	// 判定対象は **push しようとしている branch** であって、セッションの cwd が
	// checkout している branch ではない (#4076)。
	if (isBranchPublishCommand(command)) {
		const branch =
			resolvePushRefBranch(command) ?? (await currentBranch(resolveCommandCwd(command, cwd)));
		const key = taskKeyFromBranch(branch);
		if (key) {
			const claimed = acquire(key, { ...common, target: branch, ttlMs: 4 * 60 * 60 * 1000 });
			if (!claimed.ok) {
				process.stderr.write(
					`[heavy-run-lock] BLOCK: branch ${branch} は別セッションが作業中です。\n`,
				);
				process.stderr.write(`  保持者: ${describeHolder(claimed.holder)}\n`);
				process.stderr.write(
					'  対処: 二重作業です。チャンネルで担当を確認し、どちらが進めるかを決めてから再実行してください。\n',
				);
				process.exit(2);
			}
		}
	}

	if (!isHeavyCommand(command)) process.exit(0);

	// 排他の判定は lock ファイルの有無ではなく **保護対象プロセスの実在** に紐づける (#4083 AC2)。
	// 起動元セッションが先に終了すると lock だけが消え、走行中の検証と並列に 2 本目が
	// 始められてしまう。プロセス表を直接見ることで、lock が無くても並走を止める。
	// 自分の系列 (セッションプロセスの子孫) は除外する — 自分自身を BLOCK しないため。
	const procTable = snapshotProcesses();
	const ownPids = owner.pid ? [owner.pid, ...collectDescendants(procTable, owner.pid)] : [];
	const running = findHeavyProcesses(procTable, { excludePids: ownPids });
	if (running.length > 0) {
		process.stderr.write(
			'[heavy-run-lock] BLOCK: 重い検証プロセスが実際に走っています (lock ファイルの有無に関わらず並走させません)。\n',
		);
		for (const proc of running) {
			process.stderr.write(`  実行中: pid=${proc.pid} / ${proc.cmd.slice(0, 160)}\n`);
		}
		process.stderr.write('  対処 (待たない):\n');
		process.stderr.write('    1. チャンネルに「他セッションが重い検証中のため見送った」と報告する\n');
		process.stderr.write('    2. PR 本文整備 / Issue 起票 / レビュー対応など別の作業に移る\n');
		process.stderr.write(
			'    3. 上記が自分の残骸 (起動元セッションが終了済) なら `npm run agent:cleanup -- --kill` で回収する\n',
		);
		process.stderr.write(
			'  Why: 並走した検証結果は「落ちた」も「通った」も根拠にならない (docs/sessions/agent-concurrency.md)\n',
		);
		process.exit(2);
	}

	const result = acquire(HEAVY_KEY, { ...common, target: extractTarget(command) });
	if (result.ok) process.exit(0);
	blockWithHolder(result.holder, describeHolder);
}

main().catch((err) => {
	// lock ディレクトリが読めない / lock が壊れている等。排他が成立しているか判定できない。
	process.stderr.write(`[heavy-run-lock] BLOCK: lock の判定に失敗しました: ${err?.message}\n`);
	process.stderr.write(
		'  対処: ~/.buzz/.locks/ の権限と中身を確認する。壊れた lock は内容を確認してから削除する。\n',
	);
	process.exit(2);
});
