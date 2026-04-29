// src/lib/server/services/graduation-service.ts
// 卒業フロー (#1603 / ADR-0023 §3.8 / §5 I10)
//
// 解約フロー (#1596) で「卒業」が選ばれた時の専用 service。
// - 残ポイント還元提案ページ表示用の context 取得 (load helper)
// - 事例公開承諾の保存
// - ops dashboard 用の卒業統計取得
//
// Anti-engagement 原則 (ADR-0012):
//   - 卒業はポジティブだが、煽らない
//   - 「もう一度始める」CTA は出さない (引き止め禁止)
//   - 連続通知 / 自動再生 / サプライズ濫用しない

import { getRepos } from '$lib/server/db/factory';
import type {
	GraduationConsentRecord,
	GraduationStats,
} from '$lib/server/db/interfaces/graduation-consent-repo.interface';
import { logger } from '$lib/server/logger';

const NICKNAME_MAX_LENGTH = 30;
const MESSAGE_MAX_LENGTH = 500;

export interface RecordGraduationConsentInput {
	tenantId: string;
	nickname: string;
	consented: boolean;
	userPoints: number;
	usagePeriodDays: number;
	message?: string | null;
}

export type RecordGraduationConsentResult =
	| { ok: true; record: GraduationConsentRecord }
	| { ok: false; error: 'NICKNAME_REQUIRED' | 'NICKNAME_TOO_LONG' | 'MESSAGE_TOO_LONG' };

/**
 * 卒業セッションの完了 + 任意の事例公開承諾を保存する。
 *
 * - nickname: 必須（実名禁止 — 親が任意指定）。1〜30 文字。
 * - consented: true なら事例として公開可、false でも卒業者数 KPI には含む
 * - userPoints / usagePeriodDays: 集計用（load 時に計算済みの値を保存）
 * - message: 任意の卒業メッセージ（公開可、最大 500 文字）
 *
 * 注: cancellation-service.submitCancellationReason() とは独立。
 * 「卒業」選択時の解約理由保存はそちらで完了済みの前提。
 */
export async function recordGraduationConsent(
	input: RecordGraduationConsentInput,
): Promise<RecordGraduationConsentResult> {
	const nickname = input.nickname.trim();
	if (nickname.length === 0) {
		return { ok: false, error: 'NICKNAME_REQUIRED' };
	}
	if (nickname.length > NICKNAME_MAX_LENGTH) {
		return { ok: false, error: 'NICKNAME_TOO_LONG' };
	}

	const message = input.message?.trim() ?? null;
	if (message && message.length > MESSAGE_MAX_LENGTH) {
		return { ok: false, error: 'MESSAGE_TOO_LONG' };
	}

	const repos = getRepos();
	const record = await repos.graduationConsent.create({
		tenantId: input.tenantId,
		nickname,
		consented: input.consented,
		userPoints: Math.max(0, Math.floor(input.userPoints)),
		usagePeriodDays: Math.max(0, Math.floor(input.usagePeriodDays)),
		message: message && message.length > 0 ? message : null,
	});

	logger.info(
		`[GRADUATION] Consent recorded: tenant=${input.tenantId} consented=${input.consented} points=${record.userPoints} usageDays=${record.usagePeriodDays}`,
	);

	return { ok: true, record };
}

/**
 * 卒業統計を取得する (ops dashboard 用)。
 *
 * 直近 N 日（デフォルト 90）の:
 * - 卒業者数
 * - 事例公開承諾数
 * - 平均利用期間
 * - 卒業率 (= 卒業者数 / 全解約数)
 * - 公開可能な事例サンプル
 */
export async function getGraduationStats(days = 90): Promise<GraduationStats> {
	const repos = getRepos();

	const [graduation, cancellations] = await Promise.all([
		repos.graduationConsent.aggregateRecent(days),
		repos.cancellationReason.aggregateRecent(days),
	]);

	const totalCancellations = cancellations.total;
	const graduationRate =
		totalCancellations > 0
			? Math.round((graduation.totalGraduations / totalCancellations) * 1000) / 1000
			: 0;

	return {
		totalGraduations: graduation.totalGraduations,
		consentedCount: graduation.consentedCount,
		avgUsagePeriodDays: graduation.avgUsagePeriodDays,
		totalCancellations,
		graduationRate,
		publicSamples: graduation.publicSamples,
	};
}

/**
 * 利用日数を計算する (テナント作成日 → 卒業日)。
 * graduation page の load で使う。
 */
export function calculateUsagePeriodDays(tenantCreatedAt: string, now: Date = new Date()): number {
	const created = new Date(tenantCreatedAt);
	if (Number.isNaN(created.getTime())) return 0;
	const diffMs = now.getTime() - created.getTime();
	if (diffMs <= 0) return 0;
	return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

export const GRADUATION_NICKNAME_MAX_LENGTH = NICKNAME_MAX_LENGTH;
export const GRADUATION_MESSAGE_MAX_LENGTH = MESSAGE_MAX_LENGTH;
