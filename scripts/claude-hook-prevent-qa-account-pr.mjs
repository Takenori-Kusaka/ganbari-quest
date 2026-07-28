#!/usr/bin/env node

/**
 * scripts/claude-hook-prevent-qa-account-pr.mjs (#1879)
 *
 * Claude Code `PreToolUse` hook で呼出される検査スクリプト。
 *
 * 機能:
 *   stdin から Claude Code が渡す tool_input JSON を読み取り、command 文字列が
 *   **PR 作成に相当する操作** (`gh pr create` / `gh api` の pulls コレクションへの POST) を
 *   含むとき、active gh アカウントが Takenori-Kusaka 以外
 *   (典型的には ganbariquestsupport-lab) なら exit 2 で abort する。
 *   approve / merge / comment 等の subresource 操作は対象外 (#4027)。
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
import {
	findGhInvocations,
	isPullsCollectionPath,
	parseGhApiInvocation,
	sanitizeForDetection,
} from './lib/gh-command.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

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
 * command 文字列が「PR 作成」に相当する操作を含むか判定し、捕捉した実コマンドを返す (#4027)。
 *
 * 判定対象は **サブコマンドと API パス**のみ。`--body` / `--body-file` / heredoc の中身は
 * `sanitizeForDetection` で落としてから評価する (引数値に書かれた例示コマンドで止めない)。
 *
 * PR 作成とみなす形:
 *   - `gh pr create`
 *   - `gh api` の **`repos/<owner>/<repo>/pulls` コレクションへの POST** (#1994 の REST 迂回対策)
 *   - `gh api graphql` の POST で `createPullRequest` mutation を投げる形
 *
 * PR 作成とみなさない形 (#4027 で是正):
 *   - `repos/.../pulls/<n>/reviews` (= QM の approve。`docs/sessions/qa-session.md` が SSOT として
 *     掲げる正規経路であり、旧実装の `/pulls` 部分一致では必ず BLOCK されていた)
 *   - `repos/.../pulls/<n>/{merge,comments,files,…}` 等の subresource
 *   - `repos/.../pulls` への GET (一覧取得)
 *
 * コレクション判定はパスの query / fragment / 末尾スラッシュ / `https://api.github.com` prefix を
 * 落としてから行うため、`repos/o/r/pulls?ref=/pulls/1/reviews` のように「subresource に見せかけた
 * コレクション POST」も PR 作成として捕捉する。
 *
 * @param {unknown} command  tool_input.command 文字列
 * @returns {{ blocked: boolean; kind?: string; matched?: string }}
 */
export function detectPrCreation(command) {
	if (typeof command !== 'string') return { blocked: false };
	const sanitized = sanitizeForDetection(command);
	if (/\bgh(?:\.exe)?\s+pr\s+create\b/.test(sanitized)) {
		const m = sanitized.match(/\bgh(?:\.exe)?\s+pr\s+create\b[^\n;|&]*/);
		return { blocked: true, kind: 'gh pr create', matched: (m?.[0] ?? sanitized).trim() };
	}
	for (const { segment, argv } of findGhInvocations(sanitized)) {
		const api = parseGhApiInvocation(argv);
		if (!api.isApi || api.method !== 'POST') continue;
		if (api.paths.some((p) => isPullsCollectionPath(p))) {
			return { blocked: true, kind: 'gh api (pulls コレクションへの POST)', matched: segment };
		}
		// graphql は path が 1 種類しかないため、mutation 名で PR 作成かを判別する。
		// mutation 本文は引用符ごと token 分割されるので segment 全体 (body / heredoc は除去済) を見る。
		if (api.paths.includes('graphql') && /createPullRequest/i.test(segment)) {
			return {
				blocked: true,
				kind: 'gh api graphql (createPullRequest mutation)',
				matched: segment,
			};
		}
	}
	return { blocked: false };
}

/**
 * `detectPrCreation` の boolean ラッパ (既存呼出し互換)。
 *
 * @param {unknown} command  tool_input.command 文字列
 * @returns {boolean}        対象操作なら true
 */
export function containsGhPrCreate(command) {
	return detectPrCreation(command).blocked;
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

/**
 * BLOCK メッセージ用にコマンドを 1 行へ丸める (#4027)。
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max = 300) {
	const oneLine = String(text).replace(/\s+/g, ' ').trim();
	return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
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
	const detection = detectPrCreation(command);
	if (!detection.blocked) {
		// PR 作成に相当しない操作 (approve / merge / comment / 一覧取得 等) は対象外
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
	// #4027: 「`gh pr create` を実行しようとしました」固定をやめ、捕捉した実コマンドを出す。
	// 誤検知時に「実行していない操作名」を報告して原因追跡を阻害しないため。
	process.stderr.write(
		`[claude-hook-prevent-qa-account-pr] BLOCK: active gh account = ${active} で PR 作成に相当する操作 (${detection.kind}) を実行しようとしました。\n`,
	);
	process.stderr.write(`  捕捉したコマンド: ${truncate(detection.matched ?? '')}\n`);
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
const isDirectInvocation = isMainModule(import.meta.url);
if (isDirectInvocation) {
	main();
}
