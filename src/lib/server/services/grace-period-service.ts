// src/lib/server/services/grace-period-service.ts
// #742: プラン別の削除後グレースピリオド管理
//
// アカウント削除を「ソフトデリート」として扱い、プラン別に定められた
// 猶予期間内であれば復元を可能にする。
//
// プラン別グレースピリオド:
//   free:     0日（即時削除）
//   standard: 7日間
//   family:   30日間

import { DELETION_GRACE_PERIOD_DAYS } from '$lib/domain/constants/deletion-grace';
import { formatJSTDate, toJSTDateString } from '$lib/domain/date-utils';
import { env } from '$lib/runtime/env';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import type { DeletionRoute } from './account-deletion-service';
import type { PlanTier } from './plan-limit-service';
import { resolveFullPlanTier } from './plan-limit-service';
import { GRACE_PERIOD_JUDGMENT_KEYS } from './soft-delete-keys';

/**
 * #4338: 本 service (猶予満了バッチ) が取りうる削除経路。
 * `immediate` は無料プランの退会 API 固有の経路であり、ここには到達しない。
 * 型で除外しておくことで、誤って即時削除として記録できないようにする。
 * (関数の import は循環回避のため dynamic import だが、型は erase されるので直接 import してよい)
 */
type PurgeRoute = Extract<DeletionRoute, 'grace-expiry' | 'manual'>;

// ============================================================
// Constants
// ============================================================

/**
 * #2399: 削除予告メールの送信済フラグ (settings KV キー)。
 *
 * soft delete 状態を構成する KV 群と同じライフサイクルを持つ (予約でリセット / 復元でクリア) ため、
 * キーの定義は本 service 側に置く。判定ロジックは deletion-warning-service が持つ。
 */
export const DELETION_WARNING_SENT_KEY = 'deletion_warning_sent_at';

/**
 * #4327: 物理削除の**部分失敗**を表す log 行の検索語 (SSOT)。
 *
 * この語で CloudWatch Logs MetricFilter を張り、alarm 化する
 * (`infra/lib/ops-stack.ts` の `GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM` と同値であることを
 * `tests/unit/infra/grace-period-deletion-safety.test.ts` が drift 検証する)。
 * infra は CDK の rootDir 制約で src から import できないため、値の二重定義 + test で守る
 * (`ENTITLEMENT_FAIL_CLOSED_LOG_TERM` と同じ形)。
 */
export const GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM = '[grace-period-deletion] partial failure';

/**
 * 実体を leaf module に置き、ここから re-export するもの (本 module の public API は不変)。
 *
 * - `GRACE_PERIOD_JUDGMENT_KEYS` (#4338): soft-delete 判定キーの SSOT。実体は
 *   `soft-delete-keys.ts` (削除側 tenant-cleanup-service との import cycle を避けるため)。
 * - `DELETION_GRACE_PERIOD_DAYS` (#4496): 猶予日数の値 SSOT。実体は domain leaf
 *   `$lib/domain/constants/deletion-grace`。顧客に見える文言側 (terms.ts → labels.ts → LP) は
 *   server module を import できないため、値を domain に置かないと数値が複製される
 *   (複製された「7 日 / 30 日」が**解約**の説明に転用されたのが #4496 の根本原因)。
 */
export { DELETION_GRACE_PERIOD_DAYS, GRACE_PERIOD_JUDGMENT_KEYS };

// ============================================================
// Types
// ============================================================

export interface SoftDeleteResult {
	success: boolean;
	softDeletedAt: string;
	gracePeriodDays: number;
	physicalDeletionDate: string;
	requiresImmediateDeletion: boolean;
}

export interface GracePeriodStatus {
	isSoftDeleted: boolean;
	softDeletedAt: string | null;
	gracePeriodDays: number;
	physicalDeletionDate: string | null;
	daysRemaining: number;
	isExpired: boolean;
	planTier: PlanTier | null;
	/**
	 * #4316: soft-delete メタデータが不完全 (`physical_deletion_date` /
	 * `deletion_grace_plan_tier` が欠落・不正) であることを示す。
	 *
	 * true のとき `isExpired` は必ず false になり (= 復元できる)、物理削除の母集団にも
	 * 入らない。「いつ消してよいか不明」を「もう消してよい」に写像しないための旗。
	 */
	metadataIncomplete: boolean;
}

