// src/lib/features/admin/downgrade-client.ts
// #4585-1: ダウングレード (無料プラン復帰) 時の「どれを残すか」選択 API のクライアント。
//
// 解約の入口は 2 つある (請求パネル / 解約フロー)。同じ選択 UI に合流させるにあたり、
// preview 取得と archive 実行を 1 箇所に集約する。入口ごとに fetch を書き写すと、
// 顧客のデータが消える経路の挙動が入口ごとにずれる (#4585 ② がまさにそれ)。

import type { DowngradePreview } from '$lib/domain/downgrade-types';
import type { ActivityId, ChildId } from '$lib/domain/ids';
import { SUBSCRIPTION_PAGE_LABELS } from '$lib/domain/labels';

export interface DowngradeSelection {
	childIds: ChildId[];
	activityIds: ActivityId[];
	checklistTemplateIds: string[];
}

export type DowngradeClientResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** ダウングレード先 (無料プラン) に対する超過リソースを取得する */
export async function fetchDowngradePreview(
	targetTier = 'free',
): Promise<DowngradeClientResult<DowngradePreview>> {
	try {
		const res = await fetch(`/api/v1/admin/downgrade-preview?targetTier=${targetTier}`);
		if (!res.ok) {
			return { ok: false, error: SUBSCRIPTION_PAGE_LABELS.downgradeInfoError };
		}
		return { ok: true, value: (await res.json()) as DowngradePreview };
	} catch {
		return { ok: false, error: SUBSCRIPTION_PAGE_LABELS.downgradeInfoError };
	}
}

/** 顧客が選んだリソースをアーカイブする (アーカイブは削除ではなく、再契約で復元できる) */
export async function archiveDowngradeSelection(
	selection: DowngradeSelection,
	targetTier = 'free',
): Promise<DowngradeClientResult<true>> {
	try {
		const res = await fetch('/api/v1/admin/downgrade-archive', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetTier, ...selection }),
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			return {
				ok: false,
				error:
					(body as { message?: string }).message ?? SUBSCRIPTION_PAGE_LABELS.downgradeArchiveError,
			};
		}
		return { ok: true, value: true };
	} catch {
		return { ok: false, error: SUBSCRIPTION_PAGE_LABELS.downgradeArchiveError };
	}
}
