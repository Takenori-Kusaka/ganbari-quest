// src/lib/server/services/age-recalc-service.ts
// #1381: 子供の年齢自動インクリメントサービス (Sub B-3)
//
// 毎日 00:00 JST に /api/cron/age-recalc から呼ばれる。
// 全テナントの全 child を走査し、calculateAge() で得た年齢が child.age と異なる場合に:
//   - age を更新
//   - uiModeManuallySet=false の場合のみ uiMode を recalcUiMode() で再計算
//
// birthday-bonus-service.claimBirthdayBonus() との責務分担:
//   - claimBirthdayBonus: 誕生日ボーナス付与 + age/uiMode 更新（uiModeManuallySet を無視して常に上書き）
//   - 本サービス: age の日次同期 + uiModeManuallySet を考慮した uiMode 再計算
//   詳細は docs/design/26-ゲーミフィケーション設計書.md §13.9 を参照

import { todayDateJST } from '$lib/domain/date-utils';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { recalcUiMode } from '$lib/domain/validation/age-tier';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import type { IChildRepo } from '$lib/server/db/interfaces/child-repo.interface';
import type { Child } from '$lib/server/db/types/index';
import { logger } from '$lib/server/logger';
import { calculateAge } from '$lib/server/services/birthday-bonus-service';
import { recordUiModeChangeNotice } from '$lib/server/services/ui-mode-change-notice-service';

export interface AgeRecalcResult {
	/** 走査した child 総数（birthDate がない child を含む） */
	scanned: number;
	/** birthDate がないためスキップした child 数 */
	skipped: number;
	/** age が変化したため更新した child 数 */
	updated: number;
	/** 更新に失敗した child 数 */
	failures: number;
	/** dryRun=true の場合は実際には更新しない */
	dryRun: boolean;
	/** #4337: 全テナント数 */
	tenantsTotal: number;
	/** #4337: 今回の実行で実際に走査したテナント数 */
	tenantsProcessed: number;
	/**
	 * #4337: 件数上限 / 時間予算により今回走査せず次回以降へ持ち越したテナント数（総計）。
	 * `tenantsSkippedByRotation + tenantsSkippedByBudget` と常に一致する。
	 *
	 * #4345 follow-up: この値は 2 つの異なる原因を合算している。「打ち切り」と
	 * 「そもそも今日の担当外」の区別が要る場合は下記 2 フィールドを見ること。
	 */
	tenantsRemaining: number;
	/**
	 * #4345 follow-up: 決定的スライス選択（ローテーション）により、そもそも今日の
	 * 担当スライス対象外だったテナント数。**設計どおりの正常な持ち越し**であり、
	 * 異常の合図ではない（別の実行日に処理される）。テナント総数が `tenantLimit`
	 * 以下（sliceCount=1）の間は常に 0。
	 */
	tenantsSkippedByRotation: number;
	/**
	 * #4345 follow-up: 今日の担当スライスの中で、件数上限 / 時間予算超過により
	 * 走査できなかったテナント数。**打ち切り = 想定より処理が重かった合図**であり、
	 * warn の対象はこちらのみ。
	 */
	tenantsSkippedByBudget: number;
	/** #4337: 時間予算超過で打ち切ったか */
	budgetExceeded: boolean;
	/** #4337: 今回処理したスライス番号 (0-origin) / 全スライス数。持ち越し状況の観測用 */
	sliceIndex: number;
	sliceCount: number;
}

export interface AgeRecalcOptions {
	/** true の場合、更新を実行せず件数カウントのみ返す */
	dryRun?: boolean;
	/** テスト用: "今日" を上書きする (YYYY-MM-DD) */
	today?: string;
	/** #4337: 1 回の実行で走査する最大テナント数 (既定 {@link DEFAULT_TENANT_LIMIT})。 */
	tenantLimit?: number;
	/** #4337: 時間予算 (テスト注入用。省略時は新規生成)。 */
	budget?: TimeBudget;
}

/**
 * #4337: 1 回の実行で走査する最大テナント数。
 *
 * 1 テナントあたりのコストは `findAllChildren` 1 クエリ + 誕生日を迎えた child の
 * `updateChild` 数件と軽い (grace-period-deletion の 1 件 = Cognito + DB 全域 + Stripe とは
 * 桁が違うため limit=5 とは値が異なる)。現規模 (Pre-PMF ~100 tenants、13-AWS設計書 §3.3) を
 * 1 回の実行で全件処理しきれる値に置き、**実質の律速は 20 秒の時間予算**とする。
 * 本上限は「テナントが想定を超えて増えたときに 30 秒 timeout で全滅させない」ための hard stop。
 */