export interface RestoreResult {
	success: boolean;
	tenantId: string;
}

// ============================================================
// Soft delete
// ============================================================

/**
 * 退会予約の受付をオーナーへ通知する (#4507)。
 *
 * 送信可否で予約処理を止めないため、失敗は例外にせずログに残すだけにする
 * (宛先不明・SES 障害で「退会できない」を作らない)。
 */
async function notifyDeletionReserved(
	tenantId: string,
	physicalDeletionDate: string,
	graceDays: number,
): Promise<void> {
	try {
		const repos = getRepos();
		const members = await repos.auth.findTenantMembers(tenantId);
		const owner = members.find((m) => m.role === 'owner');
		if (!owner) {
			logger.warn('[grace-period] no owner found; deletion reserved without notification', {
				context: { tenantId },
			});
			return;
		}
		const user = await repos.auth.findUserById(owner.userId);
		if (!user?.email) {
			logger.warn('[grace-period] owner has no email; deletion reserved without notification', {
				context: { tenantId },
			});
			return;
		}
		const tenant = await repos.auth.findTenantById(tenantId);
		const { sendDeletionReservedEmail } = await import('./email-service');
		const ok = await sendDeletionReservedEmail({
			email: user.email,
			ownerName: user.displayName || tenant?.name || '',
			deletionDate: formatJSTDate(toJSTDateString(new Date(physicalDeletionDate))),
			graceDays,
		});
		if (!ok) {
			logger.error('[grace-period] deletion reserved email send failed', {
				context: { tenantId },
			});
		}
	} catch (err) {
		logger.error('[grace-period] deletion reserved email failed', {
			error: String(err),
			context: { tenantId },
		});
	}
}

/**
 * テナントをソフトデリートする。
 *
 * プランに応じたグレースピリオドを計算し、テナントに soft_deleted_at を記録する。
 * free プランは即時物理削除が必要なため requiresImmediateDeletion=true を返す。
 */
