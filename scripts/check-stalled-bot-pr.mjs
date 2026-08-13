#!/usr/bin/env node
/**
 * scripts/check-stalled-bot-pr.mjs
 *
 * #4557 (発端: #4532): `main-pr-base-guard` (ci.yml、#3922/#4273) は dependabot/renovate の
 * main 直行 PR を正しく fail-close する。しかし GitHub 仕様上 security update PR は
 * default branch (main) にしか作られず、`target-branch: develop` を無視する。
 * bot は失敗した PR を自動で retarget しないため、**人が `gh pr edit --base develop` を
 * 打つまで PR は赤いまま滞留する**。fail メッセージに対処コマンドは出るが、誰かが
 * その PR を見に行かない限り気づけない。「guard が正しく止める」と「security 更新が
 * 永久放置される」が両立してしまう構造的な穴を埋める。
 *
 * 本スクリプトは以下を満たす PR を「滞留した bot PR」として検出する:
 *   - base = main
 *   - author が bot (dependabot / renovate / その他 `is_bot: true`)
 *   - open のまま STALL_DAYS 日以上経過
 *   - `main-pr-base-guard` チェックが failure のまま
 *
 * 検出したら PR コメント (既存経路、新規 secret 不要) を投稿する。加えて
 * DISCORD_WEBHOOK_INCIDENT (既存 secret、deploy-nuc.yml / deploy-aws-staging.yml と共用)
 * が設定されていれば要約を通知する。**新規 secret は追加しない** (ADR-0024)。
 *
 * 自動 retarget (`gh pr edit --base develop`) は本スクリプトでは行わない。
 * base 付け替えは PR の意味を変える不可逆に近い操作であり、dependabot 自身の
 * PR 追跡状態 (rebase / auto-merge 判定) と衝突するリスクを排除しきれないため、
 * 「検知して人に気づかせる」に留める判断とした (#4557 PR body に判断理由を記載)。
 *
 * 想定実行環境: GitHub Actions の schedule トリガ (admin-bypass-evidence.yml に相乗り、日次)
 *   env:
 *     REPO:                     owner/repo
 *     GH_TOKEN:                 GITHUB_TOKEN (read PR + write PR comment 権限)
 *     STALL_DAYS:               何日経過で「滞留」とみなすか (default: 2)
 *     DRY_RUN:                  'true' でコメント投稿 / Discord 通知をスキップ
 *     DISCORD_WEBHOOK_INCIDENT: 設定時のみ Discord 要約通知 (optional、新規 secret ではない)
 *     OUTPUT_MODE:              'json' | 'text' (default: text)
 *
 * exit:
 *   0 = OK (滞留 0 件、または検知 + 通知完了)
 *   2 = API 失敗等の internal error
 */

import { execFileSync } from 'node:child_process';

import { isMain } from './lib/is-main.mjs';

/**
 * @typedef {Object} PrAuthor
 * @property {string} login
 * @property {boolean} [is_bot]
 */

/**
 * @typedef {Object} GhPr
 * @property {number} number
 * @property {string} title
 * @property {PrAuthor | null} author
 * @property {string} createdAt
 * @property {string} url
 * @property {string} [baseRefName]
 */

/**
 * @typedef {Object} GhCheck
 * @property {string} name
 * @property {string} [bucket]
 * @property {string} [state]
 */

const REPO = process.env.REPO;
const STALL_DAYS = Number(process.env.STALL_DAYS || '2');
const DRY_RUN = process.env.DRY_RUN === 'true';
const OUTPUT_MODE = process.env.OUTPUT_MODE || 'text';
const DISCORD_WEBHOOK_INCIDENT = process.env.DISCORD_WEBHOOK_INCIDENT || '';

const GUARD_CHECK_NAME = 'main-pr-base-guard';
const BOT_COMMENT_MARKER = '<!-- stalled-bot-pr-check -->';

/**
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
	try {
		return execFileSync('gh', args, {
			stdio: ['ignore', 'pipe', 'inherit'],
			encoding: 'utf-8',
			maxBuffer: 20 * 1024 * 1024,
		});
	} catch (/** @type {unknown} */ err) {
		console.error(`[stalled-bot-pr] gh command failed: ${args.join(' ')}`);
		const msg = err instanceof Error ? err.message : String(err);
		console.error(msg);
		process.exit(2);
	}
}

