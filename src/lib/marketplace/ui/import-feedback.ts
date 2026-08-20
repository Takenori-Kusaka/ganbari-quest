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
import type { ImportBlocked } from '$lib/marketplace/types';

export type ImportFeedbackTone = 'success' | 'info' | 'error';

export interface ImportFeedback {
	message: string;
	tone: ImportFeedbackTone;
	/**
	 * #4693: プラン上限が理由で取込対象から外れたときのアップグレード導線 URL。
	 * それ以外は null。呼び出し側は `actionUpgradeUrl` にそのまま代入する
	 * (NN/G #9 error recovery: 「どこへ行けば解消できるか」を必ず併記する)。
	 */
	upgradeUrl: string | null;
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
 * #4693: 取込結果の `blocked` (プラン上限で意図的に外した分) を読む。
 *
 * 旧実装はこの理由が `errors` 配列にしか無く、UI はそれを読んでいなかったため、
 * **上限で 119 件全部が弾かれても「0 件を復元しました」** と成功トーンで出ていた
 * (AC1 の upsell 導線がユーザーに一度も見えない)。件数 0 / 空文字の壊れた値は
 * 「無い」とみなし、成功表示を汚さない側に倒す。
 */
function readBlocked(data: Record<string, unknown> | undefined): ImportBlocked | null {
	const raw = data?.blocked;
	if (!raw || typeof raw !== 'object') return null;
	const b = raw as Record<string, unknown>;
	const count = toCount(b.count);
	const message = typeof b.message === 'string' ? b.message : '';
	if (count === 0 || message === '') return null;
	return { count, message, upgradeUrl: typeof b.upgradeUrl === 'string' ? b.upgradeUrl : null };
}

/**
 * 取込成功 ActionResult の data から表示 message / tone / upgrade 導線を解決する。
 *
 * 優先順位 (#2824 取込永続 honesty / #2830 / #4693):
 *   1. failed > 0 → partial-failure (error tone)。imported > 0 でも「N 件登録しました」と偽らない
 *   2. blocked あり → プラン上限で外した理由 (error tone) + upgrade 導線。
 *      imported > 0 なら「入った件数」と並べて出す (片方だけだと誤解される)
 *   3. imported > 0 → success
 *   4. それ以外 (純粋な全件重複) → allDuplicates (info)
 *
 * 2 が 3 より先なのは、「上限で入らなかった」を成功トーンに畳み込まないため。上限で 1 件も
 * 入らなかったケースは imported=0 / failed=0 になるので、blocked を見ないと 4 (すでに追加済み)
 * に落ちて **理由も導線も消える** (#4693 adversarial D2 / D3 の実害)。
 */
export function resolveImportFeedback(
	data: Record<string, unknown> | undefined,
	labels: ImportFeedbackLabels,
): ImportFeedback {
	const imported = toCount(data?.imported);
	// #2955: server 算出 failed が件数 SSOT。errors.length への fallback は行わない (冒頭 doc 参照)。
	const failed = toCount(data?.failed);
	const blocked = readBlocked(data);
	if (failed > 0) {
		const partialFailure =
			labels.partialFailure ?? MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure;
		const failureText = partialFailure(imported, failed);
		// 保存失敗と上限超過が同時に起きたときは両方言う。上限の理由を落とすと、
		// 併記したアップグレード導線だけが理由なしで残る。
		return {
			message: blocked
				? MARKETPLACE_IMPORT_FEEDBACK_LABELS.blockedAfterImport(failureText, blocked.message)
				: failureText,
			tone: 'error',
			upgradeUrl: blocked?.upgradeUrl ?? null,
		};
	}
	if (blocked) {
		return {
			message:
				imported > 0
					? MARKETPLACE_IMPORT_FEEDBACK_LABELS.blockedAfterImport(
							labels.success(imported),
							blocked.message,
						)
					: blocked.message,
			tone: 'error',
			upgradeUrl: blocked.upgradeUrl,
		};
	}
	if (imported > 0) {
		return { message: labels.success(imported), tone: 'success', upgradeUrl: null };
	}
	return { message: labels.allDuplicates, tone: 'info', upgradeUrl: null };
}
