// /api/v1/activities/export — 活動個別バックアップ (#3079 AC4 で v2 統一)
//
// `?childId=<id>` で指定した 1 人分の活動を marketplace v2 envelope (activity-pack) で
// JSON ダウンロードする (#4692: 旧 tenant 全件平坦化を廃止し per-child scope に統一)。
// ごほうび (/api/v1/special-rewards/export) / チェックリスト (/api/v1/checklists/export) と
// 完全同型 (dispatchExportToJson('activity-pack', payload) で v2 envelope + checksum 付き出力)。
//
// 後方互換: 旧 v1 (formatVersion: '1.0') エクスポートファイルからの復元は引き続き受理する
// (importFile action → loadActivityPackFromFile → parseAnyExportEnvelope / migrateV1ActivityPackToV2)。
// v1 export 出力自体は本 PR で停止し、新規出力は v2 envelope のみ。

import { json } from '@sveltejs/kit';
import { toCategoryCode } from '$lib/domain/categories';
import { asChildId } from '$lib/domain/ids';
import { ADMIN_CHILD_SCOPE_LABELS } from '$lib/domain/labels';
import { dispatchExportToJson } from '$lib/marketplace/export-dispatcher';
import type { ActivityPackPayload } from '$lib/marketplace/schemas/activity-pack-schema';
import { requireRole } from '$lib/server/auth/factory';
import { getChildActivities } from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	// #3246: export は import と同じ owner/parent gate に揃える (child role 到達不可)。
	requireRole(locals, ['owner', 'parent']);
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	// #4692 F2: 活動管理は per-child 主軸 (ADR-0055) なので export も選択中の子だけを出す。
	// 旧実装は tenant 全 child を子供の区別なく 1 ファイルに平坦化しており、その JSON を
	// 復元すると全員分が 1 人に入った (F1 と合わさって「全員分が最初の子に入る」事故)。
	// ごほうび (/api/v1/special-rewards/export) と同型に childId を必須化する。
	const childIdRaw = url.searchParams.get('childId');
	if (!childIdRaw) {
		return json({ error: ADMIN_CHILD_SCOPE_LABELS.childRequired }, { status: 400 });
	}
	const activities = await getChildActivities(asChildId(childIdRaw), tenantId, {
		includeHidden: false,
	});

	// activity-pack schema (ActivityPackItemSchema) は name min1 / categoryCode picklist /
	// icon min1 / basePoints int を要求するため、DB の値を schema 整合値に正規化してから export する。
	// 旧 v1 が key として残していた nameKana/nameKanji は activity-pack content model 外 (schema に
	// 含まれない) ため、v2 envelope では schema 準拠フィールド
	// (name/categoryCode/icon/basePoints/ageMin/ageMax/gradeLevel/triggerHint) のみ carry する。
	const payload: ActivityPackPayload = {
		activities: activities.map((a) => ({
			name: a.name,
			// #3607: id→code は SSOT 派生 helper で解決 (未知 id は従来どおり seikatsu に fallback)
			categoryCode: toCategoryCode(a.categoryId) ?? 'seikatsu',
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