/**
 * bot 判定。gh の JSON は `author.is_bot` を持つ (dependabot / integrator 等)。
 * 念のため login 側の慣習 (`[bot]` サフィックス / `app/` prefix) もフォールバックで見る。
 *
 * @param {GhPr} pr
 * @returns {boolean}
 */
export function isBotAuthor(pr) {
	const author = pr.author;
	if (!author) return false;
	if (author.is_bot === true) return true;
	const login = author.login || '';
	return login.endsWith('[bot]') || login.startsWith('app/');
}

/**
 * @param {string} createdAtIso
 * @param {string} nowIso
 * @returns {number}
 */
export function ageDays(createdAtIso, nowIso) {
	const created = new Date(createdAtIso).getTime();
	const now = new Date(nowIso).getTime();
	return (now - created) / (24 * 60 * 60 * 1000);
}

/**
 * base=main かつ bot 作成かつ STALL_DAYS 日以上経過した候補を抽出する (guard 状態は未考慮、
 * ここまでは `gh pr checks` を呼ばずに絞り込める安価な条件)。
 *
 * @param {GhPr[]} prs
 * @param {{ stallDays: number, nowIso: string }} opts
 * @returns {GhPr[]}
 */
export function filterStaleBotMainPrs(prs, { stallDays, nowIso }) {
	return prs.filter((pr) => {
		if (pr.baseRefName !== 'main') return false;
		if (!isBotAuthor(pr)) return false;
		return ageDays(pr.createdAt, nowIso) >= stallDays;
	});
}

/**
 * `gh pr checks --json name,bucket,state` の結果から main-pr-base-guard が
 * failure のままかを判定する。pending / pass / skipping は対象外。
 *
 * @param {GhCheck[]} checks
 * @returns {boolean}
 */
export function isGuardFailing(checks) {
	const guard = checks.find((c) => c.name === GUARD_CHECK_NAME);
	if (!guard) return false;
	return guard.bucket === 'fail' || guard.state === 'FAILURE' || guard.state === 'ERROR';
}

/**
 * @param {{ comments?: string[] } | string[]} commentsInput
 * @param {string} marker
 * @returns {boolean}
 */
export function hasExistingMarkerComment(commentsInput, marker) {
	const bodies = Array.isArray(commentsInput) ? commentsInput : commentsInput.comments || [];
	return bodies.some((body) => typeof body === 'string' && body.includes(marker));
}

/**
 * @param {GhPr} pr
 * @param {number} days
 * @returns {string}
 */
export function buildCommentBody(pr, days) {
	return [
		BOT_COMMENT_MARKER,
		'## 🚧 main 直行のまま滞留している bot PR を検知しました',
		'',
		`本 PR は base=main のまま \`${GUARD_CHECK_NAME}\` に fail し続け、` +
			`${Math.floor(days)} 日以上 open です。`,
		'',
		'security update の可能性があるため、内容を確認のうえ以下のいずれかで解消してください:',
		'',
		'```bash',
		`gh pr edit ${pr.number} --base develop`,
		'```',
		'',
		'（通常レーンに載せたくない理由がある場合は close して手動で対処してください）',
		'',
		'背景: #4557 / #3922 / #4273 / #4532',
	].join('\n');
}

/**
 * @param {GhPr[]} prs
 * @returns {string}
 */
export function buildDiscordPayload(prs) {
	const lines = prs.map(
		(pr) =>
			`- [#${pr.number}] ${pr.title} (${Math.floor(ageDays(pr.createdAt, new Date().toISOString()))}日 停滞) ${pr.url}`,
	);
	return JSON.stringify({
		embeds: [
			{
				title: `⚠️ main 直行のまま滞留した bot PR: ${prs.length} 件`,
				description: lines.join('\n'),
				color: 15158332,
				footer: { text: 'がんばりクエスト stalled-bot-pr-check (#4557)' },
			},
		],
	});
}

/**
 * @param {number} prNumber
 * @returns {string[]}
 */
