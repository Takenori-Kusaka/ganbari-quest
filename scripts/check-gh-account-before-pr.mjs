#!/usr/bin/env node

/**
 * scripts/check-gh-account-before-pr.mjs (#1728 / ADR-0022 amendment 1)
 *
 * `gh pr create` を実行する直前に、active な gh アカウントが
 * Takenori-Kusaka であることを検証するガードスクリプト。
 *
 * #3806: active アカウント判定を `gh api graphql {viewer{login}}` (一次) +
 *   `gh auth status` (fallback) の 2 段構成にした。GitHub 側で認証付き REST
 *   `/user` だけが 503 を返す部分障害時、`gh auth status` は「keyring invalid」を
 *   誤報し hook が全 push を誤ブロックする。GraphQL は REST 503 の影響を受けない
 *   ため、これを一次検証ソースにして誤ブロックを根治する。
 *
 * ADR-0022 (#1481) で定めた役割分担:
 *   - Takenori-Kusaka  → Dev (PR 作成・push)
 *   - ganbariquestsupport-lab → QA (approve・merge・PR コメントのみ)
 *
 * 誤って QM アカウントで `gh pr create` してしまう事故を防ぐため、
 * AUTO_MODE / Agent / 手動運用すべてで `gh pr create` の直前に必ず実行する。
 *
 * 使用法:
 *   node scripts/check-gh-account-before-pr.mjs
 *
 * 呼出経路 (#1879 で機械的強制機構を 2 経路に拡張):
 *   1. 手動: PR 作成 Agent / Dev が `gh pr create` 直前に明示実行
 *   2. `.husky/pre-push`: `git push` 直前に husky hook 経由で自動実行 (#1879)
 *
 * Claude Code セッション経由の `gh pr create` には別経路の hook が併設されている:
 *   - `.claude/settings.json` PreToolUse → `scripts/claude-hook-prevent-qa-account-pr.mjs`
 *
 * 終了コード:
 *   0 = active アカウントが ALLOWED_PR_AUTHOR と一致 (PR 作成可)
 *   1 = active アカウントが不一致 / 未ログイン / gh コマンド失敗 (PR 作成不可)
 *
 * 環境変数:
 *   ALLOWED_PR_AUTHOR  PR 作成を許可するアカウント名 (default: 'Takenori-Kusaka')
 *                      テスト等で別アカウントを許可したい場合に上書きする。
 *
 * 関連:
 *   - ADR-0022 amendment 1 (docs/decisions/0022-admin-bypass-disable-qm-approve.md)
 *   - docs/sessions/dev-session.md §PR 作業時 §5.5
 *   - #1728 / #1994 (server side gate との 3 層防御)
 */

import { spawnSync } from 'node:child_process';
import { isMain as isMainModule } from './lib/is-main.mjs';

export const ALLOWED_PR_AUTHOR_DEFAULT = 'Takenori-Kusaka';
export const QA_ACCOUNT = 'ganbariquestsupport-lab';

const ALLOWED_PR_AUTHOR = process.env.ALLOWED_PR_AUTHOR ?? ALLOWED_PR_AUTHOR_DEFAULT;

/**
 * `gh api graphql -f query='{viewer{login}}'` の JSON 応答文字列から
 * viewer.login を抽出する純粋関数。
 *
 * 一次検証を GraphQL にする理由 (#3806):
 *   GitHub 側で認証付き REST データエンドポイント (`/user`) だけが 503 を返す
 *   部分障害が起きると、`gh auth status` はトークン検証 (REST `/user`) に失敗し
 *   「The token in keyring is invalid」と誤報する。これは keyring 障害ではなく、
 *   再認証でも直らない。GraphQL `{viewer{login}}` は REST 503 の影響を受けず
 *   active アカウントを返せるため、hook の誤ブロックを根治できる。
 *
 * @param {string} jsonStr  gh api graphql の標準出力 (JSON 文字列)
 * @returns {string|null}   viewer.login / パース不能・欠落なら null
 */
export function extractViewerLoginFromGraphql(jsonStr) {
	const trimmed = String(jsonStr ?? '').trim();
	if (trimmed === '') return null;
	try {
		const parsed = JSON.parse(trimmed);
		const login = parsed?.data?.viewer?.login;
		return typeof login === 'string' && login.length > 0 ? login : null;
	} catch {
		// REST 503 の HTML エラーページ等、JSON 非準拠の応答は null 扱い。
		return null;
	}
}

/**
 * `gh api graphql -f query='{viewer{login}}'` を実行し active アカウント login を返す。
 * REST `/user` 503 (#3806) の影響を受けない一次検証経路。
 *
 * @returns {{ok: boolean, login: string|null, reason: string|null}}
 */
function runGhGraphqlViewer() {
	const result = spawnSync('gh', ['api', 'graphql', '-f', 'query={viewer{login}}'], {
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});

	if (result.error) {
		return { ok: false, login: null, reason: `gh コマンドの起動に失敗: ${result.error.message}` };
	}
	if (result.status !== 0) {
		return {
			ok: false,
			login: null,
			reason: `gh api graphql が exit ${result.status} で終了しました。`,
		};
	}

	const login = extractViewerLoginFromGraphql(result.stdout ?? '');
	if (login === null) {
		return {
			ok: false,
			login: null,
			reason: 'GraphQL 応答から viewer.login を抽出できませんでした。',
		};
	}
	return { ok: true, login, reason: null };
}

