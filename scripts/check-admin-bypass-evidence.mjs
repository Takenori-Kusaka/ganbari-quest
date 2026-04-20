#!/usr/bin/env node
/**
 * scripts/check-admin-bypass-evidence.mjs
 *
 * #1201 / ADR-0044: admin bypass merge 証跡記録運用の検証スクリプト。
 *
 * 直近 merge された PR のうち reviewDecision が空 (admin bypass merge の典型) のものを抽出し、
 * PR 本文に「Self-Review 証跡」セクションが含まれているかを検証する。
 * 欠落 PR には github-actions[bot] が追記要求コメントを投稿する（block はしない）。
 *
 * 想定実行環境: GitHub Actions の schedule トリガ（1 時間に 1 回）
 *   env:
 *     REPO:          owner/repo
 *     GH_TOKEN:      GITHUB_TOKEN (read PR + write PR comment 権限)
 *     LOOKBACK_HOURS: 何時間前までを対象にするか (default: 2)
 *     DRY_RUN:       'true' でコメント投稿をスキップ（ローカル検証用）
 *     OUTPUT_MODE:   'json' | 'text' (default: text)
 *
 * 月次レポート（AC3 連携）:
 *   SUMMARY_ONLY=true で指定期間の admin bypass merge 件数 / 証跡欠落数のみ集計して JSON 出力する。
 *   `/ops` ダッシュボードはこの出力を取り込む (`src/lib/server/ops/admin-bypass-metrics.ts` 経由)。
 *
 * exit:
 *   0 = OK（欠落 0 または bot コメント投稿完了）
 *   2 = API 失敗等の internal error
 */

import { execFileSync } from 'node:child_process';

/**
 * @typedef {Object} PrFile
 * @property {string} path
 * @property {number} [additions]
 * @property {number} [deletions]
 */

/**
 * @typedef {Object} PrAuthor
 * @property {string} login
 */

/**
 * @typedef {Object} PrLabel
 * @property {string} name
 */

/**
 * @typedef {Object} GhPr
 * @property {number} number
 * @property {string} title
 * @property {PrAuthor | null} author
 * @property {string | null} body
 * @property {string | null} mergedAt
 * @property {string | null} reviewDecision
 * @property {boolean} [isCrossRepository]
 * @property {PrLabel[]} labels
 * @property {PrFile[]} files
 * @property {string} [baseRefName]
 */

/**
 * @typedef {Object} ClassifiedResult
 * @property {number} number
 * @property {string} title
 * @property {string | undefined} author
 * @property {'ok' | 'missing' | 'exempted'} status
 * @property {string} [reason]
 * @property {string | null} [mergedAt]
 * @property {boolean} [hasEvidence]
 */

const REPO = process.env.REPO;
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || '2');
const DRY_RUN = process.env.DRY_RUN === 'true';
const OUTPUT_MODE = process.env.OUTPUT_MODE || 'text';
const SUMMARY_ONLY = process.env.SUMMARY_ONLY === 'true';

const EVIDENCE_MARKER_PATTERNS = [
	/^##\s*Self-Review 証跡/m,
	/^##\s*Self-Review\s*\(admin bypass\)/m,
];

const BOT_COMMENT_MARKER = '<!-- admin-bypass-evidence-check -->';

if (!REPO) {
	console.error('[admin-bypass-evidence] REPO env var is required (owner/repo)');
	process.exit(2);
}

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
		console.error(`[admin-bypass-evidence] gh command failed: ${args.join(' ')}`);
		const msg = err instanceof Error ? err.message : String(err);
		console.error(msg);
		process.exit(2);
	}
}

/**
 * @param {number} hours
 * @returns {string}
 */
function hoursAgo(hours) {
	const d = new Date(Date.now() - hours * 60 * 60 * 1000);
	return d.toISOString();
}

/**
 * @param {string} sinceIso
 * @returns {GhPr[]}
 */
function listRecentMergedPrs(sinceIso) {
	const out = gh([
		'pr',
		'list',
		'--repo',
		REPO,
		'--state',
		'merged',
		'--limit',
		'50',
		'--json',
		'number,title,author,body,mergedAt,reviewDecision,isCrossRepository,labels,files,baseRefName',
	]);
	const all = /** @type {GhPr[]} */ (JSON.parse(out));
	return all.filter((/** @type {GhPr} */ pr) => pr.mergedAt && pr.mergedAt >= sinceIso);
}

/**
 * @param {GhPr} pr
 * @returns {{ exempted: boolean, reason?: string }}
 */
function isExempted(pr) {
	const author = pr.author?.login || '';
	if (author.endsWith('[bot]')) return { exempted: true, reason: 'bot-authored PR' };
	if (author === 'dependabot' || author === 'renovate') {
		return { exempted: true, reason: 'dependabot/renovate' };
	}
	const files = pr.files || [];
	const nonDocs = files.filter((/** @type {PrFile} */ f) => !f.path.startsWith('docs/'));
	const totalChanges = files.reduce(
		(/** @type {number} */ sum, /** @type {PrFile} */ f) =>
			sum + (f.additions || 0) + (f.deletions || 0),
		0,
	);
	if (nonDocs.length === 0 && totalChanges < 50) {
		return { exempted: true, reason: 'docs-only <50 lines' };
	}
	return { exempted: false };
}

