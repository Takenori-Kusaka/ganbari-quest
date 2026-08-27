import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/plan-limit-service.ts
// プラン別機能制限サービス (#0196, #0269, #0270)

import { countsTowardActivityQuota } from '$lib/domain/activity-source';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { FAMILY_MEMBER_LIMIT } from '$lib/domain/constants/family-member-limit';
import { PLAN_HISTORY_RETENTION_DAYS } from '$lib/domain/constants/plan-retention';
import type { PlanTier } from '$lib/domain/constants/plan-tier';
import { addDaysJST, prevDateJST, todayDateJST } from '$lib/domain/date-utils';
import { isFreeTextMessageUnlocked } from '$lib/domain/free-text-message-gate';
import { isTrialEndDateActiveJST } from '$lib/domain/trial-period';
// #4723: factory 経由だと provider 側と循環するため、実体の auth-mode から直接引く。
import { getAuthMode } from '$lib/server/auth/auth-mode';
import { getRepos } from '$lib/server/db/factory';
import { getDebugPlanTier } from '$lib/server/debug-plan';
import { buildPlanTierCacheKey, getRequestContext } from '$lib/server/request-context';
import type { TrialTier } from '$lib/server/services/trial-service';
import { getTrialStatus } from '$lib/server/services/trial-service';

export interface PlanLimits {
	maxChildren: number | null; // null = 無制限
	maxActivities: number | null;
	maxChecklistTemplates: number | null; // 1子あたりのチェックリストテンプレート数 (#723)
	maxFamilyMembers: number | null; // null = 無制限, 招待によるメンバー上限（owner含む） (#1111)
	historyRetentionDays: number | null;
	canExport: boolean;
	canFreeTextMessage: boolean; // 自由テキストメッセージ（PLAN_LABELS.family 限定）
	canCustomReward: boolean; // 特別なごほうび設定（スタンダード以上） #728
	canSiblingRanking: boolean; // きょうだいランキング（PLAN_LABELS.family 限定） #782
	maxCloudExports: number; // クラウド保管の同時保管数上限
}

// #3963: 型宣言の SSOT は domain leaf に移した (request-context との循環回避)。
// 既存の 50 箇所以上ある import 元を壊さないため、ここから再 export する。
export type { PlanTier };

/**
 * 上限チェックの結果 (#4622)。
 *
 * `max: null` は「無制限」を意味するので、**上限に達した状態 (`allowed: false`) と
 * 同時には成立しない**。旧実装は `{ allowed: boolean; max: number | null }` という
 * 単一 shape だったため、この不変条件を型が持たず、`if (!check.allowed)` の内側でも
 * `max` が `number | null` のままだった。結果、上限到達メッセージに
 * 「カスタム活動は最大 null 個まで作成できます」と出しうる型の穴が空いていた。
 *
 * discriminated union にすることで不正な状態を型で表現不能にし (ADR-0061)、
 * `!allowed` 側では `max` が `number` に narrowing される。
 * 上限メッセージのラベル関数 (`PLAN_GATE_LABELS.*LimitReached`) は `max: number` を
 * 要求するので、この不変条件を崩した瞬間に呼び出し側がコンパイルで落ちる。
 */
export type PlanLimitCheck =
	/** 未到達。`max: null` は無制限プラン (上限なし) を表す */
	| { allowed: true; current: number; max: number | null }
	/** 上限到達。到達しうるのは上限が具体値のプランだけなので `max` は必ず number */
	| { allowed: false; current: number; max: number };

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
	free: {
		maxChildren: 2,
		maxActivities: 3,
		// #723: Free は pricing で「チェックリスト（テンプレート）」と表記。
		// 現状 preset テンプレ機構がないため、maxActivities と同様に「少数で自由作成可」に寄せ、
		// 1子あたり 3 テンプレまでに制限（朝/昼/夜 の 3 枠想定）。
		maxChecklistTemplates: 3,
		// #1111: フリープランは招待不可（owner のみ）
		maxFamilyMembers: FAMILY_MEMBER_LIMIT.free,
		// 値の SSOT は domain/constants/plan-retention.ts (LP / 機能リストの表示も同じ定数から引く、#4477)
		historyRetentionDays: PLAN_HISTORY_RETENTION_DAYS.free,
		canExport: false,
		// #4504: 値は述語 SSOT から導出する (定義だけで参照ゼロのデッド設定だった)
		canFreeTextMessage: isFreeTextMessageUnlocked('free'),
		canCustomReward: false,
		canSiblingRanking: false,
		maxCloudExports: 0,
	},
	standard: {
		maxChildren: null,
		maxActivities: null,
		maxChecklistTemplates: null,
		// #1111: スタンダードは owner + 3人 = 計4人まで（核家族想定）
		// #4500: 数値の SSOT は domain leaf。LP / labels もここから引く
		maxFamilyMembers: FAMILY_MEMBER_LIMIT.standard,
		historyRetentionDays: PLAN_HISTORY_RETENTION_DAYS.standard,
		canExport: true,
		canFreeTextMessage: isFreeTextMessageUnlocked('standard'),
		canCustomReward: true,
		canSiblingRanking: false,
		maxCloudExports: 3,
	},
	family: {
		maxChildren: null,
		maxActivities: null,
		maxChecklistTemplates: null,
		// #1111: PLAN_LABELS.family は無制限
		maxFamilyMembers: FAMILY_MEMBER_LIMIT.family,
		historyRetentionDays: PLAN_HISTORY_RETENTION_DAYS.family,
		canExport: true,
		canFreeTextMessage: isFreeTextMessageUnlocked('family'),
		canCustomReward: true,
		canSiblingRanking: true,
		maxCloudExports: 10,
	},
};