export const DEFAULT_TENANT_LIMIT = 200;

interface ProcessChildParams {
	child: Child;
	tenantId: string;
	today: string;
	dryRun: boolean;
	childRepo: IChildRepo;
}

interface ProcessChildResult {
	skipped: boolean;
	updated: boolean;
	failed: boolean;
}

/** 単一 child の年齢再計算処理（複雑度分割のためメインループから抽出） */
async function processChild(params: ProcessChildParams): Promise<ProcessChildResult> {
	const { child, tenantId, today, dryRun, childRepo } = params;

	if (!child.birthDate) {
		return { skipped: true, updated: false, failed: false };
	}

	const newAge = calculateAge(child.birthDate, today);
	if (newAge === child.age) {
		return { skipped: false, updated: false, failed: false };
	}

	// Child.uiMode は string 型だが、DB 上では UiMode の値しか入らない
	const newUiMode = recalcUiMode(
		{ uiMode: child.uiMode as UiMode, uiModeManuallySet: child.uiModeManuallySet },
		newAge,
	);

	if (dryRun) {
		return { skipped: false, updated: true, failed: false };
	}

	try {
		await childRepo.updateChild(child.id, { age: newAge, uiMode: newUiMode }, tenantId);

		// #4313: 年齢帯の境界 (3 / 6 / 13 / 16 歳) を跨いで uiMode が変わったときだけ、
		// その子供の**次回ログイン**で告知するための pending notice を残す。
		// 同一モード内の年齢変化 (例: 8→9 歳) では from === to になり記録されない。
		// updateChild 成功後にのみ呼ぶ (DB 未反映で告知だけ出さない)。
		if (child.uiMode !== newUiMode) {
			await recordUiModeChangeNotice(
				{ childId: child.id, from: child.uiMode as UiMode, to: newUiMode, changedOn: today },
				tenantId,
			);
		}

		logger.info('[age-recalc] updated child', {
			service: 'age-recalc',
			tenantId,
			context: {
				childId: child.id,
				oldAge: child.age,
				newAge,
				oldUiMode: child.uiMode,
				newUiMode,
				uiModeManuallySet: child.uiModeManuallySet,
			},
		});
		return { skipped: false, updated: true, failed: false };
	} catch (e) {
		logger.error('[age-recalc] failed to update child', {
			service: 'age-recalc',
			tenantId,
			error: e instanceof Error ? e.message : String(e),
			context: { childId: child.id },
		});
		return { skipped: false, updated: false, failed: true };
	}
}

/**
 * #4337: 実行日 (JST 暦日) から決まる「今回処理するスライス」を選ぶ。
 *
 * 全テナントを tenantId 昇順に並べ、`limit` 件ずつの固定スライスに分割し、
 * 実行日の通し日数 (UNIX epoch からの日数) で剰余を取ってスライスを 1 つ選ぶ。
 *
 * この方式を採る理由:
 * - **再開位置に永続ストアが要らない**。settings はテナント単位 (`ISettingsRepo` の全 API が
 *   tenantId 必須) で、cron 全体のカーソルを置ける横断 kv が存在しない。テナント毎に
 *   「最終処理日」を持たせると全テナント分の設定読み取り = N+1 が増え ADR-0065 に反する
 * - **同じ先頭 N 件を毎回処理する形にならない**。スライスは日付で 1 つずつ前進し
 *   `ceil(total / limit)` 日で全テナントを重複なく網羅して周回する
 * - **決定的**。同じ実行日なら同じスライスを選ぶので、失敗した日の再実行が
 *   その日の担当分をやり直す (ランダム / 実行時刻依存だと再実行で別集合を触る)
 *
 * テナント総数が `limit` 以下なら常にスライスは 1 つ = 全件処理となり従来動作と同じ。
 */
function selectTenantSlice<T extends { tenantId: string }>(
	tenants: T[],
	limit: number,
	today: string,
): { slice: T[]; sliceIndex: number; sliceCount: number } {
	if (tenants.length === 0) return { slice: [], sliceIndex: 0, sliceCount: 1 };

	const ordered = [...tenants].sort((a, b) => (a.tenantId < b.tenantId ? -1 : 1));
	const sliceCount = Math.max(1, Math.ceil(ordered.length / limit));
	// 暦日文字列を UTC 深夜として解釈するため、プロセス TZ に依存しない (#4015 / #4127)
	const dayIndex = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
	const sliceIndex = ((dayIndex % sliceCount) + sliceCount) % sliceCount;
	const start = sliceIndex * limit;
	return { slice: ordered.slice(start, start + limit), sliceIndex, sliceCount };
}