export async function softDeleteTenant(
	tenantId: string,
	licenseStatus: string,
	planId?: string,
): Promise<SoftDeleteResult> {
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, planId);
	const graceDays = DELETION_GRACE_PERIOD_DAYS[planTier];
	const now = new Date();
	const softDeletedAt = now.toISOString();

	const physicalDate = new Date(now);
	physicalDate.setDate(physicalDate.getDate() + graceDays);
	const physicalDeletionDate = physicalDate.toISOString();

	if (graceDays === 0) {
		logger.info('[grace-period] Free plan: immediate deletion required', {
			context: { tenantId, planTier },
		});
		return {
			success: true,
			softDeletedAt,
			gracePeriodDays: 0,
			physicalDeletionDate: softDeletedAt,
			requiresImmediateDeletion: true,
		};
	}

	// Soft delete state is stored in settings table (not Tenant entity)
	// to avoid schema migration on DynamoDB.
	//
	// #4316: **sentinel-last** — 書き込み順序で「宙吊り」の成立を防ぐ。
	// `setSetting` は 1 キー 1 文の upsert (dsql/settings-repo.ts) で、複数キーをまとめる
	// txn は settings repo に無い。したがって途中失敗 (Lambda timeout / DSQL OCC 40001 /
	// 接続断) は起こりうる前提で順序を決める。
	//
	// `soft_deleted_at` は soft-delete 状態を起動する sentinel である
	// (getGracePeriodStatus の早期 return と hooks.server.ts の読み取り専用ロック判定が
	// これだけを見る)。これを **最後に** 書けば、途中で失敗しても残るのは
	// 「sentinel が立っていない = soft-delete が始まっていない」状態だけになり、
	// 「ロックはかかるが物理削除の母集団に入らない」宙吊りが成立しない。
	// 逆に先に書くと (旧実装)、1 本目成功 + 3 本目失敗がそのまま宙吊りになる。
	const repos = getRepos();
	await repos.settings.setSetting('physical_deletion_date', physicalDeletionDate, tenantId);
	await repos.settings.setSetting('deletion_grace_plan_tier', planTier, tenantId);
	// #2399: 予約は何度でもやり直せる。前回分の送信済フラグが残っていると 2 回目の予約が
	// 「予告なしで消える」無音になるため、予約のたびに落とす (復元側でも落とすが二重で担保する)。
	// #4316 の sentinel-last を守るため、sentinel (soft_deleted_at) より前に落とす。
	// ここで失敗しても sentinel が立たない = soft-delete が始まらないので、
	// 「送信済フラグが残ったまま猶予期間に入る」= 無音削除は成立しない。
	await repos.settings.setSetting(DELETION_WARNING_SENT_KEY, '', tenantId);
	await repos.settings.setSetting('soft_deleted_at', softDeletedAt, tenantId);

	logger.info('[grace-period] Tenant soft deleted', {
		context: { tenantId, planTier, graceDays, physicalDeletionDate },
	});

	// #4507: 予約を受け付けたことをオーナーへ通知する。
	//   sentinel (soft_deleted_at) を書いた**後**に送る。先に送ると、後続の書き込みが
	//   失敗して soft-delete が成立しなかったときに「予約しました」だけが届く。
	//   送信失敗で予約自体を巻き戻さない (削除の受付は成立しており、猶予期限も止まらない)。
	//   届かなかったことは下の logger.error と、猶予中の削除予告メール (#2399) で補う。
	await notifyDeletionReserved(tenantId, physicalDeletionDate, graceDays);

	return {
		success: true,
		softDeletedAt,
		gracePeriodDays: graceDays,
		physicalDeletionDate,
		requiresImmediateDeletion: false,
	};
}

// ============================================================
// Grace period status
// ============================================================

/** 保存済み ISO 文字列を Date にする。未設定 / 空文字 / パース不能は null。 */
function parseStoredDate(value: string | undefined | null): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 保存済みプランティアを検証する。未設定 / 未知の値は null。 */
function parseStoredPlanTier(value: string | undefined | null): PlanTier | null {
	if (!value) return null;
	return value in DELETION_GRACE_PERIOD_DAYS ? (value as PlanTier) : null;
}

/**
 * テナントのグレースピリオド状態を取得する。
 *
 * #4316: `physical_deletion_date` / `deletion_grace_plan_tier` が欠落している行
 * (softDeleteTenant の部分書き込みで成立しうる) は「期限切れ」ではなく
 * 「メタデータ不完全」として扱い、復元を許す。旧実装は欠落時に `deleteDate = now`
 * へフォールバックしていたため `now >= now` が恒真となり、復元が恒久拒否される一方で
 * 物理削除の母集団にも入らない「宙吊り」を作っていた。
 */
