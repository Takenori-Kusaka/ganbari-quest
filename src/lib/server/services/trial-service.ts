// src/lib/server/services/trial-service.ts
// リバーストライアル管理サービス (#0270)

import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

const TRIAL_DURATION_DAYS = 7;

export interface TrialStatus {
	isTrialActive: boolean;
	trialUsed: boolean;
	trialStartDate: string | null;
	trialEndDate: string | null;
	daysRemaining: number;
}

/**
 * トライアル状態を取得
 */
export async function getTrialStatus(tenantId: string): Promise<TrialStatus> {
	const settings = await getSettings(
		['trial_start_date', 'trial_end_date', 'trial_used'],
		tenantId,
	);

	const trialStartDate = settings.trial_start_date ?? null;
	const trialEndDate = settings.trial_end_date ?? null;
	const trialUsed = settings.trial_used === '1';

	if (!trialEndDate) {
		return {
			isTrialActive: false,
			trialUsed,
			trialStartDate,
			trialEndDate,
			daysRemaining: 0,
		};
	}

	const now = new Date();
	const end = new Date(trialEndDate);
	const isTrialActive = end > now;
	const daysRemaining = isTrialActive
		? Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
		: 0;

	return {
		isTrialActive,
		trialUsed,
		trialStartDate,
		trialEndDate,
		daysRemaining,
	};
}

/**
 * トライアルを開始（サインアップ時に呼ばれる）
 * trialUsed=true のテナントには開始しない
 */
export async function startTrial(tenantId: string): Promise<boolean> {
	const status = await getTrialStatus(tenantId);

	if (status.trialUsed) {
		logger.info('Trial already used, skipping', { context: { tenantId } });
		return false;
	}

	if (status.isTrialActive) {
		logger.info('Trial already active, skipping', { context: { tenantId } });
		return false;
	}

	const now = new Date();
	const end = new Date(now);
	end.setDate(end.getDate() + TRIAL_DURATION_DAYS);

	const startStr = formatDate(now);
	const endStr = formatDate(end);

	await setSetting('trial_start_date', startStr, tenantId);
	await setSetting('trial_end_date', endStr, tenantId);
	await setSetting('trial_used', '1', tenantId);

	logger.info('Trial started', { context: { tenantId, startStr, endStr } });
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
	const settings = await getSettings(['trial_end_date'], tenantId);
	const endDate = settings.trial_end_date ?? null;
	if (!endDate) return null;
	if (new Date(endDate) <= new Date()) return null;
	return endDate;
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