/**
 * 全テナントの全 child を走査し、age を現在日付から再計算する。
 * uiModeManuallySet=false の場合のみ uiMode も再計算する。
 * retention-cleanup-service と同様に listAllTenants → findAllChildren の 2 段階走査を行う。
 *
 * #4337 (30 秒 self-limiting + 持ち越し規約、13-AWS設計書 §3.3): 処理量がテナント数に比例する
 * ため、1 回の実行で走査するのは最大 {@link DEFAULT_TENANT_LIMIT} 件 + 時間予算内に留め、
 * 残りは次回以降の実行へ持ち越す (`tenantsRemaining` で報告)。予算チェックはテナント間で
 * 行い、着手したテナントの child は最後まで処理する (中途状態を作らない)。
 * 持ち越すと誕生日を迎えた child の UI モード切替がその分だけ遅れるが、age は birthDate から
 * 何度でも導出できる冪等な計算であり、遅れて処理されても値は同じ (データは壊れない)。
 */
export async function recalcAllChildrenAges(
	options: AgeRecalcOptions = {},
): Promise<AgeRecalcResult> {
	const dryRun = options.dryRun ?? false;
	const today = options.today ?? todayDateJST();
	const tenantLimit = options.tenantLimit ?? DEFAULT_TENANT_LIMIT;
	const budget = options.budget ?? createTimeBudget();

	const repos = getRepos();
	const tenants = await repos.auth.listAllTenants();
	const { slice, sliceIndex, sliceCount } = selectTenantSlice(tenants, tenantLimit, today);

	let scanned = 0;
	let skipped = 0;
	let updated = 0;
	let failures = 0;
	let tenantsProcessed = 0;
	let budgetExceeded = false;

	for (const tenant of slice) {
		// #4337: 30 秒 self-limiting — 予算超過ならここで打ち切り、残りは次回実行へ持ち越す。
		if (budget.exceeded()) {
			budgetExceeded = true;
			break;
		}
		tenantsProcessed++;
		const children = await repos.child.findAllChildren(tenant.tenantId);

		for (const child of children) {
			scanned++;
			const res = await processChild({
				child,
				tenantId: tenant.tenantId,
				today,
				dryRun,
				childRepo: repos.child,
			});
			if (res.skipped) skipped++;
			if (res.updated) updated++;
			if (res.failed) failures++;
		}
	}

	// #4345 follow-up: 「今日の担当外（ローテーション、正常）」と「担当スライス内での
	// 打ち切り（予算超過、異常）」を分けて数える。前者は tenants.length > tenantLimit の
	// 定常状態で毎日発生しうる設計どおりの値であり、warn の対象にしない。
	const tenantsSkippedByRotation = tenants.length - slice.length;
	const tenantsSkippedByBudget = slice.length - tenantsProcessed;
	const tenantsRemaining = tenantsSkippedByRotation + tenantsSkippedByBudget;

	if (tenantsSkippedByBudget > 0) {
		// #4337: silent 持ち越し禁止 (ADR-0006 整合) — 打ち切り（想定より処理が重かった）は
		// 必ず warn に残す。ローテーションによる担当外は異常ではないため warn しない。
		logger.warn('[age-recalc] carried over remaining tenants to next run (budget cutoff)', {
			service: 'age-recalc',
			context: {
				remaining: tenantsRemaining,
				skippedByBudget: tenantsSkippedByBudget,
				skippedByRotation: tenantsSkippedByRotation,
				processed: tenantsProcessed,
				total: tenants.length,
				tenantLimit,
				sliceIndex,
				sliceCount,
				budgetExceeded,
				elapsedMs: budget.elapsedMs(),
			},
		});
	} else if (tenantsSkippedByRotation > 0) {
		// 設計どおりのローテーション。異常ではないが観測はできるようにしておく (info)。
		logger.info('[age-recalc] rotation slice skipped tenants outside today (by design)', {
			service: 'age-recalc',
			context: {
				skippedByRotation: tenantsSkippedByRotation,
				processed: tenantsProcessed,
				total: tenants.length,
				tenantLimit,
				sliceIndex,
				sliceCount,
			},
		});
	}

	return {
		scanned,
		skipped,
		updated,
		failures,
		dryRun,
		tenantsTotal: tenants.length,
		tenantsProcessed,
		tenantsSkippedByRotation,
		tenantsSkippedByBudget,
		tenantsRemaining,
		budgetExceeded,
		sliceIndex,
		sliceCount,
	};
}
