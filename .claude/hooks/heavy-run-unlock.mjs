#!/usr/bin/env node

/**
 * .claude/hooks/heavy-run-unlock.mjs
 *
 * Claude Code `PostToolUse` hook。`heavy-run-lock.mjs` が取った lock を、コマンド終了後に返す。
 *
 * ## 解放できなかった場合に block しない理由
 *
 * PreToolUse と違い、ここでの失敗は「既に実行が終わった後」である。block しても実行は
 * 取り消せず、次のコマンドを止めるだけで益がない。解放漏れは lock 側の生存判定
 * (`ownerPid` の死亡 / TTL 超過) が回収するため、**exit 0 で通し stderr に警告のみ**出す。
 *
 * つまり本 hook は「早く返すための最適化」であって、正しさの担保は lock 側にある。
 *
 * ## 関連
 *   - .claude/hooks/heavy-run-lock.mjs (取得側)
 *   - scripts/lib/agent-lock.mjs (生存判定・TTL)
 *   - docs/sessions/agent-concurrency.md
 */

const HEAVY_KEY = 'heavy';

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString('utf8');
}

async function main() {
	const [{ release }, { isHeavyCommand }, { resolveSessionOwner }] = await Promise.all([
		import('../../scripts/lib/agent-lock.mjs'),
		import('../../scripts/lib/agent-lock-policy.mjs'),
		import('../../scripts/lib/session-owner.mjs'),
	]);

	const raw = await readStdin();
	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		return;
	}

	const command = payload?.tool_input?.command ?? '';
	if (!isHeavyCommand(command)) return;

	// 取得時と解放時で `process.ppid` は別プロセスになる。PID で照合すると解放が
	// 永久に no-op になり lock が残り続けるため、`sessionId` を第一の照合キーにする (#4013)。
	// `sessionId` が取れない実行環境でだけ、祖先を辿って持ち主 PID を解決する。
	const sessionId = payload?.session_id ?? null;
	const owner = sessionId ? { sessionId, ownerPid: null } : resolveSessionOwner(process.ppid);
	release(HEAVY_KEY, sessionId ? owner : { sessionId: null, ownerPid: owner.pid });
}

main()
	.catch((err) => {
		process.stderr.write(
			`[heavy-run-unlock] WARN: lock を解放できませんでした (${err?.message})。` +
				' 保持者プロセスの終了または TTL 満了で自動回収されます。\n',
		);
	})
	.finally(() => {
		process.exit(0);
	});
