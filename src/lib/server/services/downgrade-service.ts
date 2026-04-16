// src/lib/server/services/downgrade-service.ts
// #738: ダウングレード前の超過リソースプレビュー・選択アーカイブ

import type {
	ActivityPreview,
	ChecklistTemplatePreview,
	ChildPreview,
	DowngradePreview,
} from '$lib/domain/downgrade-types';
import { archiveActivities, findActivities } from '$lib/server/db/activity-repo';
import { archiveChecklistTemplates, findTemplatesByChild } from '$lib/server/db/checklist-repo';
import { archiveChildren, findAllChildren } from '$lib/server/db/child-repo';
import type { PlanTier } from './plan-limit-service';
import { getPlanLimits } from './plan-limit-service';

export type { DowngradePreview };

const ARCHIVE_REASON = 'downgrade_user_selected';

export interface ArchiveSelection {
	childIds: number[];
	activityIds: number[];
	checklistTemplateIds: number[];
}

/**
 * ダウングレード先のプランに対して超過するリソースをプレビューする。
 *
 * ユーザーがどのリソースを残すか選択する前に呼び出す。
 */
export async function getDowngradePreview(
	tenantId: string,
	currentTier: PlanTier,
	targetTier: PlanTier,
): Promise<DowngradePreview> {
	const targetLimits = getPlanLimits(targetTier);
	const currentLimits = getPlanLimits(currentTier);

	// --- Children ---
	const allChildren = await findAllChildren(tenantId);
	const childPreviews: ChildPreview[] = allChildren.map((c) => ({
		id: c.id,
		name: c.nickname,
		uiMode: c.uiMode,
	}));
	const childExcess =
		targetLimits.maxChildren !== null
			? Math.max(0, allChildren.length - targetLimits.maxChildren)
			: 0;

	// --- Activities (custom only) ---
	const allActivities = await findActivities(tenantId, { includeHidden: false });
	const customActivities = allActivities.filter((a) => a.source === 'custom');
	const activityPreviews: ActivityPreview[] = customActivities.map((a) => ({
		id: a.id,
		name: a.name,
		icon: a.icon,
	}));
	const activityExcess =
		targetLimits.maxActivities !== null
			? Math.max(0, customActivities.length - targetLimits.maxActivities)
			: 0;

	// --- Checklist Templates (per child) ---
	const checklistPreviews: ChecklistTemplatePreview[] = [];
	const excessByChild: { childId: number; childName: string; excess: number }[] = [];
	if (targetLimits.maxChecklistTemplates !== null) {
		for (const child of allChildren) {
			const templates = await findTemplatesByChild(child.id, tenantId, true);
			for (const t of templates) {
				checklistPreviews.push({
					id: t.id,
					name: t.name,
					childId: child.id,
					childName: child.nickname,
				});
			}
			const excess = Math.max(0, templates.length - targetLimits.maxChecklistTemplates);
			if (excess > 0) {
				excessByChild.push({ childId: child.id, childName: child.nickname, excess });
			}
		}
	}

	// --- Retention ---
	const retentionChange = {
		currentDays: currentLimits.historyRetentionDays,
		targetDays: targetLimits.historyRetentionDays,
		willLoseHistory:
			targetLimits.historyRetentionDays !== null &&
			(currentLimits.historyRetentionDays === null ||
				currentLimits.historyRetentionDays > targetLimits.historyRetentionDays),
	};

	const hasExcess = childExcess > 0 || activityExcess > 0 || excessByChild.length > 0;

	return {
		targetTier,
		children: {
			current: childPreviews,
			max: targetLimits.maxChildren,
			excess: childExcess,
		},
		activities: {
			current: activityPreviews,
			max: targetLimits.maxActivities,
			excess: activityExcess,
		},
		checklistTemplates: {
			current: checklistPreviews,
			maxPerChild: targetLimits.maxChecklistTemplates,
			excessByChild,
		},
		retentionChange,
		hasExcess,
	};
}

/**
 * ユーザーが選択したリソースをダウングレード用にアーカイブする。
 *
 * - 指定された childIds / activityIds / checklistTemplateIds を archive
 * - アーカイブ後に残るリソース数が targetTier の上限以内であることを検証
 * - 検証に失敗した場合はエラーを返す（上限超え）
 */
export interface ArchiveResult {
	ok: true;
	archivedChildIds: number[];
	archivedActivityIds: number[];
	archivedChecklistTemplateIds: number[];
}

export async function archiveForDowngrade(
	tenantId: string,
	targetTier: PlanTier,
	selection: ArchiveSelection,
): Promise<ArchiveResult | { ok: false; reason: string }> {
	const limits = getPlanLimits(targetTier);

	// --- 事前検証: アーカイブ後に上限以内に収まるか ---
	// Children
	if (limits.maxChildren !== null) {
		const allChildren = await findAllChildren(tenantId);
		const remaining = allChildren.length - selection.childIds.length;
		if (remaining > limits.maxChildren) {
			return {
				ok: false,
				reason: `子供の数が上限（${limits.maxChildren}人）を超えています。あと${remaining - limits.maxChildren}人分のアーカイブが必要です。`,
			};
		}
	}

	// Activities
	if (limits.maxActivities !== null) {
		const allActivities = await findActivities(tenantId, { includeHidden: false });
		const customActivities = allActivities.filter((a) => a.source === 'custom');
		const remaining = customActivities.length - selection.activityIds.length;
		if (remaining > limits.maxActivities) {
			return {
				ok: false,
				reason: `活動の数が上限（${limits.maxActivities}個）を超えています。あと${remaining - limits.maxActivities}個分のアーカイブが必要です。`,
			};
		}
	}

	// Checklist Templates (per child)
	if (limits.maxChecklistTemplates !== null) {
		const allChildren = await findAllChildren(tenantId);
		for (const child of allChildren) {
			if (selection.childIds.includes(child.id)) continue; // アーカイブ予定の子供はスキップ
			const templates = await findTemplatesByChild(child.id, tenantId, true);
			const archivedTemplateIds = selection.checklistTemplateIds.filter((id) =>
				templates.some((t) => t.id === id),
			);
			const remaining = templates.length - archivedTemplateIds.length;
			if (remaining > limits.maxChecklistTemplates) {
				return {
					ok: false,
					reason: `${child.nickname}のチェックリストテンプレートが上限（${limits.maxChecklistTemplates}個）を超えています。`,
				};
			}
		}
	}

	// --- アーカイブ実行 ---
	if (selection.childIds.length > 0) {
		await archiveChildren(selection.childIds, ARCHIVE_REASON, tenantId);
	}
	if (selection.activityIds.length > 0) {
		await archiveActivities(selection.activityIds, ARCHIVE_REASON, tenantId);
	}
	if (selection.checklistTemplateIds.length > 0) {
		await archiveChecklistTemplates(selection.checklistTemplateIds, ARCHIVE_REASON, tenantId);
	}

	return {
		ok: true,
		archivedChildIds: selection.childIds,
		archivedActivityIds: selection.activityIds,
		archivedChecklistTemplateIds: selection.checklistTemplateIds,
	};
}

export { ARCHIVE_REASON as DOWNGRADE_ARCHIVE_REASON };
