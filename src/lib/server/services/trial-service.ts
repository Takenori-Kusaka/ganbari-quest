// src/lib/server/services/trial-service.ts
// トライアル管理サービス (#314 リファクタ)
// trial_history テーブルベースに移行。settings の trial_* は後方互換用に読み取りのみ。

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { addDaysJST, toJSTDateString } from '$lib/domain/date-utils';
import { isTrialEndDateActiveJST, trialDaysRemainingJST } from '$lib/domain/trial-period';
import { getRepos } from '$lib/server/db/factory';
import { getDebugTrialOverride } from '$lib/server/debug-plan';
import { logger } from '$lib/server/logger';
import { getRequestContext, invalidateRequestCaches } from '$lib/server/request-context';

const DEFAULT_TRIAL_DAYS = 7;
const DEFAULT_TRIAL_TIER = 'standard' as const;

export type TrialSource = 'user_initiated' | 'campaign' | 'admin_grant';
export type TrialTier = 'standard' | 'family';

/**
 * トライアル状態。
 *
 * #4628: 「トライアル中なら期間・ティアは必ず具体値」という実装上の不変条件を型が持つ。
 * 旧実装は `isTrialActive: boolean` + `trialEndDate: string | null` の直積で、
 * `isTrialActive:true` かつ `trialEndDate:null` という不正な組み合わせが型として構成でき、
 * 画面に日付の無い「 まで」を出しうる状態だった (#4622 の `max: null` と同一 class)。
 */
export type TrialStatus =
	| {
			isTrialActive: true;
			trialUsed: boolean;
			trialStartDate: string;
			trialEndDate: string;
			trialTier: TrialTier;
			daysRemaining: number;
			source: TrialSource;
			/** #4707: 本契約へ移行済みのトライアルは active になり得ない */
			convertedToPaid: false;
	  }
	| {
			isTrialActive: false;
			trialUsed: boolean;
			trialStartDate: string | null;
			trialEndDate: string | null;
			trialTier: TrialTier | null;
			daysRemaining: number;
			source: TrialSource | null;
			/**
			 * #4707: トライアル中 (または終了後) に本契約へ移行済み (trial_history.stripe_subscription_id あり)。
			 * 移行済みのトライアルは end_date に関わらず「終了」扱い — 払った直後に
			 * 「トライアル中 / 本契約が必要です」と出さないため。
			 */
			convertedToPaid: boolean;
	  };

/**
 * client (page data) に配る表示用の部分集合。
 *
 * #4628: route で `{ isTrialActive: s.isTrialActive, trialEndDate: s.trialEndDate }` と
 * **手で組み直すと相関が消える** (推論は `{ isTrialActive: boolean; trialEndDate: string | null }`)。
 * 射影をこの 1 関数に集約し、UI 側でも `isTrialActive` で narrowing が効く状態を保つ。
 */
export type TrialStatusView =
	| {
			isTrialActive: true;
			trialUsed: boolean;
			daysRemaining: number;
			trialEndDate: string;
			trialTier: TrialTier;
	  }
	| {
			isTrialActive: false;
			trialUsed: boolean;
			daysRemaining: number;
			trialEndDate: string | null;
			trialTier: TrialTier | null;
	  };

/** `TrialStatus` を相関を保ったまま client 配布用に射影する (#4628)。 */
export function toTrialStatusView(status: TrialStatus): TrialStatusView {
	if (status.isTrialActive) {
		return {
			isTrialActive: true,
			trialUsed: status.trialUsed,
			daysRemaining: status.daysRemaining,
			trialEndDate: status.trialEndDate,
			trialTier: status.trialTier,
		};
	}
	return {
		isTrialActive: false,
		trialUsed: status.trialUsed,
		daysRemaining: status.daysRemaining,
		trialEndDate: status.trialEndDate,
		trialTier: status.trialTier,
	};
}

export type UpgradeReason = 'auto' | 'manual' | 'email_cta';

export interface EndTrialOnConversionInput {
	tenantId: string;
	stripeSubscriptionId: string;
	upgradeReason: UpgradeReason;
}

export interface StartTrialInput {
	tenantId: string;
	source: TrialSource;
	tier?: TrialTier;
	durationDays?: number;
	campaignId?: string;
	trialStartSource?: string;
}

/**
 * トライアル状態を取得（trial_history テーブルから最新レコードを参照）
 *
 * #788: 同一リクエスト内の2回目以降は request-context のキャッシュから返す。
 * layout + 各 page.server + 内部サービスがそれぞれ独立に呼んでも DB は1回で済む。
 * トライアル開始/終了など状態が変わる操作の直後は `invalidateRequestCaches` が
 * キャッシュを破棄するため、リクエスト内で stale な値を返すことはない。
 */
