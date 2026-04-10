// src/lib/server/services/trial-service.ts
// トライアル管理サービス (#314 リファクタ)
// trial_history テーブルベースに移行。settings の trial_* は後方互換用に読み取りのみ。

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

const DEFAULT_TRIAL_DAYS = 7;
const DEFAULT_TRIAL_TIER = 'standard' as const;

export type TrialSource = 'user_initiated' | 'campaign' | 'admin_grant';
export type TrialTier = 'standard' | 'family';

export interface TrialStatus {
	isTrialActive: boolean;
	trialUsed: boolean;
	trialStartDate: string | null;
	trialEndDate: string | null;
	trialTier: TrialTier | null;
	daysRemaining: number;
	source: TrialSource | null;
}

export interface StartTrialInput {
	tenantId: string;
	source: TrialSource;
	tier?: TrialTier;
	durationDays?: number;
	campaignId?: string;
}

/**
 * トライアル状態を取得（trial_history テーブルから最新レコードを参照）
 */
export async function getTrialStatus(tenantId: string): Promise<TrialStatus> {
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
		};
	}

	const now = new Date();
	const end = new Date(latest.endDate);
	const isActive = end > now;
	// 日付ベースで残日数を計算（時刻の端数による繰り上がりを防ぐ）
	const todayStr = formatDate(now);
	const todayDate = new Date(todayStr);
	const endDate = new Date(latest.endDate);
	const daysRemaining = isActive
		? Math.round((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
		: 0;

	return {
		isTrialActive: isActive,
		trialUsed: true,
		trialStartDate: latest.startDate,
		trialEndDate: latest.endDate,
		trialTier: latest.tier as TrialTier,
		daysRemaining,
		source: latest.source as TrialSource,
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

	const now = new Date();
	const end = new Date(now);
	end.setDate(end.getDate() + durationDays);

	const startStr = formatDate(now);
	const endStr = formatDate(end);

	await getRepos().trialHistory.insert({
		tenantId,
		startDate: startStr,
		endDate: endStr,
		tier,
		source,
		campaignId: campaignId ?? null,
	});

	logger.info('Trial started', { context: { tenantId, startStr, endStr, tier, source } });
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
	const status = await getTrialStatus(tenantId);
	return status.isTrialActive ? status.trialEndDate : null;
}

/**
 * アクティブなトライアルのティアを取得
 */
export async function getTrialTier(tenantId: string): Promise<TrialTier | null> {
	const status = await getTrialStatus(tenantId);
	return status.isTrialActive ? status.trialTier : null;
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