/**
 * テナントのプランティアを判定する同期版（低レベル・internal 用途）。
 *
 * 呼び出し元は自前で trialEndDate / trialTier を取得する必要がある。
 * アプリケーションコード（routes/load, services）は基本的に
 * {@link resolveFullPlanTier} を使うこと。テストと同ファイル内の
 * ラッパからのみ呼び出すことを想定している。
 *
 * @internal
 * @see resolveFullPlanTier - 推奨される非同期ラッパ（trial 取得込み）
 */
export function resolvePlanTier(
	licenseStatus: string,
	planId?: string,
	trialEndDate?: string | null,
	trialTier?: TrialTier | null,
): PlanTier {
	// #758 / #2919: dev の DEBUG_PLAN は mode 強制 (local / anonymous = family) より優先する。
	// 従来は下の local 分岐が先に評価され、AUTH_MODE=local (npm run dev / E2E webServer) では
	// DEBUG_PLAN=free・standard が無視されていた (plan 別表示の dev 検証が不可能だった)。
	// dev=false (本番 build) では getDebugPlanTier が常に null を返すため挙動不変。
	const debugTier = getDebugPlanTier();
	if (debugTier) return debugTier;
	const mode = getAuthMode();
	// ローカル版（セルフホスト）は常に全機能解放
	if (mode === 'local') return 'family';
	// #2198: Multi-Lambda demo deployment (`AUTH_MODE=anonymous`) は LP 経由の評価者向け
	// stateless demo Lambda。AnonymousAuthProvider が licenseStatus=ACTIVE / 全画面 allow
	// を返す設計と整合させ、plan 制限を「unlimited demo」として family tier 相当で表示する。
	// これにより `/admin/children` 5 子供 fixture が「上限警告 + アップグレード CTA」を出さず、
	// LP SS carousel-4 で訴求が毀損しなくなる (ADR-0048 §決定 P-1.6 / P-1.7 / P-1.8 整合)。
	if (mode === 'anonymous') return 'family';
	// アクティブな有料プラン
	if (licenseStatus === AUTH_LICENSE_STATUS.ACTIVE) {
		return planId?.startsWith('family') ? 'family' : 'standard';
	}
	// トライアル期間中 → トライアルのティアを適用（デフォルト: standard）
	// #4707: 終了日は JST 暦日 ('YYYY-MM-DD') で end_date 当日いっぱい有効。旧実装の
	// `new Date(trialEndDate) > new Date()` は UTC 00:00 (= JST 09:00) で切れ、表示判定
	// (`computeTrialStatus`、JST 暦日比較) と 9 時間ずれて「残り 0 日」表示のまま有料機能が
	// 403 になっていた。同じ述語 `isTrialEndDateActiveJST` を共有して判定を一致させる。
	if (trialEndDate && isTrialEndDateActiveJST(trialEndDate)) {
		return trialTier ?? 'standard';
	}
	return 'free';
}