export async function getTrialStatus(
	tenantId: string,
	licenseStatus?: string | null,
): Promise<TrialStatus> {
	// #788: リクエストスコープのキャッシュを優先
	const ctx = getRequestContext();
	const cached = ctx?.trialStatusCache.get(tenantId);
	if (cached) return applyLicenseToTrialStatus(cached, licenseStatus);

	const status = await computeTrialStatus(tenantId);
	ctx?.trialStatusCache.set(tenantId, status);
	return applyLicenseToTrialStatus(status, licenseStatus);
}

/**
 * #4707: licenseStatus=ACTIVE (有料契約中) のテナントはトライアル「中」ではない。
 *
 * トライアル行の終了 (`endTrialOnConversion`) と独立した第 2 防御。webhook 未達 / 旧データで
 * trial_history が閉じていなくても、契約が生きていれば UI (ヘッダー pill / PlanStatusCard) と
 * 終了予告メールの両方でトライアル表示・通知を出さない。`trialUsed` は保持する
 * (再開不可判定に使う)。licenseStatus 未指定 (null / undefined) なら素の状態を返す。
 */
export function applyLicenseToTrialStatus(
	status: TrialStatus,
	licenseStatus?: string | null,
): TrialStatus {
	if (licenseStatus !== AUTH_LICENSE_STATUS.ACTIVE) return status;
	if (!status.isTrialActive) return status;
	return { ...status, isTrialActive: false, daysRemaining: 0 };
}

/**
 * #788: 実際の DB 参照を担うヘルパ。キャッシュなしで常に DB を叩く。
 * `getTrialStatus` 経由で呼ばれるため、通常は直接呼び出さない。
 */
