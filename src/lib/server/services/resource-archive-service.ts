// src/lib/server/services/resource-archive-service.ts
// #783: トライアル終了時の超過リソース archive / アップグレード時の restore

import {
	archiveActivities,
	findActivities,
	restoreArchivedActivities,
} from '$lib/server/db/activity-repo';
import {
	archiveChecklistTemplates,
	findTemplatesByChild,
	restoreArchivedChecklistTemplates,
} from '$lib/server/db/checklist-repo';
import {
	archiveChildren,
	findAllChildren,
	findArchivedChildren,
	restoreArchivedChildren,
} from '$lib/server/db/child-repo';
import { getPlanLimits, type PlanTier } from './plan-limit-service';

const ARCHIVE_REASON = 'trial_expired';

/**
 * トライアル終了時に free プランの上限を超えるリソースを archive する。
 *
 * - 子供: 古い順に maxChildren 件を残し、残りを archive
 * - 活動: source='custom' のうち古い順に maxActivities 件を残し、残りを archive
 * - チェックリスト: 各子供について maxChecklistTemplates 件を残し、残りを archive
 *
 * 「古い順に残す」= 最初に作成したリソースを優先保持する
 */
export async function archiveExcessResources(tenantId: string): Promise<{
	archivedChildIds: number[];
	archivedActivityIds: number[];
	archivedChecklistTemplateIds: number[];
}> {
	const limits = getPlanLimits('free');
	const result = {
		archivedChildIds: [] as number[],
		archivedActivityIds: [] as number[],
		archivedChecklistTemplateIds: [] as number[],
	};

	// --- Children ---
	if (limits.maxChildren !== null) {
		const children = await findAllChildren(tenantId);
		if (children.length > limits.maxChildren) {
			// id 昇順 = 古い順にソートし、上限以降を archive
			const sorted = [...children].sort((a, b) => a.id - b.id);
			const excess = sorted.slice(limits.maxChildren);
			const ids = excess.map((c) => c.id);
			await archiveChildren(ids, ARCHIVE_REASON, tenantId);
			result.archivedChildIds = ids;
		}
	}

	// --- Activities ---
	if (limits.maxActivities !== null) {
		const activities = await findActivities(tenantId);
		const custom = activities.filter((a) => a.source === 'custom');
		if (custom.length > limits.maxActivities) {
			const sorted = [...custom].sort((a, b) => a.id - b.id);
			const excess = sorted.slice(limits.maxActivities);
			const ids = excess.map((a) => a.id);
			await archiveActivities(ids, ARCHIVE_REASON, tenantId);
			result.archivedActivityIds = ids;
		}
	}

	// --- Checklist Templates (per child) ---
	if (limits.maxChecklistTemplates !== null) {
		// 非アーカイブの全子供のテンプレートを確認
		const children = await findAllChildren(tenantId);
		// アーカイブされた子供のテンプレートは無視
		for (const child of children) {
			const templates = await findTemplatesByChild(child.id, tenantId, true);
			if (templates.length > limits.maxChecklistTemplates) {
				const sorted = [...templates].sort((a, b) => a.id - b.id);
				const excess = sorted.slice(limits.maxChecklistTemplates);
				const ids = excess.map((t) => t.id);
				await archiveChecklistTemplates(ids, ARCHIVE_REASON, tenantId);
				result.archivedChecklistTemplateIds.push(...ids);
			}
		}
	}

	return result;
}

/**
 * アップグレード時に trial_expired で archive されたリソースを全て復元する。
 */
export async function restoreArchivedResources(tenantId: string): Promise<void> {
	await restoreArchivedChildren(ARCHIVE_REASON, tenantId);
	await restoreArchivedActivities(ARCHIVE_REASON, tenantId);
	await restoreArchivedChecklistTemplates(ARCHIVE_REASON, tenantId);
}

/**
 * archive 済みリソースの概要を返す（UI 表示用）。
 */
export async function getArchivedResourceSummary(tenantId: string): Promise<{
	archivedChildCount: number;
	hasArchivedResources: boolean;
}> {
	const archivedChildren = await findArchivedChildren(tenantId);
	const count = archivedChildren.length;
	return {
		archivedChildCount: count,
		hasArchivedResources: count > 0,
	};
}

export { ARCHIVE_REASON };