/**
 * テナントのプランティアを非同期で判定する（トライアル状態を自動チェック）。
 *
 * #732: 全ての server load / services の呼び出し口をこの関数に統一する。
 * 内部で `getTrialStatus` を 1 回だけ呼び出し、expired 判定を含めて解決する。
 *
 * #788: 同一リクエスト内の2回目以降は request-context のキャッシュから返す。
 * これにより `(child)/+layout.server.ts` + 各 `page.server.ts` + 内部サービスが
 * 独立に呼び出しても、実際に `trial_history` を叩くのは最初の1回だけになる。
 * `getTrialStatus` 側にもキャッシュがあるため二重防護だが、key にライセンス状態を
 * 含めるぶんプランティア単位でキャッシュできる利点がある。
 *
 * @param tenantId - テナントID
 * @param licenseStatus - `locals.context?.licenseStatus` （未設定なら 'none' 扱い）
 * @param planId - `locals.context?.plan`
 */
export async function resolveFullPlanTier(
	tenantId: string,
	licenseStatus: string,
	planId?: string,
): Promise<PlanTier> {
	// #788: リクエストスコープのキャッシュを優先
	const ctx = getRequestContext();
	const cacheKey = buildPlanTierCacheKey(tenantId, licenseStatus, planId);
	const cached = ctx?.planTierCache.get(cacheKey);
	if (cached) return cached;

	// getTrialStatus を 1 回だけ呼ぶ。過去実装は getTrialEndDate + getTrialTier を
	// 別々に呼び、それぞれ内部で getTrialStatus を実行していたため DB 2 回叩いていた。
	const status = await getTrialStatus(tenantId);
	const trialEnd = status.isTrialActive ? status.trialEndDate : null;
	const trialTierValue = status.isTrialActive ? status.trialTier : null;
	const tier = resolvePlanTier(licenseStatus, planId, trialEnd, trialTierValue);

	ctx?.planTierCache.set(cacheKey, tier);
	return tier;
}

/** 有料プランかどうか */
export function isPaidTier(tier: PlanTier): boolean {
	return tier === 'standard' || tier === 'family';
}

/** プラン別制限を取得 */
export function getPlanLimits(tier: PlanTier): PlanLimits {
	return PLAN_LIMITS[tier];
}

/**
 * 保持期間カットオフ日 (YYYY-MM-DD、JST 基準) を取得。null = 制限なし。
 *
 * #3593 ②: JST 深夜境界の TZ 整合。ローカル getter で日付を導出すると Lambda (UTC) 実行時に
 * JST とずれ、0:00〜9:00 JST に記録された明細が保持期間判定で 1 日早く削除/残置される
 * (retention 監査契約 #729 違反)。JST 当日を基点に `addDaysJST()` で days を減算する。
 * 返す cutoff は「JST 当日境界の date」であり、下流 (deletePointLedgerBeforeDate) は
 * これを JST 深夜 0:00 の instant として TZ-qualified に解釈する。
 */
export function getHistoryCutoffDate(tier: PlanTier): string | null {
	const limits = PLAN_LIMITS[tier];
	if (limits.historyRetentionDays === null) return null;
	return addDaysJST(todayDateJST(), -limits.historyRetentionDays);
}

/**
 * 履歴を絞る JST 暦日の範囲 (両端含む)。`applyRetentionFilter` の戻り値の形。
 *
 * 履歴取得 service (`getActivityLogs` / `getChildChallengeRecords` /
 * `getRedemptionRequestsForChild`) はこれを **必須引数** で受け取る。省略可能にすると
 * 渡し忘れが「全期間を返す」= 料金表が約束した保持期間の空洞化として**静かに**成立するため
 * (#4763 で実際に達成タブが、それ以前から交換タブがこの状態だった)。
 */
export interface RetentionRange {
	from?: string;
	to?: string;
}

/**
 * 保持期間で絞らないことを**明示**するための range。
 *
 * 履歴一覧ではない用途 (例: ショップの「このごほうびの最新申請状態」) で使う。
 * 空オブジェクト `{}` を直接書くと「渡し忘れ」と区別がつかないため、opt-out は必ず
 * 本定数を経由させる (`grep NO_RETENTION_FILTER` で全 opt-out を数えられる状態を保つ)。
 */
export const NO_RETENTION_FILTER: RetentionRange = Object.freeze({});

/**
 * 日付範囲オプションに保持期間フィルタを適用する
 * from が cutoff より前の場合、cutoff に上書き
 */
export function applyRetentionFilter(tier: PlanTier, options: RetentionRange = {}): RetentionRange {
	const cutoff = getHistoryCutoffDate(tier);
	if (cutoff === null) return options;
	const from = options.from && options.from > cutoff ? options.from : cutoff;
	return { ...options, from };
}

/**
 * 保持期間外のデータが存在するかチェック
 * (cutoff 日より前にデータがあれば true)
 */
