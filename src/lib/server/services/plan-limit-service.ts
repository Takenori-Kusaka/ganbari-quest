// src/lib/server/services/plan-limit-service.ts
// プラン別機能制限サービス (#0196, #0269, #0270)

import { getAuthMode } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { buildPlanTierCacheKey, getRequestContext } from '$lib/server/request-context';
import type { TrialTier } from '$lib/server/services/trial-service';
import { getTrialStatus } from '$lib/server/services/trial-service';

export interface PlanLimits {
	maxChildren: number | null; // null = 無制限
	maxActivities: number | null;
	maxChecklistTemplates: number | null; // 1子あたりのチェックリストテンプレート数 (#723)
	historyRetentionDays: number | null;
	canExport: boolean;
	canCustomAvatar: boolean;
	canFreeTextMessage: boolean; // 自由テキストメッセージ（ファミリープラン限定）
	canCustomReward: boolean; // 特別なごほうび設定（スタンダード以上） #728
	canSiblingRanking: boolean; // きょうだいランキング（ファミリープラン限定） #782
	maxCloudExports: number; // クラウド保管の同時保管数上限
}

export type PlanTier = 'free' | 'standard' | 'family';

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
	free: {
		maxChildren: 2,
		maxActivities: 3,
		// #723: Free は pricing で「チェックリスト（テンプレート）」と表記。
		// 現状 preset テンプレ機構がないため、maxActivities と同様に「少数で自由作成可」に寄せ、
		// 1子あたり 3 テンプレまでに制限（朝/昼/夜 の 3 枠想定）。
		maxChecklistTemplates: 3,
		historyRetentionDays: 90,
		canExport: false,
		canCustomAvatar: false,
		canFreeTextMessage: false,
		canCustomReward: false,
		canSiblingRanking: false,
		maxCloudExports: 0,
	},
	standard: {
		maxChildren: null,
		maxActivities: null,
		maxChecklistTemplates: null,
		historyRetentionDays: 365,
		canExport: true,
		canCustomAvatar: true,
		canFreeTextMessage: false,
		canCustomReward: true,
		canSiblingRanking: false,
		maxCloudExports: 3,
	},
	family: {
		maxChildren: null,
		maxActivities: null,
		maxChecklistTemplates: null,
		historyRetentionDays: null,
		canExport: true,
		canCustomAvatar: true,
		canFreeTextMessage: true,
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
	// ローカル版（セルフホスト）は常に全機能解放
	if (getAuthMode() === 'local') return 'family';
	// アクティブな有料プラン
	if (licenseStatus === 'active') {
		return planId?.startsWith('family') ? 'family' : 'standard';
	}
	// トライアル期間中 → トライアルのティアを適用（デフォルト: standard）
	if (trialEndDate && new Date(trialEndDate) > new Date()) {
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

/** 保持期間カットオフ日を取得。null = 制限なし */
export function getHistoryCutoffDate(tier: PlanTier): string | null {
	const limits = PLAN_LIMITS[tier];
	if (limits.historyRetentionDays === null) return null;
	const d = new Date();
	d.setDate(d.getDate() - limits.historyRetentionDays);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * 日付範囲オプションに保持期間フィルタを適用する
 * from が cutoff より前の場合、cutoff に上書き
 */
export function applyRetentionFilter(
	tier: PlanTier,
	options: { from?: string; to?: string } = {},
): { from?: string; to?: string } {
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
	childId: number,
	tier: PlanTier,
): Promise<boolean> {
	const cutoff = getHistoryCutoffDate(tier);
	if (cutoff === null) return false;

	const repos = getRepos();
	// cutoff日より前の活動ログが存在するか
	const logs = await repos.activity.findTodayLogsWithCategory(childId, cutoff, tenantId);
	if (logs.length > 0) return true;

	// 1日前のデータも確認
	const prevDay = new Date(cutoff);
	prevDay.setDate(prevDay.getDate() - 1);
	const prevStr = `${prevDay.getFullYear()}-${String(prevDay.getMonth() + 1).padStart(2, '0')}-${String(prevDay.getDate()).padStart(2, '0')}`;
	const oldLogs = await repos.activity.findTodayLogsWithCategory(childId, prevStr, tenantId);
	return oldLogs.length > 0;
}

/** 子供追加の制限チェック */
export async function checkChildLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<{ allowed: boolean; current: number; max: number | null }> {
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

/** 活動マスタ追加の制限チェック */
export async function checkActivityLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<{ allowed: boolean; current: number; max: number | null }> {
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus));
	if (limits.maxActivities === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	const activities = await repos.activity.findActivities(tenantId);
	const customActivities = activities.filter((a) => a.source === 'custom');
	const current = customActivities.length;

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
	childId: number,
): Promise<{ allowed: boolean; current: number; max: number | null }> {
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
