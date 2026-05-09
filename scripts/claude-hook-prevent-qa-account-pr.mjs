#!/usr/bin/env node

/**
 * scripts/claude-hook-prevent-qa-account-pr.mjs (#1879)
 *
 * Claude Code `PreToolUse` hook で呼出される検査スクリプト。
 *
 * 機能:
 *   stdin から Claude Code が渡す tool_input JSON を読み取り、Bash command 文字列に
 *   `gh pr create` が含まれているとき、active gh アカウントが Takenori-Kusaka 以外
 *   (典型的には ganbariquestsupport-lab) なら exit 2 で abort する。
 *   exit 2 は Claude Code に「ブロッキング error として LLM にフィードバック」される
 *   仕様 (PreToolUse hook の規約)。
 *
 * 入力 (stdin, JSON):
 *   {
 *     "session_id": "...",
 *     "tool_name": "Bash",
 *     "tool_input": { "command": "gh pr create --title ...", ... }
 *   }
 *
 * 出力:
 *   - 通過時: exit 0 (stdout/stderr 何も出さない、Claude にも干渉しない)
 *   - abort 時: exit 2 + stderr に対処方法を出力
 *
 * 関連:
 *   - ADR-0022 amendment 1 / amendment 3 (#1879)
 *   - scripts/check-gh-account-before-pr.mjs (.husky/pre-push 経由で同等チェック)
 *   - .claude/settings.json (PreToolUse 設定)
 *   - docs/sessions/qa-session.md L162 周辺
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_PR_AUTHOR_DEFAULT = 'Takenori-Kusaka';
export const QA_ACCOUNT = 'ganbariquestsupport-lab';

const ALLOWED_PR_AUTHOR = process.env.ALLOWED_PR_AUTHOR ?? ALLOWED_PR_AUTHOR_DEFAULT;

/**
 * stdin (Claude Code が渡す JSON) を全部読み取る。
 */
async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/**
 * Bash command 文字列が `gh pr create` を含むか判定。
 *
 * #1994 で検出範囲を拡張: `gh api repos/.../pulls` 等の REST API 直接呼び出しも
 * PR 作成相当の操作として捕捉する。`gh pr create` だけを見ると Claude / Agent が
 * 同等操作を `gh api` 経由で行った場合 hook をすり抜けるため。
 *
 * 単純な部分一致で誤検知を許容（誤検知側に倒す方が安全）。
 *
 * @param {unknown} command  Bash tool_input.command 文字列
 * @returns {boolean}        対象操作なら true
 */
export function containsGhPrCreate(command) {
	if (typeof command !== 'string') return false;
	if (/\bgh\s+pr\s+create\b/.test(command)) return true;
	// `gh api repos/<owner>/<repo>/pulls` で POST する経路 (#1994)
	// `--method POST` 明示 / `-X POST` / 明示なしの POST default を全て捕捉する。
	// false-positive: `gh api repos/.../pulls/123/comments` 等の subresource にも match するが、
	// QA セッションで PR 作成系操作以外で QA アカウントから `gh api .../pulls` を叩く合理的経路は無く、
	// 過剰停止のコストは「違反 PR 起票による品質ゲート崩壊コスト」より十分小さい。
	if (/\bgh\s+api\b[^\n]*\/pulls\b/.test(command)) return true;
	return false;
}

/**
 * `gh auth status` 出力から active アカウントを抽出する純粋関数。
 *
 * @param {string} output  spawnSync('gh', ['auth', 'status']).stdout + stderr
 * @returns {string|null}  active な login 名、または見つからない場合 null
 */
export function parseActiveAccount(output) {
	const lines = String(output ?? '').split(/\r?\n/);
	let lastLogin = null;
	for (const line of lines) {
		const loginMatch = line.match(/Logged in to github\.com account ([\w-]+)/);
		if (loginMatch) {
			lastLogin = loginMatch[1];
			continue;
		}
		const activeMatch = line.match(/Active account:\s*(true|false)/i);
		if (activeMatch && activeMatch[1]?.toLowerCase() === 'true' && lastLogin) {
			return lastLogin;
		}
	}
	return null;
}

/**
 * `gh auth status` を実行し active アカウントを取得 (副作用あり)。
 * scripts/check-gh-account-before-pr.mjs と同等のロジック (DRY 維持)。
 */
function extractActiveAccount() {
	const result = spawnSync('gh', ['auth', 'status'], {
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});
	if (result.error || result.status !== 0) {
		return null;
	}
	return parseActiveAccount(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

async function main() {
	let payload;
	try {
		const raw = await readStdin();
		payload = raw.trim() ? JSON.parse(raw) : {};
	} catch {
		// JSON parse 失敗時は通過させる (hook の異常で Claude を止めない)
		process.exit(0);
	}

	const command = payload?.tool_input?.command;
	if (!containsGhPrCreate(command)) {
		// gh pr create 以外は対象外
		process.exit(0);
	}

	const active = extractActiveAccount();
	if (!active) {
		// gh auth が未ログイン等で判定不能 → 通過 (既存 scripts/check-gh-account-before-pr.mjs が
		// 別経路で fail させる。hook 側で過剰停止しない)
		process.exit(0);
	}

	if (active === ALLOWED_PR_AUTHOR) {
		process.exit(0);
	}

	// 違反検出 → exit 2 で Claude にブロッキング通知
	const isQa = active === QA_ACCOUNT;
	process.stderr.write(
		`[claude-hook-prevent-qa-account-pr] BLOCK: active gh account = ${active} で \`gh pr create\` を実行しようとしました。\n`,
	);
	if (isQa) {
		process.stderr.write(
			`  ${QA_ACCOUNT} は QA レビュー (approve / merge) 専用アカウントです。PR 作成は禁止 (ADR-0022 amendment 1 / #1728 / #1879)。\n`,
		);
	}
	process.stderr.write(
		`  対処: \`gh auth switch --user ${ALLOWED_PR_AUTHOR}\` で Dev アカウントに切替えてから再実行してください。\n`,
	);
	process.exit(2);
}

// CLI として直接実行されたときのみ main() を呼ぶ。`import` 経由 (unit test 等) では実行されない。
const isDirectInvocation =
	process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
	main();
}