function listCommentBodies(prNumber) {
	const out = gh(['api', `repos/${REPO}/issues/${prNumber}/comments`, '--jq', '.[].body']);
	return out.split('\n').filter((l) => l.length > 0);
}

/**
 * @param {GhPr} pr
 */
function fetchChecks(pr) {
	const out = gh([
		'pr',
		'checks',
		String(pr.number),
		'--repo',
		REPO,
		'--json',
		'name,bucket,state',
	]);
	try {
		return /** @type {GhCheck[]} */ (JSON.parse(out));
	} catch {
		// checks がまだ 1 件も無い (「no checks reported」等) は空配列扱い
		return [];
	}
}

/**
 * @param {string} nowIso
 */
async function main(nowIso = new Date().toISOString()) {
	if (!REPO) {
		console.error('[stalled-bot-pr] REPO env var is required (owner/repo)');
		process.exit(2);
	}
	const prsOut = gh([
		'pr',
		'list',
		'--repo',
		REPO,
		'--state',
		'open',
		'--base',
		'main',
		'--json',
		'number,title,author,createdAt,url,baseRefName',
	]);
	const prs = /** @type {GhPr[]} */ (JSON.parse(prsOut));

	const candidates = filterStaleBotMainPrs(prs, { stallDays: STALL_DAYS, nowIso });

	const newlyFlagged = [];
	const alreadyFlagged = [];
	const notStalled = [];

	for (const pr of candidates) {
		const checks = fetchChecks(pr);
		if (!isGuardFailing(checks)) {
			notStalled.push(pr);
			continue;
		}
		const existingComments = listCommentBodies(pr.number);
		if (hasExistingMarkerComment(existingComments, BOT_COMMENT_MARKER)) {
			alreadyFlagged.push(pr);
			continue;
		}
		newlyFlagged.push(pr);
		const days = ageDays(pr.createdAt, nowIso);
		const body = buildCommentBody(pr, days);
		if (DRY_RUN) {
			console.log(`[stalled-bot-pr] [DRY_RUN] would post comment on PR #${pr.number}:`);
			console.log(body);
		} else {
			gh(['pr', 'comment', String(pr.number), '--repo', REPO, '--body', body]);
		}
	}

	if (newlyFlagged.length > 0 && DISCORD_WEBHOOK_INCIDENT) {
		const payload = buildDiscordPayload(newlyFlagged);
		if (DRY_RUN) {
			console.log('[stalled-bot-pr] [DRY_RUN] would POST to DISCORD_WEBHOOK_INCIDENT:');
			console.log(payload);
		} else {
			try {
				execFileSync('curl', [
					'-s',
					'-X',
					'POST',
					'-H',
					'Content-Type: application/json',
					'-d',
					payload,
					DISCORD_WEBHOOK_INCIDENT,
				]);
			} catch (/** @type {unknown} */ err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[stalled-bot-pr] Discord webhook post failed (non-fatal): ${msg}`);
			}
		}
	}

	const summary = {
		nowIso,
		stallDays: STALL_DAYS,
		openMainPrCount: prs.length,
		candidateCount: candidates.length,
		newlyFlaggedCount: newlyFlagged.length,
		alreadyFlaggedCount: alreadyFlagged.length,
		notStalledCount: notStalled.length,
	};

	if (OUTPUT_MODE === 'json') {
		console.log(
			JSON.stringify(
				{
					summary,
					newlyFlagged: newlyFlagged.map((pr) => ({
						number: pr.number,
						title: pr.title,
						url: pr.url,
					})),
					alreadyFlagged: alreadyFlagged.map((pr) => pr.number),
				},
				null,
				2,
			),
		);
	} else {
		console.log(
			`[stalled-bot-pr] since ${nowIso} (stallDays=${STALL_DAYS}): candidates=${candidates.length} ` +
				`newly_flagged=${newlyFlagged.length} already_flagged=${alreadyFlagged.length}`,
		);
		for (const pr of newlyFlagged) {
			console.log(`  🚨 #${pr.number}: ${pr.title} (${pr.url})`);
		}
	}

	process.exit(0);
}

if (isMain(import.meta.url)) {
	main().catch((/** @type {unknown} */ err) => {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[stalled-bot-pr] unexpected error', msg);
		process.exit(2);
	});
}
