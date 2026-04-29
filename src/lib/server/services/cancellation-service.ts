// src/lib/server/services/cancellation-service.ts
// 解約理由ヒアリング (#1596 / ADR-0023 §3.8 / I3)
//
// 全プラン (free / standard / family / lifetime) で解約フローに必須化された
// 3 分類 + 自由記述を保存する。Stripe 課金がある場合のみ Customer Portal への
// リダイレクトを行う前段で本サービスを呼び出す（理由を取りこぼさないため）。
//
// Anti-engagement 原則 (ADR-0012):
//   - 引き止め UI を出さない（離脱トリガー化を防ぐ）
//   - 自由記述は任意・1000 文字制限
//   - 「卒業」を選ばれた場合もポジティブに祝う（ガチャ的な煽り無し）

import {
	CANCELLATION_CATEGORIES,
	CANCELLATION_LABELS,
	type CancellationCategory,
} from '$lib/domain/labels';
import { getRepos } from '$lib/server/db/factory';
import type { CancellationReasonRecord } from '$lib/server/db/interfaces/cancellation-reason-repo.interface';
import { logger } from '$lib/server/logger';
import { notifyCancellationWithReason } from '$lib/server/services/discord-notify-service';

export interface SubmitCancellationReasonInput {
	tenantId: string;
	category: string;
	freeText?: string | null;
	planAtCancellation?: string | null;
	stripeSubscriptionId?: string | null;
}

export type SubmitCancellationReasonResult =
	| { ok: true; record: CancellationReasonRecord }
	| { ok: false; error: 'INVALID_CATEGORY' | 'FREE_TEXT_TOO_LONG' };

const FREE_TEXT_MAX_LENGTH = CANCELLATION_LABELS.freeTextMaxLength;

function isValidCategory(value: string): value is CancellationCategory {
	return (CANCELLATION_CATEGORIES as ReadonlyArray<string>).includes(value);
}

/**
 * 解約理由を保存する。
 *
 * - category は 3 分類のいずれか必須（任意化禁止: 偏ったデータになるため #1596）
 * - freeText は 0〜1000 文字（任意）
 * - 保存後に Discord churn channel へカテゴリ付き通知
 *
 * 注: Stripe subscription の解約自体は呼び出し側で別途実行する。
 * 本サービスは「理由保存 + Discord 通知」のみ担当する（責務の分離）。
 */
export async function submitCancellationReason(
	input: SubmitCancellationReasonInput,
): Promise<SubmitCancellationReasonResult> {
	if (!isValidCategory(input.category)) {
		return { ok: false, error: 'INVALID_CATEGORY' };
	}

	const freeText = input.freeText?.trim() ?? null;
	if (freeText && freeText.length > FREE_TEXT_MAX_LENGTH) {
		return { ok: false, error: 'FREE_TEXT_TOO_LONG' };
	}

	const repos = getRepos();
	const record = await repos.cancellationReason.create({
		tenantId: input.tenantId,
		category: input.category,
		freeText: freeText && freeText.length > 0 ? freeText : null,
		planAtCancellation: input.planAtCancellation ?? null,
		stripeSubscriptionId: input.stripeSubscriptionId ?? null,
	});

	logger.info(
		`[CANCELLATION] Reason recorded: tenant=${input.tenantId} category=${input.category} hasFreeText=${!!record.freeText}`,
	);

	// Discord 通知（失敗しても解約フロー自体は継続）
	notifyCancellationWithReason({
		tenantId: input.tenantId,
		category: input.category,
		freeText: record.freeText,
		plan: input.planAtCancellation ?? null,
	}).catch((err) => {
		logger.warn('[CANCELLATION] Discord notification failed', { error: String(err) });
	});

	return { ok: true, record };
}

/** ops dashboard 用の集計取得 */
export async function getCancellationReasonAggregation(days = 90): Promise<{
	total: number;
	breakdown: Array<{
		category: CancellationCategory;
		count: number;
		percentage: number;
	}>;
}> {
	const repos = getRepos();
	return repos.cancellationReason.aggregateRecent(days);
}

/** ops dashboard 用の自由記述検索 */
export async function searchCancellationFreeText(
	query: string,
	limit = 50,
): Promise<CancellationReasonRecord[]> {
	const repos = getRepos();
	return repos.cancellationReason.searchFreeText(query, limit);
}