export async function hasArchivedData(
	tenantId: string,
	childId: ChildId,
	tier: PlanTier,
): Promise<boolean> {
	const cutoff = getHistoryCutoffDate(tier);
	if (cutoff === null) return false;

	const repos = getRepos();
	// cutoff日より前の活動ログが存在するか
	const logs = await repos.activity.findTodayLogsWithCategory(childId, cutoff, tenantId);
	if (logs.length > 0) return true;

	// 1日前のデータも確認
	const prevStr = prevDateJST(cutoff);
	const oldLogs = await repos.activity.findTodayLogsWithCategory(childId, prevStr, tenantId);
	return oldLogs.length > 0;
}

/** 子供追加の制限チェック */
export async function checkChildLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<PlanLimitCheck> {
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus));
	if (limits.maxChildren === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	const current = children.length;

	return {
		allowed: current < limits.maxChildren,
		current,
		max: limits.maxChildren,
	};
}

/**
 * 活動追加の制限チェック (#2362 PR-3 / ADR-0055)
 *
 * Per-child instance 化に伴い、tenant 全体の custom 活動数を per-child loop で集計する。
 * 意味論は不変 (maxActivities=3 は tenant-wide 合計の上限)。プラン見直しは別 Issue #2457 で扱う。
 */
export async function checkActivityLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<PlanLimitCheck> {
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus));
	if (limits.maxActivities === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	let current = 0;
	for (const child of children) {
		const activities = await repos.childActivity.findActivitiesByChild(child.id, tenantId);
		// #3669: 集計述語は domain SSOT (producer と同一定義点) を参照
		current += activities.filter((a) => countsTowardActivityQuota(a.source)).length;
	}

	return {
		allowed: current < limits.maxActivities,
		current,
		max: limits.maxActivities,
	};
}

/**
 * チェックリストテンプレート追加の制限チェック (#723)
 *
 * Free は 1 子あたり `maxChecklistTemplates` までしか作れない。
 * Standard/Family は制限なし。
 *
 * @param childId - 対象となる子の ID
 */
export async function checkChecklistTemplateLimit(
	tenantId: string,
	licenseStatus: string,
	childId: ChildId,
): Promise<PlanLimitCheck> {
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus));
	if (limits.maxChecklistTemplates === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	// includeInactive=true: 非アクティブ含めてカウント（トグルで無効化しても上限は消費）
	const templates = await repos.checklist.findTemplatesByChild(childId, tenantId, true);
	const current = templates.length;

	return {
		allowed: current < limits.maxChecklistTemplates,
		current,
		max: limits.maxChecklistTemplates,
	};
}

/**
 * 家族メンバー（招待）の制限チェック (#1111)
 *
 * Free は 1（owner のみ、招待不可）。
 * Standard は 4（owner + 3人、核家族想定）。
 * Family は null（無制限）。
 *
 * #4723: 数え方は呼び出す場面で変わる。
 * - **招待の発行時** (`countPendingInvites: true`): 既存メンバー + 未受諾の招待。
 *   発行済みの招待は「枠の予約」として数える。数えないと、残り 1 枠に何通でも発行でき、
 *   最初に受諾した人以外は全員が受諾時に弾かれる（発行者には成功に見える）。
 * - **招待の受諾時** (既定): 既存メンバーのみ。受諾しようとしている招待自身を
 *   予約として二重に数えないため。
 *
 * #4723: `planId` (= `locals.context?.plan` / `tenants.plan`) は **本チェックでは必須**。
 * `maxFamilyMembers` は standard (4) と family (null = 無制限) で唯一値が割れる上限であり、
 * `resolveFullPlanTier` は planId が無いと有料契約を一律 standard に落とす。渡し忘れると
 * family 世帯が 4 人で頭打ちになる (他の check*Limit は standard / family とも null のため
 * 影響が出ず、この引数を持たない)。
 */
export async function checkFamilyMemberLimit(
	tenantId: string,
	licenseStatus: string,
	opts: { countPendingInvites?: boolean; planId?: string } = {},
): Promise<PlanLimitCheck> {
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus, opts.planId));
	if (limits.maxFamilyMembers === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	const members = await repos.auth.findTenantMembers(tenantId);
	let current = members.length;

	if (opts.countPendingInvites) {
		const invites = await repos.auth.findTenantInvites(tenantId);
		const now = Date.now();
		current += invites.filter(
			(i) => i.status === 'pending' && new Date(i.expiresAt).getTime() > now,
		).length;
	}

	return {
		allowed: current < limits.maxFamilyMembers,
		current,
		max: limits.maxFamilyMembers,
	};
}
