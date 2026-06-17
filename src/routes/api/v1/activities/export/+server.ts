// /api/v1/activities/export — 活動個別バックアップ (#3079 AC4 で v2 統一)
//
// 選択中 tenant の活動全件を marketplace v2 envelope (activity-pack) で JSON ダウンロードする。
// ごほうび (/api/v1/special-rewards/export) / チェックリスト (/api/v1/checklists/export) と
// 完全同型 (dispatchExportToJson('activity-pack', payload) で v2 envelope + checksum 付き出力)。
//
// 後方互換: 旧 v1 (formatVersion: '1.0') エクスポートファイルからの復元は引き続き受理する
// (importFile action → loadActivityPackFromFile → parseAnyExportEnvelope / migrateV1ActivityPackToV2)。
// v1 export 出力自体は本 PR で停止し、新規出力は v2 envelope のみ。

import { json } from '@sveltejs/kit';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { dispatchExportToJson } from '$lib/marketplace/export-dispatcher';
import type { ActivityPackPayload } from '$lib/marketplace/schemas/activity-pack-schema';
import { getActivities } from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

const CATEGORY_ID_TO_CODE: Record<number, string> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_ID_TO_CODE[i + 1] = code;
}

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const activities = await getActivities(tenantId, { includeHidden: false });

	// activity-pack schema (ActivityPackItemSchema) は name min1 / categoryCode picklist /
	// icon min1 / basePoints int を要求するため、DB の値を schema 整合値に正規化してから export する。
	// 旧 v1 が key として残していた nameKana/nameKanji は activity-pack content model 外 (schema に
	// 含まれない) ため、v2 envelope では schema 準拠フィールド
	// (name/categoryCode/icon/basePoints/ageMin/ageMax/gradeLevel/triggerHint) のみ carry する。
	const payload: ActivityPackPayload = {
		activities: activities.map((a) => ({
			name: a.name,
			categoryCode: (CATEGORY_ID_TO_CODE[a.categoryId] ??
				'seikatsu') as ActivityPackPayload['activities'][number]['categoryCode'],
			icon: a.icon && a.icon.length > 0 ? a.icon : '📝',
			basePoints: a.basePoints,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
			...(a.triggerHint ? { triggerHint: a.triggerHint } : {}),
		})),
	};

	if (payload.activities.length === 0) {
		return json({ error: 'エクスポートする活動がありません' }, { status: 400 });
	}

	const body = dispatchExportToJson({ typeCode: 'activity-pack', payload });

	return new Response(body, {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': 'attachment; filename="activities-export.json"',
		},
	});
};
