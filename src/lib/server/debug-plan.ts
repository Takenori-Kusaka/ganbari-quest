// src/lib/server/debug-plan.ts
// 開発モード専用 — プラン / トライアル状態を環境変数で上書きするデバッグ機構 (#758)
//
// ローカル開発・Playwright E2E で「free / standard / family」「trial 各状態」を
// 切り替えて動作確認するために使う。`dev === true` かつ env が設定されている
// 場合にのみ有効。本番 (`dev === false`) では常に無効。

import { dev } from '$app/environment';
import { toJSTDateString } from '$lib/domain/date-utils';
import type { AuthContext } from '$lib/server/auth/types';
import type { TrialTier } from '$lib/server/services/trial-service';

/** 許容される DEBUG_PLAN 値 */
export type DebugPlan = 'free' | 'standard' | 'family';

/** 許容される DEBUG_TRIAL 値 */
export type DebugTrial = 'active' | 'expired' | 'not-started';

export interface DebugPlanOverride {
	licenseStatus: AuthContext['licenseStatus'];
	plan?: string;
}

export interface DebugTrialOverride {
	endDate: string | null;
	tier: TrialTier | null;
}

const VALID_PLANS: ReadonlySet<string> = new Set(['free', 'standard', 'family']);
const VALID_TRIALS: ReadonlySet<string> = new Set(['active', 'expired', 'not-started']);
const VALID_TRIAL_TIERS: ReadonlySet<string> = new Set(['standard', 'family']);

/**
 * DEBUG_PLAN env に基づくプラン上書きを返す。
 * dev モードでない、または env 未設定の場合は null。
 */
export function getDebugPlanOverride(): DebugPlanOverride | null {
	if (!dev) return null;
	const raw = process.env.DEBUG_PLAN?.trim().toLowerCase();
	if (!raw) return null;
	if (!VALID_PLANS.has(raw)) {
		console.warn(
			`[debug-plan] DEBUG_PLAN="${raw}" is invalid. Expected one of: free, standard, family`,
		);
		return null;
	}
	switch (raw as DebugPlan) {
		case 'free':
			return { licenseStatus: 'none', plan: undefined };
		case 'standard':
			return { licenseStatus: 'active', plan: 'monthly' };
		case 'family':
			return { licenseStatus: 'active', plan: 'family-monthly' };
	}
}

/**
 * DEBUG_TRIAL env に基づくトライアル上書きを返す。
 * dev モードでない、または env 未設定の場合は null。
 */
export function getDebugTrialOverride(): DebugTrialOverride | null {
	if (!dev) return null;
	const rawTrial = process.env.DEBUG_TRIAL?.trim().toLowerCase();
	if (!rawTrial) return null;
	if (!VALID_TRIALS.has(rawTrial)) {
		console.warn(
			`[debug-plan] DEBUG_TRIAL="${rawTrial}" is invalid. Expected one of: active, expired, not-started`,
		);
		return null;
	}

	const rawTier = process.env.DEBUG_TRIAL_TIER?.trim().toLowerCase();
	let tier: TrialTier = 'standard';
	if (rawTier) {
		if (!VALID_TRIAL_TIERS.has(rawTier)) {
			console.warn(
				`[debug-plan] DEBUG_TRIAL_TIER="${rawTier}" is invalid. Expected one of: standard, family`,
			);
		} else {
			tier = rawTier as TrialTier;
		}
	}

	switch (rawTrial as DebugTrial) {
		case 'active': {
			// 7 日後を終了日とする（JST固定）
			const d = new Date();
			d.setDate(d.getDate() + 7);
			return { endDate: toJSTDateString(d), tier };
		}
		case 'expired':
		case 'not-started':
			return { endDate: null, tier: null };
	}
}

/**
 * デバッグ上書きが有効かどうか（インジケータ表示用）
 */
export function isDebugPlanActive(): boolean {
	return getDebugPlanOverride() !== null || getDebugTrialOverride() !== null;
}

/**
 * 現在のデバッグ状態を短い表示文字列として返す
 * 例: "plan=family", "trial=active(family)", "plan=standard trial=expired"
 */
export function getDebugPlanSummary(): string | null {
	if (!dev) return null;
	const parts: string[] = [];
	const rawPlan = process.env.DEBUG_PLAN?.trim().toLowerCase();
	if (rawPlan && VALID_PLANS.has(rawPlan)) {
		parts.push(`plan=${rawPlan}`);
	}
	const rawTrial = process.env.DEBUG_TRIAL?.trim().toLowerCase();
	if (rawTrial && VALID_TRIALS.has(rawTrial)) {
		// tier はアクティブ時のみ表示（expired/not-started では tier 無関係）
		const rawTier = process.env.DEBUG_TRIAL_TIER?.trim().toLowerCase();
		const tierStr =
			rawTrial === 'active' && rawTier && VALID_TRIAL_TIERS.has(rawTier) ? `(${rawTier})` : '';
		parts.push(`trial=${rawTrial}${tierStr}`);
	}
	return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * AuthContext に DEBUG_PLAN 上書きを適用した新しい context を返す。
 * 上書きが無い場合は元の context をそのまま返す。
 */
export function applyDebugPlanOverride(context: AuthContext | null): AuthContext | null {
	if (!context) return context;
	const override = getDebugPlanOverride();
	if (!override) return context;
	return {
		...context,
		licenseStatus: override.licenseStatus,
		plan: override.plan,
	};
}
