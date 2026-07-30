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
	const [
		{ releaseUnlessGuarded },
		{ isHeavyCommand },
		{ resolveSessionOwner, snapshotProcessesResult },
		{ buildGuardedPids },
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
		return;
	}

	const command = payload?.tool_input?.command ?? '';
	if (!isHeavyCommand(command)) return;

	// 取得時と解放時で `process.ppid` は別プロセスになる。PID で照合すると解放が
	// 永久に no-op になり lock が残り続けるため、`sessionId` を第一の照合キーにする (#4013)。
	// `sessionId` が取れない実行環境でだけ、祖先を辿って持ち主 PID を解決する。
	const sessionId = payload?.session_id ?? null;

	// **走行中の検証プロセスがあれば解放しない** (#4083 AC1)。
	// PostToolUse は「Bash tool が終わった」時点で走るが、ハーネスが tool を kill した
	// 場合、検証プロセスは detach したまま生き続ける。そこで無条件に解放すると
	// 「走っているのに lock が無い」時間帯が生まれ、第三者が並列に検証を始められる。
	//
	// ただし保護対象は **自セッションが起動した検証だけ** に限る (#4094 QA M1)。
	// マシン全体の heavy プロセスを書き込むと、別クローンのセッション / hook を読み込まない
	// Buzz セッション / 人間の `vitest --watch` / #4083 のオーファンまで自分の lock に
	// 入り、`isStale` が guarded の生存を TTL より優先するせいで**誰も奪えない**状態が
	// 生まれる。これは #4076 が直そうとしている「無関係を止める」の再導入である。
	const snapshot = snapshotProcessesResult();
	if (!snapshot.ok) {
		process.stderr.write(
			`[heavy-run-unlock] WARN: プロセス表を取得できませんでした (${snapshot.error})。` +
				' 走行中の検証を保護できないため、lock は通常どおり解放されます。\n',
		);
	}
	// 解放の照合は sessionId を第一キーにするが、**保護範囲の判定には PID が要る**ため
	// セッションプロセスは常に解決する (照合キーとは別の役割、#4013 の 2 分割と同じ)。
	const session = resolveSessionOwner(process.ppid, snapshot.table);
	const owner = sessionId ? { sessionId, ownerPid: null } : { sessionId: null, ownerPid: session.pid };
	const guarded = buildGuardedPids({ table: snapshot.table, ownerPid: session.pid });
	const result = releaseUnlessGuarded(HEAVY_KEY, owner, guarded);
	if (!result.released && result.guardedPids.length > 0) {
		process.stderr.write(
			`[heavy-run-unlock] 保持継続: 検証プロセスが走行中のため lock を返しません (pid=${result.guardedPids.join(', ')})。\n`,
		);
	}
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
