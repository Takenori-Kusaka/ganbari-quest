// /api/v1/checklists/export — チェックリスト個別バックアップ (#3079)
//
// 指定 templateId の family checklist テンプレート 1 件を marketplace v2 envelope (checklist) で
// JSON ダウンロードする。checklist payload schema は単一テンプレート (`{ timing, items }`) のため、
// export 単位 = 1 テンプレート (テンプレート選択 → 個別 export)。複数テンプレート一括 / 家族全体の
// 横断 backup は別概念 (/admin/settings/data, #1254)。責務切り分けは marketplace-import-flow.md §3.3。
//
// 復元は admin/checklists の ?/restoreFile action (loadChecklistFromFile →
// importChecklistTemplateFromPayload) で受ける。

import { json } from '@sveltejs/kit';
import { buildAttachmentContentDisposition } from '$lib/domain/export-format';
import { dispatchExportToJson } from '$lib/marketplace/export-dispatcher';
import type { ChecklistPayload } from '$lib/marketplace/schemas/checklist-schema';
import { findTemplateById, findTemplateItems } from '$lib/server/db/checklist-repo';
import type { RequestHandler } from './$types';

/**
 * checklist_templates.timeSlot (morning/afternoon/evening/anytime) を
 * ChecklistPayload.timing (CHECKLIST_TIMINGS) に逆変換する。
 * normalizeTimeSlot (import 側) の逆写像 (afternoon/anytime は時間帯指定なし = daily)。
 */
function timeSlotToTiming(timeSlot: string): ChecklistPayload['timing'] {
	if (timeSlot === 'morning') return 'morning';
	if (timeSlot === 'evening') return 'evening';
	return 'daily';
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	const templateIdRaw = url.searchParams.get('templateId');
	if (!templateIdRaw || !/^\d+$/.test(templateIdRaw)) {
		return json({ error: 'templateId が必要です' }, { status: 400 });
	}
	const templateId = Number(templateIdRaw);

	const template = await findTemplateById(templateId, tenantId);
	if (!template) {
		return json({ error: 'テンプレートが見つかりません' }, { status: 404 });
	}

	const items = await findTemplateItems(templateId, tenantId);
	if (items.length === 0) {
		return json({ error: 'エクスポートする項目がありません' }, { status: 400 });
	}

	const payload: ChecklistPayload = {
		timing: timeSlotToTiming(template.timeSlot),
		items: items
			.slice()
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((it) => ({
				label: it.name,
				icon: it.icon && it.icon.length > 0 ? it.icon : '📋',
				order: it.sortOrder,
			})),
	};

	const body = dispatchExportToJson({ typeCode: 'checklist', payload });

	// テンプレート名をファイル名に含める (復元時の同名重複判定で使うため、name は payload 外で保持)。
	// #3104: 日本語名をそのまま Content-Disposition に入れると ByteString 変換 500 になるため、
	// RFC 5987 (filename*=UTF-8'') + ASCII fallback を組む共通 helper を経由する。
	// modern browser は filename* で日本語名を復元するので round-trip の name 保持も維持される。
	const downloadName = template.name
		? `checklist-${template.name}.json`
		: `checklist-template-${templateId}.json`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': buildAttachmentContentDisposition(downloadName),
		},
	});
};