/**
 * `gh auth status` を実行して標準出力を返す。
 * gh CLI 未インストール / 未ログインなら null を返す。
 *
 * 注: `gh auth status` は active アカウントが存在する場合 stdout に出力するが、
 * バージョンによっては stderr に出すこともあるため、両方を結合して扱う。
 *
 * #3806 以降、本関数は GraphQL 一次検証が不達だった場合の fallback に降格した。
 * `gh auth status` はトークン検証で REST `/user` を叩くため、GitHub 側の
 * 認証付き REST 部分障害 (503) 時に false-negative を出しうる。
 */
function runGhAuthStatus() {
	const result = spawnSync('gh', ['auth', 'status'], {
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});

	if (result.error) {
		return { ok: false, output: '', reason: `gh コマンドの起動に失敗: ${result.error.message}` };
	}

	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

	if (result.status !== 0) {
		return {
			ok: false,
			output,
			reason: `gh auth status が exit ${result.status} で終了しました。gh CLI にログインしていない可能性があります。`,
		};
	}

	return { ok: true, output, reason: null };
}

/**
 * `gh auth status` の出力から `Active account: true` 直前の
 * "Logged in to github.com account <login>" を抽出する。
 *
 * 想定する出力例:
 *   github.com
 *     ✓ Logged in to github.com account Takenori-Kusaka (keyring)
 *     - Active account: true
 *     ...
 *     ✓ Logged in to github.com account ganbariquestsupport-lab (keyring)
 *     - Active account: false
 *
 * 戻り値: アクティブな login 名 / 見つからない場合は null
 *
 * @param {string} output  gh auth status の標準出力 + 標準エラー出力を結合したもの
 * @returns {string|null}
 */
export function extractActiveAccount(output) {
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
 * active アカウント名を入力に取り、許可リストへの適合判定を返す純粋関数。
 *
 * @param {string|null} activeAccount  extractActiveAccount() の戻り値
 * @param {object} [opts]
 * @param {string} [opts.allowed]      許可するアカウント名 (default: ALLOWED_PR_AUTHOR_DEFAULT)
 * @returns {{ok: boolean, isQa: boolean, reason: string|null}}
 */
export function evaluateActiveAccount(activeAccount, opts = {}) {
	const allowed = opts.allowed ?? ALLOWED_PR_AUTHOR_DEFAULT;
	if (activeAccount === null || activeAccount === undefined) {
		return {
			ok: false,
			isQa: false,
			reason: 'gh auth status の出力から active アカウントを判定できませんでした。',
		};
	}
	if (activeAccount === allowed) {
		return { ok: true, isQa: false, reason: null };
	}
	const isQa = activeAccount === QA_ACCOUNT;
	return {
		ok: false,
		isQa,
		reason: `active=${activeAccount} は PR 作成許可リスト (${allowed}) に含まれていません。`,
	};
}

/**
 * active アカウント login を解決する。
 *
 * 1) 一次: `gh api graphql {viewer{login}}` (REST `/user` 503 の影響を受けない、#3806)
 * 2) fallback: `gh api graphql` 不達時のみ `gh auth status` を解析
 *
 * @returns {{account: string|null, source: 'graphql'|'auth-status'|null, rawStatusOutput: string|null}}
 */
function resolveActiveAccount() {
	const graphql = runGhGraphqlViewer();
	if (graphql.ok) {
		return { account: graphql.login, source: 'graphql', rawStatusOutput: null };
	}

	// GraphQL 不達 (真の未ログイン / gh 未インストール / GraphQL 側障害) → auth status fallback。
	const status = runGhAuthStatus();
	if (!status.ok) {
		return { account: null, source: null, rawStatusOutput: status.output };
	}
	return {
		account: extractActiveAccount(status.output),
		source: 'auth-status',
		rawStatusOutput: status.output,
	};
}

function main() {
	const { account, source, rawStatusOutput } = resolveActiveAccount();

	if (account === null) {
		process.stderr.write(
			'[check-gh-account-before-pr] FAIL: active アカウントを判定できませんでした。\n',
		);
		if (rawStatusOutput) {
			process.stderr.write(`  gh auth status raw output:\n${rawStatusOutput}\n`);
		}
		process.stderr.write(
			'  対処: `gh auth login --hostname github.com` でログインしてください。\n',
		);
		process.exit(1);
	}

	const verdict = evaluateActiveAccount(account, { allowed: ALLOWED_PR_AUTHOR });

	if (verdict.ok) {
		process.stdout.write(
			`[check-gh-account-before-pr] OK: active=${account} (source=${source}, PR 作成可)\n`,
		);
		process.exit(0);
	}

	process.stderr.write(`[check-gh-account-before-pr] FAIL: ${verdict.reason}\n`);
	if (verdict.isQa) {
		process.stderr.write(
			`  ${QA_ACCOUNT} は QM レビュー (approve / merge) 専用アカウントです。PR 作成は禁止 (ADR-0022 amendment 1, #1728)。\n`,
		);
	}
	process.stderr.write(
		`  対処: \`gh auth switch --user ${ALLOWED_PR_AUTHOR}\` で Dev アカウントに切替えてから再実行してください。\n`,
	);
	process.exit(1);
}

// CLI として直接実行されたときのみ main() を呼ぶ。`import` 経由 (unit test 等) では実行されない。
const isDirectInvocation = isMainModule(import.meta.url);
if (isDirectInvocation) {
	main();
}
