// @ts-check
/**
 * issue-close-gate skip 判定 純粋関数 (#2351)
 *
 * `.github/workflows/issue-close-gate.yml` の AC 検証 gate が
 * **PR/Commit 経由 auto-close でも reopen する**ループを構造的に解消するため、
 * Issue close 形態を判定して skip 可否を返す純粋関数。
 *
 * ## 背景
 *
 * - PR の `closes #N` で merge → GitHub が Issue を `state=closed, stateReason=completed` に遷移
 * - このとき Issue body の generic Done check (`- [ ]`) は GitHub が更新しない
 * - 従来の workflow は `body.match(/^\s*-\s*\[\s\]/gm)` で残存検知 → auto-reopen
 * - PR 側の Ready for Review チェックリストで既に AC 検証済みなのに、Issue 側で gate 再発動 = 二重検証
 *
 * ## 判定ルール
 *
 * - `wontfix` / `duplicate` ラベル付き → skip (従来通り)
 * - 直近 ClosedEvent の `closer.__typename === 'PullRequest'` → PR 経由 close、skip
 * - 直近 ClosedEvent の `closer.__typename === 'Commit'` → squash merge commit message 経由、skip
 * - 直近 ClosedEvent の `closer === null` → 手動 close (`gh issue close` / GitHub UI)、AC gate 通す
 *
 * ## SSOT
 *
 * - 関連 Issue: #2351 / #1165 (ADR-0038 原典) / #1481 (warn-only 終了)
 * - 関連 ADR: docs/decisions/0004-review-and-ac-verification.md (ADR-0038 統合元)
 */

/**
 * @typedef {object} ClosedEventClosing
 * @property {string} __typename - 'PullRequest' | 'Commit' (closer 種別)
 * @property {number} [number] - PR 番号 (PullRequest のとき)
 * @property {string} [oid] - commit oid (Commit のとき)
 */

/**
 * @typedef {object} ClosedEvent
 * @property {string} [createdAt]
 * @property {{ login: string } | null} [actor]
 * @property {ClosedEventClosing | null} closer
 */

/**
 * @typedef {object} IssueCloseContext
 * @property {number} issueNumber
 * @property {string[]} labels - issue label 名一覧
 * @property {ClosedEvent[]} closedEvents - 時系列順 (古い順)。直近を判定対象とする
 */

/**
 * @typedef {object} SkipJudgeResult
 * @property {boolean} skip - true なら AC gate を skip して reopen しない
 * @property {string} reason - skip / gate 適用の理由 (workflow log 出力用)
 */

/**
 * Issue close 時に AC gate を skip すべきかを判定する純粋関数。
 *
 * @param {IssueCloseContext} ctx
 * @returns {SkipJudgeResult}
 */
export function judgeSkipAcGate(ctx) {
	// 1. 除外ラベル (従来通り)
	if (ctx.labels.includes('wontfix') || ctx.labels.includes('duplicate')) {
		return {
			skip: true,
			reason: `Issue #${ctx.issueNumber}: ${ctx.labels.join(', ')} ラベル付きのため skip`,
		};
	}

	// 2. 直近 ClosedEvent の closer を判定 (時系列順なので最後が直近)
	if (!Array.isArray(ctx.closedEvents) || ctx.closedEvents.length === 0) {
		return {
			skip: false,
			reason: `Issue #${ctx.issueNumber}: ClosedEvent 履歴が取得できず、安全側で AC gate 通す`,
		};
	}

	const latest = ctx.closedEvents[ctx.closedEvents.length - 1];
	if (!latest) {
		return {
			skip: false,
			reason: `Issue #${ctx.issueNumber}: 直近 ClosedEvent が null、AC gate 通す`,
		};
	}

	const closerType = latest.closer?.__typename ?? null;

	if (closerType === 'PullRequest') {
		return {
			skip: true,
			reason: `Issue #${ctx.issueNumber}: PR #${latest.closer?.number} 経由 auto-close を検出、AC gate skip (PR Ready チェックリストで検証済み)`,
		};
	}

	if (closerType === 'Commit') {
		return {
			skip: true,
			reason: `Issue #${ctx.issueNumber}: Commit ${latest.closer?.oid?.slice(0, 8)} 経由 auto-close を検出 (squash merge "closes #N")、AC gate skip`,
		};
	}

	// closer === null → 手動 close (`gh issue close` / GitHub UI)
	return {
		skip: false,
		reason: `Issue #${ctx.issueNumber}: 手動 close を検出 (closer=null)、AC 検証 gate 通す`,
	};
}

/**
 * Issue body から未チェック AC 数を取得する純粋関数。
 *
 * @param {string} body
 * @returns {{ unchecked: number, checked: number }}
 */
export function countAcCheckboxes(body) {
	const safeBody = body ?? '';
	const uncheckedMatches = safeBody.match(/^\s*-\s*\[\s\]/gm) || [];
	const checkedMatches = safeBody.match(/^\s*-\s*\[(x|X)\]/gm) || [];
	return {
		unchecked: uncheckedMatches.length,
		checked: checkedMatches.length,
	};
}
