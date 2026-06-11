/**
 * marketplace 取込 result feedback 解決 helper — Issue #2955 (#2830 / #2935 follow-up)
 *
 * `?import=<presetId>` → ChildSelectionDialog 確定 → form action の成功 ActionResult を受けて、
 * 2 層 feedback (Toast + in-page banner、DESIGN.md §5) に出す message / tone を 1 箇所で決める。
 * 旧実装は同型の if/else 分岐が admin/activities にのみ存在し、rewards / checklists / challenges
 * では server 算出の `failed` が UI に到達せず「部分失敗でも成功 toast のみ」になっていた
 * (4 page 同型ロジックの重複を避けるため本 helper に共通化、CLAUDE.md [B] コンポーネント化)。
 *
 * 件数 SSOT (#2955 判断記録):
 *   - 失敗件数は server (Strategy) 算出の `failed` のみを参照する。旧 `errors.length` fallback は
 *     撤去した。理由: (1) 5 strategy 全てが `failed` を配線済で `ImportResult.failed` は required 化
 *     済み (types.ts)、dispatcher (#2955) も素通しする。(2) `errors` は per-child catch 行 / 集計行 /
 *     rule-preset の warnings merge が混在する表示ログであり、長さを失敗数として読むと過小
 *     (bulk throw) にも過大 (warnings 誤算入) にも振れる。
 *   - `failed` 欠落 (型契約違反の異常系) は 0 扱い = 旧来の成功表示に縮退し、誤った失敗件数を
 *     表示しない側に倒す。
 *
 * 関連: ADR-0052 (ImportStrategy) / DESIGN.md §5 (Toast 2 層防御) / §10 (5 type consistency)
 */

import { MARKETPLACE_IMPORT_FEEDBACK_LABELS } from '$lib/domain/labels';

export type ImportFeedbackTone = 'success' | 'info' | 'error';

export interface ImportFeedback {
	message: string;
	tone: ImportFeedbackTone;
}

/**
 * page 固有の文言セット。partialFailure は省略時 MARKETPLACE_IMPORT_FEEDBACK_LABELS を使う
 * (type 横断で同一文言、NN/G #4 consistency)。
 */
export interface ImportFeedbackLabels {
	/** imported > 0 かつ failed = 0 の成功文言 (例: 「✨ N 件のごほうびを追加しました」) */
	success: (imported: number) => string;
	/** imported = 0 かつ failed = 0 (純粋な重複 skip) の文言 */
	allDuplicates: string;
	/** failed > 0 の partial-failure 文言 (既定: 共通 compound) */
	partialFailure?: (imported: number, failed: number) => string;
}

function toCount(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 取込成功 ActionResult の data から表示 message / tone を解決する。
 *
 * 優先順位 (#2824 取込永続 honesty / #2830):
 *   1. failed > 0 → partial-failure (error tone)。imported > 0 でも「N 件登録しました」と偽らない
 *   2. imported > 0 → success
 *   3. それ以外 (純粋な全件重複) → allDuplicates (info)
 */
export function resolveImportFeedback(
	data: Record<string, unknown> | undefined,
	labels: ImportFeedbackLabels,
): ImportFeedback {
	const imported = toCount(data?.imported);
	// #2955: server 算出 failed が件数 SSOT。errors.length への fallback は行わない (冒頭 doc 参照)。
	const failed = toCount(data?.failed);
	if (failed > 0) {
		const partialFailure =
			labels.partialFailure ?? MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure;
		return { message: partialFailure(imported, failed), tone: 'error' };
	}
	if (imported > 0) {
		return { message: labels.success(imported), tone: 'success' };
	}
	return { message: labels.allDuplicates, tone: 'info' };
}
