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

async function main() {
	// 動的 import。解決に失敗しても catch して exit 2 に倒すため static import にしない (#3999)。
	const [
		{ acquire, describeHolder },
		{ isHeavyCommand, extractTarget },
		{ resolveSessionOwner },
	] = await Promise.all([
		import('../../scripts/lib/agent-lock.mjs'),
		import('../../scripts/lib/agent-lock-policy.mjs'),
		import('../../scripts/lib/session-owner.mjs'),
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

	// 対象コマンドでなければ、プロセス一覧の取得 (spawn 1 回) すら不要。
	//
	// `git push` に対する task lock (branch = Issue 単位の二重作業防止) は #4076 で撤去した。
	// hook payload の `cwd` は**セッションの起動ディレクトリ**なので、worktree から push しても
	// main clone の path が来る。そこで `git rev-parse` すると**押す対象と無関係な branch**
	// (main clone が checkout 中のもの) が取れ、別セッションがその branch の lock を持っている
	// だけで worktree からの push が全て BLOCK された。押す対象から branch を割り出す精緻化
	// (refspec 解析 / `git -C` 追跡) は refspec の無い bare `git push` を解決できず穴が残るため、
	// PO 判断 (2026-07-30) で精緻化ではなく撤去を選ぶ。二重作業の検知は GitHub 側 (同一 branch
	// への push 競合 / PR の重複) に委ねる。heavy lock (重い検証のマシン全体排他) は維持する。
	if (!isHeavyCommand(command)) process.exit(0);

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