/**
 * @param {string | null} body
 * @returns {boolean}
 */
function hasEvidenceSection(body) {
	if (!body) return false;
	return EVIDENCE_MARKER_PATTERNS.some((re) => re.test(body));
}

/**
 * @param {GhPr} pr
 * @returns {boolean}
 */
function isAdminBypass(pr) {
	return !pr.reviewDecision || pr.reviewDecision === '' || pr.reviewDecision === 'REVIEW_REQUIRED';
}

/**
 * @param {number} prNumber
 */
async function postMissingEvidenceComment(prNumber) {
	const body = [
		BOT_COMMENT_MARKER,
		'## 🔍 admin bypass merge — Self-Review 証跡の追記依頼 (ADR-0044)',
		'',
		'本 PR は APPROVED レビューなしで merge されています（admin bypass）。',
		'PR 本文に **Self-Review 証跡** セクションが検出できませんでした。',
		'',
		'以下のテンプレートを PR 本文末尾に追記してください（事後追記で構いません）:',
		'',
		'```markdown',
		'## Self-Review 証跡 (admin bypass)',
		'',
		'### 確認した観点',
		'- [ ] Issue AC 全項目突合',
		'- [ ] UI/UX 禁忌事項（DESIGN.md §9）セルフチェック',
		'- [ ] 並行実装ペア同期確認',
		'- [ ] テスト同梱',
		'- [ ] 設計書同期',
		'- [ ] セキュリティ・プライバシー影響無し',
		'',
		'### 添付スクリーンショット',
		'（主要変更画面の before/after or 該当なしの理由）',
		'',
		'### 実機確認ログ',
		'（`npm run dev:cognito` での手動確認ログ 等）',
		'```',
		'',
		'参考: [ADR-0044 (archive)](https://github.com/Takenori-Kusaka/ganbari-quest/blob/main/docs/decisions/archive/0044-admin-bypass-evidence.md) / [Issue #1201](https://github.com/Takenori-Kusaka/ganbari-quest/issues/1201)',
	].join('\n');

	if (DRY_RUN) {
		console.log(`[admin-bypass-evidence] [DRY_RUN] would post comment on PR #${prNumber}:`);
		console.log(body);
		return;
	}

	gh(['pr', 'comment', String(prNumber), '--repo', REPO, '--body', body]);
}

/**
 * @param {GhPr} pr
 * @returns {Promise<ClassifiedResult>}
 */
async function classifyPr(pr) {
	const exemption = isExempted(pr);
	if (exemption.exempted) {
		return {
			number: pr.number,
			title: pr.title,
			author: pr.author?.login,
			status: 'exempted',
			reason: exemption.reason,
		};
	}
	const hasEvidence = hasEvidenceSection(pr.body);
	if (!hasEvidence) {
		await postMissingEvidenceComment(pr.number);
	}
	return {
		number: pr.number,
		title: pr.title,
		author: pr.author?.login,
		mergedAt: pr.mergedAt,
		hasEvidence,
		status: hasEvidence ? 'ok' : 'missing',
	};
}

/**
 * @typedef {Object} SummaryStats
 * @property {string} sinceIso
 * @property {number} lookbackHours
 * @property {number} mergedCount
 * @property {number} adminBypassCount
 * @property {number} evidenceMissingCount
 * @property {number} exemptedCount
 */

/**
 * @param {string} sinceIso
 * @param {SummaryStats} summary
 * @param {ClassifiedResult[]} results
 */
function printTextSummary(sinceIso, summary, results) {
	console.log(`[admin-bypass-evidence] since ${sinceIso}`);
	console.log(
		`  merged=${summary.mergedCount} admin_bypass=${summary.adminBypassCount} missing_evidence=${summary.evidenceMissingCount} exempted=${summary.exemptedCount}`,
	);
	for (const r of results) {
		const prefix = r.status === 'missing' ? '⚠' : r.status === 'exempted' ? '・' : '✓';
		console.log(
			`  ${prefix} #${r.number} [${r.status}] by @${r.author}: ${r.title}${r.reason ? ` (${r.reason})` : ''}`,
		);
	}
}

async function main() {
	const sinceIso = hoursAgo(LOOKBACK_HOURS);
	const mergedPrs = listRecentMergedPrs(sinceIso);
	const adminBypassPrs = mergedPrs.filter(isAdminBypass);

	/** @type {ClassifiedResult[]} */
	const results = [];
	for (const pr of adminBypassPrs) {
		results.push(await classifyPr(pr));
	}

	/** @type {SummaryStats} */
	const summary = {
		sinceIso,
		lookbackHours: LOOKBACK_HOURS,
		mergedCount: mergedPrs.length,
		adminBypassCount: adminBypassPrs.length,
		evidenceMissingCount: results.filter((r) => r.status === 'missing').length,
		exemptedCount: results.filter((r) => r.status === 'exempted').length,
	};

	if (SUMMARY_ONLY || OUTPUT_MODE === 'json') {
		console.log(JSON.stringify({ summary, results }, null, 2));
	} else {
		printTextSummary(sinceIso, summary, results);
	}

	process.exit(0);
}

main().catch((/** @type {unknown} */ err) => {
	const msg = err instanceof Error ? err.message : String(err);
	console.error('[admin-bypass-evidence] unexpected error', msg);
	process.exit(2);
});
