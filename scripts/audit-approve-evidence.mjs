#!/usr/bin/env node

/**
 * scripts/audit-approve-evidence.mjs (#4082 AC3 / AC5)
 *
 * PR に付いた **APPROVE を、それが行われた経路に依存せず**事後監査する。
 *
 * ## なぜ hook では足りないのか
 *
 * `.claude/hooks/gate-approve.mjs` (ADR-0056) は PreToolUse hook であり、**hook が起動する
 * 経路でしか効かない**。以下 2 つは matcher をどれだけ広げても原理的に塞げない (ADR-0056
 * §残存 bypass):
 *
 *   - **R1 残余**: まだ棚卸ししていない code-execution 系ツールが増えれば、そこから起こした
 *     副作用に gate は掛からない。列挙型の防御は「次に増えるもの」を先回りできない
 *   - **R3**: `Agent` tool の `isolation: "remote"` 実行環境が project hook を継承するかは、
 *     このリポジトリからは制御も検証もできない (実行基盤側の仕様)
 *
 * そこで防御層とは別に、**効果が着地した場所 (GitHub の review 一覧)** を入力にした検知層を置く。
 * どの経路で approve されたかに関わらず、「evidence 無しの APPROVE」は必ずここに現れる。
 * 予防ではなく検知であることを明示したうえで、silent gap にはしない。
 *
 * ## 使い方
 *
 *   node scripts/audit-approve-evidence.mjs --pr 4082
 *   node scripts/audit-approve-evidence.mjs --pr 4082 --json
 *
 * exit 0 = 全 APPROVE に適合 evidence あり / exit 1 = 未検証 approve あり / exit 2 = 実行エラー。
 *
 * ## 限界 (過大評価しないため明記する)
 *
 * evidence は `tmp/adversarial-evidence/` (git 管理外) にあるため、本監査は **evidence を
 * 持つマシン上で実行したときにだけ**意味を持つ。別マシン / 別セッションで approve された分は
 * 「evidence 不在」として報告される (偽陽性ではなく「このマシンでは検証できない」の意)。
 * TTL (30 分) を過ぎた evidence は hook と同じ基準で不適合になるため、監査は approve 直後に
 * 走らせる (QM の merge 前チェックに組み込む) ことを前提とする。
 *
 * ## 関連
 *   - ADR-0056 (approve gate の設計 SSOT / 残存 bypass 表)
 *   - .claude/hooks/gate-approve.mjs (verifyEvidence の SSOT。本 script は再実装しない)
 */

import { execFileSync } from 'node:child_process';

import { verifyEvidence } from '../.claude/hooks/gate-approve.mjs';

const HELP = `audit-approve-evidence — approve を経路非依存で事後監査する (#4082)

  --pr <n>   監査対象の PR 番号 (必須)
  --json     JSON で出力する
  --help     このヘルプ

exit 0 = 全 APPROVE に適合 evidence あり / 1 = 未検証 approve あり / 2 = 実行エラー
`;

/**
 * @typedef {{ state: string; user: string; submittedAt?: string }} ReviewRecord
 * @typedef {{ prNumber: number; reviews: ReviewRecord[] }} AuditInput
 */

/**
 * review 一覧と evidence を突き合わせる (純関数、test 対象)。
 *
 * @param {AuditInput} input
 * @param {string} cwd  evidence を探す作業 dir (test では temp tree を渡す)
 * @returns {{ ok: boolean; approvals: ReviewRecord[]; unverified: { review: ReviewRecord; reason: string }[] }}
 */
export function auditApprovals(input, cwd = process.cwd()) {
	const approvals = (input.reviews ?? []).filter((r) => r?.state === 'APPROVED');
	/** @type {{ review: ReviewRecord; reason: string }[]} */
	const unverified = [];
	for (const review of approvals) {
		const result = verifyEvidence(input.prNumber, cwd);
		if (!result.ok) unverified.push({ review, reason: result.reason });
	}
	return { ok: unverified.length === 0, approvals, unverified };
}

/**
 * GitHub から review 一覧を取る。
 *
 * @param {number} prNumber
 * @returns {ReviewRecord[]}
 */
function fetchReviews(prNumber) {
	const raw = execFileSync(
		'gh',
		['pr', 'view', String(prNumber), '--json', 'reviews', '--jq', '.reviews'],
		{ encoding: 'utf8' },
	);
	const parsed = JSON.parse(raw || '[]');
	return parsed.map(
		/** @param {{ state?: string; author?: { login?: string }; submittedAt?: string }} r */ (
			r,
		) => ({
			state: String(r?.state ?? ''),
			user: String(r?.author?.login ?? 'unknown'),
			submittedAt: r?.submittedAt,
		}),
	);
}

function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(HELP);
		return 0;
	}
	const prIndex = argv.indexOf('--pr');
	const prNumber = prIndex >= 0 ? Number(argv[prIndex + 1]) : Number.NaN;
	if (!Number.isInteger(prNumber) || prNumber <= 0) {
		process.stderr.write('[audit-approve-evidence] --pr <n> は必須です。\n');
		return 2;
	}

	/** @type {ReviewRecord[]} */
	let reviews;
	try {
		reviews = fetchReviews(prNumber);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[audit-approve-evidence] review 一覧を取得できません: ${msg}\n`);
		return 2;
	}

	const result = auditApprovals({ prNumber, reviews });
	if (argv.includes('--json')) {
		process.stdout.write(`${JSON.stringify({ prNumber, ...result }, null, 2)}\n`);
	} else if (result.ok) {
		process.stdout.write(
			`[audit-approve-evidence] PR #${prNumber}: APPROVE ${result.approvals.length} 件、全て適合 evidence あり。\n`,
		);
	} else {
		process.stderr.write(
			`[audit-approve-evidence] PR #${prNumber}: **evidence で裏付けられない APPROVE** が ${result.unverified.length} 件あります。\n`,
		);
		for (const item of result.unverified) {
			process.stderr.write(`  - ${item.review.user} (${item.review.submittedAt ?? '時刻不明'})\n`);
			process.stderr.write(`    reason: ${item.reason}\n`);
		}
		process.stderr.write(
			'  対処: Adversarial Reviewer subagent を dispatch して evidence を作り直し、approve をやり直すか、\n',
		);
		process.stderr.write(
			'        別マシン / 別経路で approve された場合はその経路を ADR-0056 の残存 bypass 表に記録してください。\n',
		);
	}
	return result.ok ? 0 : 1;
}

// CLI 実行時のみ main() を呼ぶ (test は auditApprovals を import して使う)。
const { isMain } = await import('./lib/is-main.mjs');
if (isMain(import.meta.url)) process.exit(main());
