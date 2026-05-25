// src/lib/server/services/checklist-distribution-service.ts
//
// #2362 PR-5 (ADR-0055 / data-model-resource-scope §4.2):
//
// family checklist (`checklist_templates`) を child に「配信 / 配信解除」する責務専用 service。
//
// SRP に従い、本 service は **配信先 child 群の管理 (assignments)** のみに集中する。
//   - template 作成/編集自体 → `checklist-service.ts`
//   - per-child progress 更新 → `checklist-service.ts` の log API
//   - per-child override (個別 item 追加/除外) → `checklist-service.ts` の override API
//
// 関連設計書:
//   - docs/design/data-model-resource-scope.md §4.2
//   - docs/design/marketplace-import-flow.md (#2367)

import {
	findTemplateById,
	assignTemplateToChildren as repoAssign,
	findAssignmentsByChild as repoFindByChild,
	findAssignmentsByTemplate as repoFindByTemplate,
	unassignTemplateFromChildren as repoUnassign,
	unassignTemplate as repoUnassignAll,
} from '$lib/server/db/checklist-repo';
import { logger } from '$lib/server/logger';

/**
 * family checklist の配信先 child 一覧を取得。
 */
export async function listDistribution(
	templateId: number,
	tenantId: string,
): Promise<readonly { childId: number; createdAt: string }[]> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) {
		return [];
	}
	const rows = await repoFindByTemplate(templateId, tenantId);
	return rows.map((r) => ({ childId: r.childId, createdAt: r.createdAt }));
}

/**
 * 子供視点で「自分に配信されている family checklist の id 一覧」を取得。
 * 子供画面で「自分の checklist」を data 取得する際の補助 API (Phase 1 では子供画面は
 * 既存 `findTemplatesByChild` 経由で取得しているので、本 API は新規 UX 用)。
 */
export async function listAssignedTemplatesByChild(
	childId: number,
	tenantId: string,
): Promise<readonly number[]> {
	const rows = await repoFindByChild(childId, tenantId);
	return rows.map((r) => r.templateId);
}

/**
 * family checklist を指定 child 群に配信する (既配信は skip)。
 *
 * @returns 実際に追加された assignment の child id 配列
 */
export async function distributeToChildren(
	templateId: number,
	childIds: readonly number[],
	tenantId: string,
): Promise<readonly number[]> {
	if (childIds.length === 0) return [];

	const template = await findTemplateById(templateId, tenantId);
	if (!template) {
		throw new Error(
			`[checklist-distribution] template ${templateId} が見つかりません (tenant: ${tenantId})`,
		);
	}

	const inserted = await repoAssign(templateId, childIds, tenantId);
	logger.info('[checklist-distribution] family checklist を配信', {
		context: {
			tenantId,
			templateId,
			requestedChildCount: childIds.length,
			insertedChildCount: inserted.length,
		},
	});
	return inserted.map((a) => a.childId);
}

/**
 * 指定 child 群への配信を解除する。child 配列が空なら何もしない。
 */
export async function unassignFromChildren(
	templateId: number,
	childIds: readonly number[],
	tenantId: string,
): Promise<void> {
	if (childIds.length === 0) return;
	const template = await findTemplateById(templateId, tenantId);
	if (!template) return;

	await repoUnassign(templateId, childIds, tenantId);
	logger.info('[checklist-distribution] family checklist 配信解除', {
		context: { tenantId, templateId, removedChildCount: childIds.length },
	});
}

/**
 * 配信先を「指定 child 群のみ」に同期する (含まれない既存配信先は解除、新規 child は追加)。
 *
 * Phase 2 admin UX の ChecklistDistributionDialog 「保存」ボタンが本 API を呼ぶ想定。
 */
export async function syncDistribution(
	templateId: number,
	desiredChildIds: readonly number[],
	tenantId: string,
): Promise<{ added: readonly number[]; removed: readonly number[] }> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) {
		throw new Error(
			`[checklist-distribution] template ${templateId} が見つかりません (tenant: ${tenantId})`,
		);
	}

	const existing = await repoFindByTemplate(templateId, tenantId);
	const existingSet = new Set(existing.map((a) => a.childId));
	const desiredSet = new Set(desiredChildIds);

	const toAdd: number[] = desiredChildIds.filter((c) => !existingSet.has(c));
	const toRemove: number[] = [...existingSet].filter((c) => !desiredSet.has(c));

	const inserted = await repoAssign(templateId, toAdd, tenantId);
	if (toRemove.length > 0) {
		await repoUnassign(templateId, toRemove, tenantId);
	}

	logger.info('[checklist-distribution] sync 完了', {
		context: {
			tenantId,
			templateId,
			added: inserted.length,
			removed: toRemove.length,
		},
	});

	return {
		added: inserted.map((a) => a.childId),
		removed: toRemove,
	};
}

/**
 * template 削除時の cascade helper。template 自体の削除は repo `deleteTemplate` が
 * 既に内部で `checklist_template_assignments` も削除するため、通常は本 API を直接呼ぶ
 * 必要はない (公開しているのは「template を残したまま全配信を解除する」用途のため)。
 */
export async function unassignAll(templateId: number, tenantId: string): Promise<void> {
	const template = await findTemplateById(templateId, tenantId);
	if (!template) return;
	await repoUnassignAll(templateId, tenantId);
	logger.info('[checklist-distribution] family checklist 全配信解除', {
		context: { tenantId, templateId },
	});
}