async function computeTrialStatus(tenantId: string): Promise<TrialStatus> {
	// dev: DEBUG_TRIAL env があればDB参照をスキップして擬似ステータスを返す (#758)
	const debugOverride = getDebugTrialOverride();
	if (debugOverride) {
		if (debugOverride.endDate) {
			const todayStr = toJSTDateString(new Date());
			const todayDate = new Date(`${todayStr}T00:00:00Z`);
			const endDate = new Date(`${debugOverride.endDate}T00:00:00Z`);
			const daysRemaining = Math.round(
				(endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
			);
			return {
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: todayStr,
				trialEndDate: debugOverride.endDate,
				trialTier: debugOverride.tier,
				daysRemaining,
				source: 'admin_grant',
				convertedToPaid: false,
			};
		}
		// #783: expired は trialUsed=true、not-started は trialUsed=false
		return {
			isTrialActive: false,
			trialUsed: debugOverride.trialUsed,
			trialStartDate: null,
			trialEndDate: null,
			trialTier: null,
			daysRemaining: 0,
			source: null,
			convertedToPaid: false,
		};
	}

	const latest = await getRepos().trialHistory.findLatestByTenant(tenantId);

	if (!latest) {
		return {
			isTrialActive: false,
			trialUsed: false,
			trialStartDate: null,
			trialEndDate: null,
			trialTier: null,
			daysRemaining: 0,
			source: null,
			convertedToPaid: false,
		};
	}

	// #4707: 本契約へ移行済み (stripe_subscription_id あり) のトライアルは end_date に関わらず終了。
	// 有効期間は JST 暦日で end_date 当日いっぱい (tier 判定 resolvePlanTier と同じ述語)。
	const convertedToPaid = latest.stripeSubscriptionId != null;
	const isActive = !convertedToPaid && isTrialEndDateActiveJST(latest.endDate);

	// #4628: active / inactive で戻り値の型が変わる (active は期間・ティアが必ず具体値)。
	if (isActive) {
		return {
			isTrialActive: true,
			trialUsed: true,
			trialStartDate: latest.startDate,
			trialEndDate: latest.endDate,
			trialTier: latest.tier as TrialTier,
			daysRemaining: trialDaysRemainingJST(latest.endDate),
			source: latest.source as TrialSource,
			convertedToPaid: false,
		};
	}

	return {
		isTrialActive: false,
		trialUsed: true,
		trialStartDate: latest.startDate,
		trialEndDate: latest.endDate,
		trialTier: latest.tier as TrialTier,
		daysRemaining: 0,
		source: latest.source as TrialSource,
		convertedToPaid,
	};
}

/**
 * トライアルを開始（ユーザー明示操作 or キャンペーン or 管理者付与）
 * source='user_initiated' の場合、過去にトライアル使用済みなら拒否
 * source='campaign' or 'admin_grant' の場合、再付与を許可
 */
export async function startTrial(input: StartTrialInput): Promise<boolean> {
	const {
		tenantId,
		source,
		tier = DEFAULT_TRIAL_TIER,
		durationDays = DEFAULT_TRIAL_DAYS,
		campaignId,
		trialStartSource,
	} = input;
	const status = await getTrialStatus(tenantId);

	// ユーザー自発開始: 1回限り
	if (source === 'user_initiated' && status.trialUsed) {
		logger.info('Trial already used, user_initiated request rejected', { context: { tenantId } });
		return false;
	}

	// 現在アクティブなトライアルがあれば重複開始しない
	if (status.isTrialActive) {
		logger.info('Trial already active, skipping', { context: { tenantId } });
		return false;
	}

	// トライアル開始日 / 終了日は顧客可視かつプラン判定に直結する暦日。JST SSOT 経由で決める (#4015)。
	// 旧実装はローカル TZ getter の独自 formatDate() で、Lambda (UTC) では JST 00:00〜09:00 に
	// 開始したトライアルの開始日 / 終了日が 1 日前倒しになっていた
	// (読み出し側 getTrialStatus は toJSTDateString() で JST 判定しており基準が不一致)。
	const startStr = toJSTDateString(new Date());
	const endStr = addDaysJST(startStr, durationDays);

	await getRepos().trialHistory.insert({
		tenantId,
		startDate: startStr,
		endDate: endStr,
		tier,
		source,
		campaignId: campaignId ?? null,
		trialStartSource: trialStartSource ?? null,
	});

	// #788: 同一リクエスト内で startTrial 後に getTrialStatus / resolveFullPlanTier が
	// 呼ばれた時に stale な値を返さないよう、キャッシュを破棄する。
	invalidateRequestCaches(tenantId);

	logger.info('Trial started', { context: { tenantId, startStr, endStr, tier, source } });
	return true;
}

/**
 * #4707: 有料契約 (Stripe subscription) が確定したとき、当該テナントのトライアルを本契約へ移行済みとして閉じる。
 *
 * - 最新トライアル行に `stripe_subscription_id` / `upgrade_reason` を記録する (移行済みの印)
 * - トライアルがまだ有効 (JST 暦日で end_date ≥ 今日) なら `end_date` を今日に詰める
 *   (終了済みなら end_date は触らない — 過去の終了日を今日に延ばさない)
 * - 既に同じ subscription で移行済み / トライアル履歴なし → 何もしない (冪等)
 *
 * 呼び手: `stripe-service` W1 (`checkout.session.completed` / reconcile) と W2 (`invoice.paid`)。
 * 表示 / 通知側は `applyLicenseToTrialStatus` が第 2 防御として同じ結論を出す。
 *
 * @returns 書き込みを行ったら true
 */
export async function endTrialOnConversion(input: EndTrialOnConversionInput): Promise<boolean> {
	const { tenantId, stripeSubscriptionId, upgradeReason } = input;
	const repo = getRepos().trialHistory;
	const latest = await repo.findLatestByTenant(tenantId);
	if (!latest) return false;
	if (latest.stripeSubscriptionId === stripeSubscriptionId) return false;

	const todayStr = toJSTDateString(new Date());
	const stillActive = isTrialEndDateActiveJST(latest.endDate);
	await repo.updateConversion({
		id: latest.id,
		tenantId,
		stripeSubscriptionId,
		upgradeReason,
		...(stillActive ? { endDate: todayStr } : {}),
	});
	invalidateRequestCaches(tenantId);

	logger.info('Trial closed on paid conversion', {
		context: {
			tenantId,
			trialId: latest.id,
			stripeSubscriptionId,
			upgradeReason,
			endDate: stillActive ? todayStr : latest.endDate,
			wasActive: stillActive,
		},
	});
	return true;
}

/**
 * トライアルが有効かどうかを判定（プラン解決用）
 */
export async function isTrialActive(tenantId: string): Promise<boolean> {
	const status = await getTrialStatus(tenantId);
	return status.isTrialActive;
}

/**
 * トライアル終了日を取得（null = トライアルなし or 終了済み）
 */
export async function getTrialEndDate(tenantId: string): Promise<string | null> {
	// dev: DEBUG_TRIAL env があれば上書き (#758)
	const debugOverride = getDebugTrialOverride();
	if (debugOverride) return debugOverride.endDate;

	const status = await getTrialStatus(tenantId);
	return status.isTrialActive ? status.trialEndDate : null;
}

/**
 * アクティブなトライアルのティアを取得
 */
export async function getTrialTier(tenantId: string): Promise<TrialTier | null> {
	// dev: DEBUG_TRIAL env があれば上書き (#758)
	const debugOverride = getDebugTrialOverride();
	if (debugOverride) return debugOverride.tier;

	const status = await getTrialStatus(tenantId);
	return status.isTrialActive ? status.trialTier : null;
}
