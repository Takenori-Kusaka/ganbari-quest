import { error, fail, redirect } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import type { MarketplaceItemType, RewardSetPayload } from '$lib/domain/marketplace-item';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	importChecklistTemplate,
	previewChecklistImport,
} from '$lib/server/services/checklist-template-import-service';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	importRewardSet,
	previewRewardSetImport,
} from '$lib/server/services/reward-set-import-service';
import type { Actions, PageServerLoad } from './$types';

const VALID_TYPES: MarketplaceItemType[] = [
	'activity-pack',
	'reward-set',
	'checklist',
	'rule-preset',
];

export const load: PageServerLoad = async ({ params, locals }) => {
	const { type, itemId } = params;

	if (!VALID_TYPES.includes(type as MarketplaceItemType)) {
		error(404, 'コンテンツタイプが不正です');
	}

	const item = getMarketplaceItem(type as MarketplaceItemType, itemId);
	if (!item) {
		error(404, 'コンテンツが見つかりません');
	}

	// #2136 MP-1 / #2137 MP-2: 認証済みなら一括追加 CTA を出すための情報をロード。
	// マーケットプレイスは公開ルートなので、未認証 (locals.context が無い場合) は
	// children を空配列にしてサインアップ誘導 CTA を出す。
	// reward-set / checklist 両方の CTA で children を共通利用するため、
	// type 区別せず一括ロード（無駄に大きい呼び出しではないため pre-PMF で問題なし）。
	const isAuthenticated = !!locals.context;
	let children: { id: number; nickname: string }[] = [];
	if (isAuthenticated) {
		try {
			const tenantId = requireTenantId(locals);
			const allChildren = await getAllChildren(tenantId);
			children = allChildren.map((c) => ({ id: c.id, nickname: c.nickname }));
		} catch {
			// 認証コンテキストはあるがテナント解決失敗 — 未認証扱いにフォールバック
			children = [];
		}
	}

	return {
		item,
		isAuthenticated,
		// #2137: MP-2 側 svelte が `data.isLoggedIn` を参照するためのエイリアス
		isLoggedIn: isAuthenticated,
		children,
	};
};

export const actions: Actions = {
	// #2136 MP-1: reward-set の一括取込 action
	importRewardSet: async ({ request, params, locals }) => {
		const { type, itemId } = params;

		if (type !== 'reward-set') {
			return fail(400, { error: 'このコンテンツタイプは一括追加に対応していません' });
		}

		if (!locals.context) {
			redirect(303, `/auth/signup?redirect=/marketplace/${type}/${itemId}`);
		}

		const tenantId = requireTenantId(locals);
		const item = getMarketplaceItem('reward-set', itemId);
		if (!item) {
			return fail(404, { error: 'コンテンツが見つかりません' });
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		if (!childId) {
			return fail(400, { error: 'お子さまを選択してください' });
		}

		const rewards = (item.payload as RewardSetPayload).rewards;
		const preview = await previewRewardSetImport(rewards, itemId, childId, tenantId);

		if (preview.newRewards === 0) {
			return { rewardImport: { allDuplicates: true } };
		}

		const result = await importRewardSet(rewards, tenantId, {
			presetId: itemId,
			childId,
		});

		return {
			rewardImport: {
				imported: result.imported,
				skipped: result.skipped,
				errors: result.errors,
			},
		};
	},

	// #2137 (MP-2): event-checklist 一括追加 action
	// CTA「一括追加」ボタンの form action。ログイン済みのみ動作する
	// (未ログインは UI 側で /auth/signup?next=... に誘導する)。
	importChecklist: async ({ params, request, locals }) => {
		const tenantId = locals.context?.tenantId;
		if (!tenantId) {
			// 未ログインで POST が来た場合は signup 経由で戻す
			redirect(302, `/auth/signup?next=/marketplace/checklist/${params.itemId}`);
		}

		if (params.type !== 'checklist') {
			return fail(400, { error: 'チェックリストではありません' });
		}

		const formData = await request.formData();
		const childIdRaw = formData.get('childId');
		const childId = Number(childIdRaw);
		if (!childId || Number.isNaN(childId)) {
			return fail(400, { error: 'お子さまを選択してください' });
		}

		// 子供が本テナントに存在するか念のため確認
		const children = await getAllChildren(tenantId);
		if (!children.some((c) => c.id === childId)) {
			return fail(400, { error: 'お子さまが見つかりません' });
		}

		try {
			const preview = await previewChecklistImport(params.itemId, childId, tenantId);
			if (!preview) {
				return fail(404, { error: 'プリセットが見つかりません' });
			}
			if (preview.alreadyImported) {
				return {
					importResult: true,
					alreadyImported: true,
					presetName: preview.presetName,
					existingTemplateName: preview.existingTemplateName,
				};
			}

			const result = await importChecklistTemplate(params.itemId, childId, tenantId);
			return {
				importResult: true,
				alreadyImported: false,
				presetName: preview.presetName,
				imported: result.imported,
				importedItems: result.importedItems,
				errors: result.errors,
			};
		} catch (e) {
			logger.error('[marketplace/checklist] インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { itemId: params.itemId, childId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