export async function getGracePeriodStatus(tenantId: string): Promise<GracePeriodStatus> {
	const repos = getRepos();
	// #4338: 読むキーの列挙は GRACE_PERIOD_JUDGMENT_KEYS が SSOT (物理削除の「残すキー」と同一)。
	const values = await repos.settings.getSettings([...GRACE_PERIOD_JUDGMENT_KEYS], tenantId);

	const softDeletedAt = values.soft_deleted_at ?? null;
	if (!softDeletedAt) {
		return {
			isSoftDeleted: false,
			softDeletedAt: null,
			gracePeriodDays: 0,
			physicalDeletionDate: null,
			daysRemaining: 0,
			isExpired: false,
			planTier: null,
			metadataIncomplete: false,
		};
	}

	const storedPhysicalDeletionDate = values.physical_deletion_date ?? null;
	const storedPlanTier = parseStoredPlanTier(values.deletion_grace_plan_tier);
	const planTier = storedPlanTier ?? 'free';
	const graceDays = DELETION_GRACE_PERIOD_DAYS[planTier];
	const deleteDate = parseStoredDate(storedPhysicalDeletionDate);

	// #4316: メタデータが不完全なら「期限切れ」に倒さない (安全側 = データを消さない側)。
	// 復元は許可し、物理削除の母集団には入れない (findExpiredSoftDeletedTenants)。
	// 顧客は復元 → 退会し直しで正常な状態に復帰でき、宙吊りから抜けられる。
	if (deleteDate === null || storedPlanTier === null) {
		// 既存のログ経路に載せて検出可能にする (新規の通知機構は作らない)。
		logger.warn(
			'[grace-period] soft-delete metadata incomplete (physical_deletion_date / deletion_grace_plan_tier); treating as NOT expired',
			{
				context: {
					tenantId,
					softDeletedAt,
					storedPhysicalDeletionDate,
					storedPlanTier: values.deletion_grace_plan_tier ?? null,
				},
			},
		);
		return {
			isSoftDeleted: true,
			softDeletedAt,
			// tier 欠落時は planTier が 'free' にフォールバックするため graceDays は 0 になる。
			gracePeriodDays: graceDays,
			physicalDeletionDate: null,
			daysRemaining: 0,
			isExpired: false,
			planTier: storedPlanTier,
			metadataIncomplete: true,
		};
	}

	const now = new Date();
	const daysRemaining = Math.max(
		0,
		Math.ceil((deleteDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
	);
	const isExpired = now >= deleteDate;

	return {
		isSoftDeleted: true,
		softDeletedAt,
		gracePeriodDays: graceDays,
		physicalDeletionDate: storedPhysicalDeletionDate,
		daysRemaining,
		isExpired,
		planTier,
		metadataIncomplete: false,
	};
}

// ============================================================
// Restore
// ============================================================

/**
 * ソフトデリートされたテナントを復元する。
 *
 * グレースピリオド内であれば、ソフトデリート情報をクリアして
 * テナントを通常状態に戻す。
 */
export async function restoreSoftDeletedTenant(tenantId: string): Promise<RestoreResult> {
	const status = await getGracePeriodStatus(tenantId);

	if (!status.isSoftDeleted) {
		logger.warn('[grace-period] Tenant is not soft deleted', {
			context: { tenantId },
		});
		return { success: false, tenantId };
	}

	if (status.isExpired) {
		logger.warn('[grace-period] Grace period expired, cannot restore', {
			context: { tenantId, physicalDeletionDate: status.physicalDeletionDate },
		});
		return { success: false, tenantId };
	}

	// ソフトデリート情報をクリア
	// Empty string = unset (deleteSetting が存在しないため)
	//
	// #4316: **sentinel-first** — クリアは sentinel (`soft_deleted_at`) から消す。
	// 途中で失敗しても残るのは「sentinel が消えている = 復元済み」状態であり、
	// 安全側 (データを消さない側) に倒れる。set 側の sentinel-last と対になる。
	const repos = getRepos();
	await repos.settings.setSetting('soft_deleted_at', '', tenantId);
	await repos.settings.setSetting('deletion_grace_plan_tier', '', tenantId);
	await repos.settings.setSetting('physical_deletion_date', '', tenantId);
	// #2399: 予告メールの送信済フラグも落とす。残したままだと再度削除予約したときに
	// 「送信済」と判定され、2 回目の予約が予告なしで物理削除まで進む (無音の再発)。
	await repos.settings.setSetting(DELETION_WARNING_SENT_KEY, '', tenantId);

	logger.info('[grace-period] Tenant restored from soft delete', {
		context: { tenantId },
	});

	return { success: true, tenantId };
}

// ============================================================
// Physical deletion check (cron)
// ============================================================

/**
 * グレースピリオド期限切れのテナントを検出する。
 *
 * cron ジョブから呼び出され、期限切れのテナントの物理削除を実行する。
 * 実際の物理削除は account-deletion-service を呼び出す。
 */
export async function findExpiredSoftDeletedTenants(): Promise<
	Array<{ tenantId: string; planTier: PlanTier; physicalDeletionDate: string }>
> {
	// N+1: Pre-PMF (<100 tenants) では許容。スケール時は GSI or バッチ取得に移行 (ADR-0034)
	const repos = getRepos();
	const allTenants = await repos.auth.listAllTenants();
	const expired: Array<{
		tenantId: string;
		planTier: PlanTier;
		physicalDeletionDate: string;
	}> = [];

	for (const tenant of allTenants) {
		const status = await getGracePeriodStatus(tenant.tenantId);
		// #4316: `metadataIncomplete` を明示的に除外する。`isExpired === false` /
		// `physicalDeletionDate === null` でも既に除外されるが、「いつ消してよいか不明な行は
		// 物理削除しない」という意図をこの条件で読めるようにしておく (多重防御)。
		if (
			status.isSoftDeleted &&
			status.isExpired &&
			status.physicalDeletionDate &&
			!status.metadataIncomplete
		) {
			expired.push({
				tenantId: tenant.tenantId,
				planTier: status.planTier ?? 'free',
				physicalDeletionDate: status.physicalDeletionDate,
			});
		}
	}

	return expired;
}

/**
 * テナントのグレースピリオド情報のサマリを返す（UI 表示用）。
 */
export function getGracePeriodDays(planTier: PlanTier): number {
	return DELETION_GRACE_PERIOD_DAYS[planTier];
}

// ============================================================
// Physical deletion (cron)
// ============================================================

/**
 * #1648 R43: グレースピリオド期限切れテナントを物理削除する cron 処理。
 *
 * 呼び出し元: /api/cron/grace-period-deletion (#1376 EventBridge スケジュール経由)
 *
 * 処理フロー:
 *   1. findExpiredSoftDeletedTenants() で期限切れテナント一覧を取得
 *   2. 各テナントの owner を特定
 *   3. account-deletion-service.deleteOwnerOnlyAccount を呼び出して物理削除
 *      （他メンバーがいる場合は deleteOwnerFullDelete に切替）
 *
 * 注: Stripe サブスクリプションは soft-delete に至る経路（admin/account/delete）で
 * すでにキャンセル済みの想定。account-deletion-service.fullTenantDeletion は
 * 念のため再度 cancelSubscription を呼ぶが、idempotent な実装のため二重呼び出しは安全。
 *
 * dryRun=true の場合は対象一覧のみ返し、削除は実行しない。
 *
 * #3695 (30 秒 self-limiting + 持ち越し規約、13-AWS設計書 §3.3): テナント物理削除は
 * 1 件あたりが重い (Cognito + DynamoDB 全域 + Stripe) ため、1 回の実行で処理するのは
 * 最大 limit 件 (既定 {@link DEFAULT_PURGE_LIMIT}) + 時間予算内に留め、残りは翌日の
 * 実行に持ち越す (`tenantsRemaining` で報告)。個人情報保護法 22 条は努力義務であり
 * 1-2 日の持ち越しは許容範囲。
 *
 * 個人情報保護法 22 条「不要となった個人データの遅滞なく消去する努力義務」遵守 +
 * DB 肥大化リスク解消が目的（ADR-0010 過剰防衛禁止に該当しない最小実装）。
 */
export const DEFAULT_PURGE_LIMIT = 5;

/**
 * #4327: 物理削除の kill-switch (env)。`'true'` / `'1'` で**削除を一切実行しない**。
 *
 * 不可逆な削除を止める手段が EventBridge Rule の手動 disable しかない状態を解消する。
 * Rule 側 (`aws events disable-rule`) は「cron を呼ばない」防御、本 env は
 * 「呼ばれても消さない」防御で、層が違う (手動実行 / 別経路からの呼び出しも止まる)。
 *
 * 既定 (未設定) は有効 = 従来動作。新規 required env は増やさない (opt-out 方式)。
 * 手順は `docs/runbooks/grace-period-deletion-operations.md`。
 */
export const GRACE_PERIOD_DELETION_DISABLED_ENV = 'GRACE_PERIOD_DELETION_DISABLED';

/** 「止める」と解釈する値。障害対応中に手で打つものなので表記ゆれを許容する。 */
const DISABLED_VALUES = new Set(['true', '1', 'yes', 'on']);
/** 「止めない」と解釈する値 (明示的に有効化した状態)。 */
const ENABLED_VALUES = new Set(['false', '0', 'no', 'off', '']);

function isPhysicalDeletionDisabled(): boolean {
	const raw = env.GRACE_PERIOD_DELETION_DISABLED;
	if (raw === undefined) return false;
	const normalized = raw.trim().toLowerCase();
	if (DISABLED_VALUES.has(normalized)) return true;
	if (ENABLED_VALUES.has(normalized)) return false;

	// #4340 follow-up: 解釈できない値は **「止める」側に倒す**。
	//
	// 対象が取り消せない顧客データの物理削除であり、この env は障害対応中に手で打つ。
	// `=tru` のような打ち間違いを「有効」に倒すと、止めたつもりの運用者が
	// 「止まっていない」ことに気付けないまま削除が走る (気付く手段が warn ログしかない)。
	// 同じ #4327 の対処が `metadataIncomplete` で「判定材料の欠落は安全側に倒す」を
	// 採っているのと同じ向きに揃える。
	//
	// throw しないのは変えていない (障害対応中の typo でアプリ全体を落とさないため)。
	// 「throw しない」ことと「有効に倒す」ことは別で、止める側に倒しても throw は要らない。
	//
	// 止まったことは 200 + `disabled: true` で観測できる。逆に「止めたつもりで止まらない」は
	// 削除が完了するまで観測できない — 非対称なので観測できる側に倒す。
	logger.warn(
		`[grace-period] ${GRACE_PERIOD_DELETION_DISABLED_ENV} の値を解釈できません。物理削除は「停止」として扱います`,
		{ context: { value: raw, expected: [...DISABLED_VALUES].join(' / ') } },
	);
	return true;
}

/**
 * #4373: dryRun が返す件数の**予測**。
 *
 * dryRun は「有効化してよいか / 何件消えるか」を消さずに確かめるモードなので、
 * 件数は定数ではなく実行時と同じ打ち切り条件 (limit / 時間予算) から出す。
 * 定数を返すと対象が何件あっても同じ数字が返り、判断材料として嘘をつく
 * (2026-08-06 に「tenantsRemaining: 0 なので有効化して安全」と報告された実害)。
 *
 * ここの条件は実行ループの break 条件 (`attempted >= limit || budget.exceeded()`) と
 * 同値でなければならない。同値性は「予測値 == 実行モードの実測値」を assert する
 * unit test が固定する。
 */
function predictPurgeCounts(
	expiredCount: number,
	limit: number,
	budget: TimeBudget,
): { wouldProcess: number; wouldRemain: number } {
	const wouldProcess = budget.exceeded() ? 0 : Math.min(expiredCount, limit);
	return { wouldProcess, wouldRemain: expiredCount - wouldProcess };
}

export async function purgeExpiredSoftDeletedTenants(opts?: {
	dryRun?: boolean;
	/** #3695: 1 回の実行で物理削除を試行する最大テナント数。 */
	limit?: number;
	/** #3695: 時間予算 (テスト注入用。省略時は endpoint 側が生成した予算 or 新規生成)。 */
	budget?: TimeBudget;
	/**
	 * #4338: 削除記録に残す経路。定時実行か人の手かは HTTP レイヤでしか分からないため、
	 * endpoint が判定して渡す (`src/lib/server/cron/cron-trigger.ts`)。
	 * 省略時は `manual` — 渡し忘れを「定時実行」と誤記録しない安全側に倒す。
	 */
	route?: PurgeRoute;
}): Promise<{
	tenantsProcessed: number;
	tenantsDeleted: number;
	tenantsFailed: number;
	/** #3695: limit / 時間予算により今回処理せず次回実行へ持ち越した件数。 */
	tenantsRemaining: number;
	dryRun: boolean;
	/** #4327: kill-switch (env) により削除を実行しなかったことを示す。 */
	disabled: boolean;
	expired: Array<{ tenantId: string; planTier: PlanTier; physicalDeletionDate: string }>;
	errors: Array<{ tenantId: string; error: string }>;
}> {
	const dryRun = opts?.dryRun ?? false;
	const limit = opts?.limit ?? DEFAULT_PURGE_LIMIT;
	const budget = opts?.budget ?? createTimeBudget();
	const route: PurgeRoute = opts?.route ?? 'manual';

	// #4327: kill-switch — 対象の走査すら行わずに即返す (誤って消す経路を残さない)。
	if (isPhysicalDeletionDisabled()) {
		logger.warn('[grace-period] physical deletion is disabled by kill-switch env; skipping', {
			context: { env: GRACE_PERIOD_DELETION_DISABLED_ENV },
		});
		return {
			tenantsProcessed: 0,
			tenantsDeleted: 0,
			tenantsFailed: 0,
			tenantsRemaining: 0,
			dryRun,
			disabled: true,
			expired: [],
			errors: [],
		};
	}

	const expired = await findExpiredSoftDeletedTenants();

	if (dryRun || expired.length === 0) {
		const { wouldProcess, wouldRemain } = predictPurgeCounts(expired.length, limit, budget);
		logger.info('[grace-period] purge dry-run or no expired tenants', {
			context: { dryRun, count: expired.length, wouldProcess, limit },
		});
		return {
			tenantsProcessed: wouldProcess,
			tenantsDeleted: 0,
			tenantsFailed: 0,
			tenantsRemaining: wouldRemain,
			dryRun,
			disabled: false,
			expired,
			errors: [],
		};
	}

	// dynamic import を使用してサイクル依存を避ける（grace-period → account-deletion → 互いに参照しない）
	const { deleteOwnerOnlyAccount, deleteOwnerFullDelete } = await import(
		'./account-deletion-service'
	);
	const repos = getRepos();
	const errors: Array<{ tenantId: string; error: string }> = [];
	let deleted = 0;
	let attempted = 0;

	for (const item of expired) {
		// #3695: 30 秒 self-limiting — 件数上限 or 時間予算超過で残りを次回実行へ持ち越す。
		if (attempted >= limit || budget.exceeded()) break;
		attempted++;
		try {
			const members = await repos.auth.findTenantMembers(item.tenantId);
			const owner = members.find((m) => m.role === 'owner');
			if (!owner) {
				logger.warn('[grace-period] no owner found for tenant', {
					context: { tenantId: item.tenantId },
				});
				errors.push({ tenantId: item.tenantId, error: 'no owner found' });
				continue;
			}
			const otherMembers = members.filter((m) => m.userId !== owner.userId);
			if (otherMembers.length === 0) {
				// #4338: 削除記録の経路 (定時実行 = grace-expiry / 人の手 = manual) は呼び出し側の判定に従う。
				await deleteOwnerOnlyAccount(item.tenantId, owner.userId, {
					route,
					planTier: item.planTier,
				});
			} else {
				await deleteOwnerFullDelete(item.tenantId, owner.userId, {
					route,
					planTier: item.planTier,
				});
			}
			deleted++;
			logger.info('[grace-period] tenant physically deleted', {
				context: {
					tenantId: item.tenantId,
					planTier: item.planTier,
					physicalDeletionDate: item.physicalDeletionDate,
				},
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push({ tenantId: item.tenantId, error: msg });
			logger.error('[grace-period] tenant deletion failed', {
				context: { tenantId: item.tenantId, error: msg },
			});
		}
	}

	const remaining = expired.length - attempted;
	if (remaining > 0) {
		// #3695: silent 持ち越し禁止 (ADR-0006 整合) — 持ち越し発生を必ずログに残す。
		logger.warn('[grace-period] purge carried over remaining tenants to next run', {
			context: { remaining, attempted, limit, elapsedMs: budget.elapsedMs() },
		});
	}

	return {
		tenantsProcessed: attempted,
		tenantsDeleted: deleted,
		tenantsFailed: errors.length,
		tenantsRemaining: remaining,
		dryRun: false,
		disabled: false,
		expired,
		errors,
	};
}
