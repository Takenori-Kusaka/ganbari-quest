// /api/v1/special-rewards/export — ごほうび個別バックアップ (#3079)
//
// 選択中の child の reward 全件を marketplace v2 envelope (reward-set) で JSON ダウンロードする。
// 活動の /api/v1/activities/export と同型 (GET + Content-Disposition: attachment)。
// 活動が v1 format 互換 (formatVersion: '1.0') を維持するのに対し、reward-set は新規実装のため
// dispatchExport('reward-set', payload) で v2 envelope (checksum 付き) を出力する。
//
// 復元は admin/rewards の ?/restoreFile action (loadRewardSetFromFile → dispatchImport) で受ける。

import { json } from '@sveltejs/kit';
import { REWARD_CATEGORIES } from '$lib/domain/validation/special-reward';
import { dispatchExportToJson } from '$lib/marketplace/export-dispatcher';
import type { RewardSetPayload } from '$lib/marketplace/schemas/reward-set-schema';
import { requireRole } from '$lib/server/auth/factory';
import { getChildSpecialRewards } from '$lib/server/services/special-reward-service';
import type { RequestHandler } from './$types';

const VALID_CATEGORIES = new Set<string>(REWARD_CATEGORIES);

export const GET: RequestHandler = async ({ locals, url }) => {
	// #3246: export は import と同じ owner/parent gate に揃える (child role 到達不可)。
	// child から ?childId 指定で兄弟データを列挙できる家庭内 IDOR を塞ぐ。
	requireRole(locals, ['owner', 'parent']);
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	const childIdRaw = url.searchParams.get('childId');
	if (!childIdRaw || !/^\d+$/.test(childIdRaw)) {
		return json({ error: 'childId が必要です' }, { status: 400 });
	}
	const childId = Number(childIdRaw);

	const { rewards } = await getChildSpecialRewards(childId, tenantId);

	// reward-set schema (RewardSetItemSchema) は icon min1 / category picklist を要求するため、
	// DB の nullable icon / 任意 category を schema 整合値に正規化してから export する。
	const payload: RewardSetPayload = {
		rewards: rewards.map((r) => ({
			title: r.title,
			points: r.points,
			icon: r.icon && r.icon.length > 0 ? r.icon : '🎁',
			category: (VALID_CATEGORIES.has(r.category)
				? r.category
				: 'other') as RewardSetPayload['rewards'][number]['category'],
			...(r.description ? { description: r.description } : {}),
		})),
	};

	if (payload.rewards.length === 0) {
		return json({ error: 'エクスポートするごほうびがありません' }, { status: 400 });
	}

	const body = dispatchExportToJson({ typeCode: 'reward-set', payload });

	return new Response(body, {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': 'attachment; filename="rewards-export.json"',
		},
	});
};
