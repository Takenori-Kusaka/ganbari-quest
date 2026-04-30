#!/usr/bin/env node
/**
 * scripts/check-gh-account-before-pr.mjs (#1728 / ADR-0022 amendment 1)
 *
 * `gh pr create` を実行する直前に、active な gh アカウントが
 * Takenori-Kusaka であることを検証するガードスクリプト。
 *
 * ADR-0022 (#1481) で定めた役割分担:
 *   - Takenori-Kusaka  → Dev (PR 作成・push)
 *   - ganbariquestsupport-lab → QA (approve・merge・PR コメントのみ)
 *
 * 誤って QA アカウントで `gh pr create` してしまう事故を防ぐため、
 * AUTO_MODE / Agent / 手動運用すべてで `gh pr create` の直前に必ず実行する。
 *
 * 使用法:
 *   node scripts/check-gh-account-before-pr.mjs
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
 *   - #1728
 */

import { spawnSync } from 'node:child_process';

const ALLOWED_PR_AUTHOR = process.env.ALLOWED_PR_AUTHOR ?? 'Takenori-Kusaka';
const QA_ACCOUNT = 'ganbariquestsupport-lab';

/**
 * `gh auth status` を実行して標準出力を返す。
 * gh CLI 未インストール / 未ログインなら null を返す。
 *
 * 注: `gh auth status` は active アカウントが存在する場合 stdout に出力するが、
 * バージョンによっては stderr に出すこともあるため、両方を結合して扱う。
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
 */
function extractActiveAccount(output) {
	const lines = output.split(/\r?\n/);
	let lastLogin = null;
	for (const line of lines) {
		const loginMatch = line.match(/Logged in to github\.com account ([\w-]+)/);
		if (loginMatch) {
			lastLogin = loginMatch[1];
			continue;
		}
		const activeMatch = line.match(/Active account:\s*(true|false)/i);
		if (activeMatch && activeMatch[1].toLowerCase() === 'true' && lastLogin) {
			return lastLogin;
		}
	}
	return null;
}

function main() {
	const status = runGhAuthStatus();
	if (!status.ok) {
		process.stderr.write(`[check-gh-account-before-pr] FAIL: ${status.reason}\n`);
		process.stderr.write(
			'  対処: `gh auth login --hostname github.com` でログインしてください。\n',
		);
		process.exit(1);
	}

	const activeAccount = extractActiveAccount(status.output);
	if (!activeAccount) {
		process.stderr.write(
			'[check-gh-account-before-pr] FAIL: gh auth status の出力から active アカウントを判定できませんでした。\n',
		);
		process.stderr.write(`  raw output:\n${status.output}\n`);
		process.exit(1);
	}

	if (activeAccount === ALLOWED_PR_AUTHOR) {
		process.stdout.write(`[check-gh-account-before-pr] OK: active=${activeAccount} (PR 作成可)\n`);
		process.exit(0);
	}

	const isQa = activeAccount === QA_ACCOUNT;
	process.stderr.write(
		`[check-gh-account-before-pr] FAIL: active=${activeAccount} は PR 作成許可リスト (${ALLOWED_PR_AUTHOR}) に含まれていません。\n`,
	);
	if (isQa) {
		process.stderr.write(
			`  ${QA_ACCOUNT} は QA レビュー (approve / merge) 専用アカウントです。PR 作成は禁止 (ADR-0022 amendment 1, #1728)。\n`,
		);
	}
	process.stderr.write(
		`  対処: \`gh auth switch --user ${ALLOWED_PR_AUTHOR}\` で Dev アカウントに切替えてから再実行してください。\n`,
	);
	process.exit(1);
}

main();
