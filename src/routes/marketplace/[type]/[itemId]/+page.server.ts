import { error, fail, redirect } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import type {
	ChecklistPayload,
	MarketplaceItemType,
	RulePresetPayload,
} from '$lib/domain/marketplace-item';
// #2366 / #2367 / #2368 / #2369 (ADR-0052 / EPIC #2362 P3): reward-set / checklist / rule-preset /
// challenge-set を新 Strategy + dispatchImport 経由に移行。
// `$lib/marketplace` の eager-load (`./types/reward-set` / `./types/checklist` / `./types/rule-preset` /
// `./types/challenge-set`) で Registry 登録される。
// #2138 (MP-3) / #2368: rule-preset 4 ruleType 全対応の一括取込
// 新 SSOT: marketplaceRegistry.get('rule-preset').strategy 経由 (Strategy 内部 sub-dispatcher)
import { dispatchImport, marketplaceRegistry } from '$lib/marketplace';
import { loadFromMarketplace } from '$lib/marketplace/sources/marketplace-source';
import type { rulePresetStrategy } from '$lib/marketplace/strategies/rule-preset-strategy';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import type { Actions, PageServerLoad } from './$types';

const VALID_TYPES: MarketplaceItemType[] = [
	'activity-pack',
	'reward-set',
	'checklist',
	'rule-preset',
	// #2297 (EPIC #2294 ③): challenge-set 詳細ページ対応
	'challenge-set',
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
			// #2303: 未ログイン redirect は /auth/login 経由 (誤新規登録防止 / data integrity 保護)
			redirect(303, `/auth/login?redirect=/marketplace/${type}/${itemId}`);
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

		// #2366 (ADR-0052): Strategy + dispatchImport 経由でインポート。
		// requiresChildId=true の Descriptor が ctx.childId 必須を表明する。
		// 旧 service の preview→allDuplicates 早期 return は dispatcher 経由でも
		// `imported===0 && skipped===total` で同等の意味を表現できるため UI 側で判定。
		try {
			const result = await dispatchImport({
				typeCode: 'reward-set',
				rawPayload: item.payload,
				displayName: item.name,
				ctx: { tenantId, presetId: itemId, childId },
			});

			// 全件重複の場合は allDuplicates フラグで返却 (UI 互換)
			if (result.imported === 0 && result.skipped === result.total && result.total > 0) {
				return { rewardImport: { allDuplicates: true } };
			}

			return {
				rewardImport: {
					imported: result.imported,
					skipped: result.skipped,
					errors: result.errors,
				},
			};
		} catch (e) {
			logger.error('[marketplace/reward-set] インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { itemId, childId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	// #2137 (MP-2): event-checklist 一括追加 action
	// CTA「一括追加」ボタンの form action。ログイン済みのみ動作する
	// (未ログインは UI 側で /auth/login?next=... に誘導する、#2303)。
	importChecklist: async ({ params, request, locals }) => {
		const tenantId = locals.context?.tenantId;
		if (!tenantId) {
			// 未ログインで POST が来た場合は login 経由で戻す
			// (#2303: 誤新規登録防止 / data integrity 保護)
			redirect(302, `/auth/login?next=/marketplace/checklist/${params.itemId}`);
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

		// #2367: checklist は dispatchImport 経由 (EPIC #2362 P3)
		// 旧 service の戻り shape (imported / importedItems / errors / alreadyImported /
		// existingTemplateName) を UI 不変のまま維持するため、preview を別途呼び
		// existingTemplateName を取り出す (atomic 重複時のみ意味あり)。
		const item = getMarketplaceItem('checklist', params.itemId);
		if (!item) {
			return fail(404, { error: 'プリセットが見つかりません' });
		}
		const payload = item.payload as ChecklistPayload;
		try {
			const descriptor = marketplaceRegistry.get('checklist');
			const strategy = descriptor.strategy;
			// biome-ignore lint/suspicious/noExplicitAny: Registry parametric type 解決のため
			const parsedPayload = (strategy as any).parse(payload);
			// biome-ignore lint/suspicious/noExplicitAny: 同上
			const preview = await (strategy as any).preview(parsedPayload, {
				tenantId,
				presetId: params.itemId,
				childId,
			});
			// atomic 重複検知: 全件 skipped = duplicates = total = alreadyImported
			if (preview.duplicates === preview.total && preview.total > 0) {
				return {
					importResult: true,
					alreadyImported: true,
					presetName: item.name,
					existingTemplateName: preview.duplicateNames[0],
				};
			}
			const result = await dispatchImport({
				typeCode: 'checklist',
				rawPayload: payload,
				displayName: item.name,
				ctx: {
					tenantId,
					presetId: params.itemId,
					childId,
				},
			});
			return {
				importResult: true,
				alreadyImported: false,
				presetName: result.packName,
				imported: result.imported,
				// importedItems は ChecklistImportResult 互換のため items 数を返す
				importedItems: payload.items.length,
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

	// #2138 (MP-3): rule-preset 4 ruleType 全対応 の一括取込 action
	// CTA「一括追加」ボタンの form action。
	// - exchange: childId 必須 (special_rewards に挿入)
	// - bonus:    childId 不要 (settings KVS に tenant スコープで保存)
	// - penalty / special: 取込試行を warning として返却 + audit log 記録
	importRulePreset: async ({ params, request, locals }) => {
		const tenantId = locals.context?.tenantId;
		if (!tenantId) {
			// #2303: 未ログイン redirect は /auth/login 経由 (誤新規登録防止 / data integrity 保護)
			redirect(302, `/auth/login?next=/marketplace/rule-preset/${params.itemId}`);
		}

		if (params.type !== 'rule-preset') {
			return fail(400, { error: 'ルールセットではありません' });
		}

		const item = getMarketplaceItem('rule-preset', params.itemId);
		if (!item) {
			return fail(404, { error: 'プリセットが見つかりません' });
		}

		const payload = item.payload as RulePresetPayload;
		const formData = await request.formData();
		const childIdRaw = formData.get('childId');
		const childId = childIdRaw ? Number(childIdRaw) : undefined;

		// exchange は childId 必須
		if (payload.ruleType === 'exchange') {
			if (!childId || Number.isNaN(childId)) {
				return fail(400, { error: 'お子さまを選択してください' });
			}
			const children = await getAllChildren(tenantId);
			if (!children.some((c) => c.id === childId)) {
				return fail(400, { error: 'お子さまが見つかりません' });
			}
		}

		try {
			// #2368: Strategy 経由 (Registry 経由で本番 / demo 環境とも同一動作)
			const strategy = marketplaceRegistry.get('rule-preset').strategy as typeof rulePresetStrategy;
			const identity = {
				presetId: item.itemId,
				presetName: item.name,
				presetIcon: item.icon,
			};
			const ctx = { tenantId, childId };

			const preview = await strategy.previewRulePreset(identity, payload, ctx);

			if (preview.alreadyImported) {
				return {
					ruleImport: {
						alreadyImported: true,
						presetName: preview.presetName,
						ruleType: preview.ruleType,
					},
				};
			}

			const result = await strategy.applyRulePreset(identity, payload, ctx);
			return {
				ruleImport: {
					alreadyImported: false,
					presetName: preview.presetName,
					ruleType: preview.ruleType,
					imported: result.imported,
					skipped: result.skipped,
					warnings: result.warnings,
					errors: result.errors,
				},
			};
		} catch (e) {
			logger.error('[marketplace/rule-preset] インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { itemId: params.itemId, childId, ruleType: payload.ruleType },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	// #2369 (EPIC #2362 P3 / EPIC #2294 ③ 案 B-γ wedge):
	// challenge-set Strategy 経由の一括取込 action。
	// 旧来 service 不存在の type 漏れ状態を新 abstraction 上で初回実装。
	// childId は不要 (sibling_challenges は family scope、全子供を自動エンロール)。
	importChallengeSet: async ({ params, request, locals }) => {
		const tenantId = locals.context?.tenantId;
		if (!tenantId) {
			// #2303: 未ログイン redirect は /auth/login 経由 (誤新規登録防止 / data integrity 保護)
			redirect(302, `/auth/login?next=/marketplace/challenge-set/${params.itemId}`);
		}

		if (params.type !== 'challenge-set') {
			return fail(400, { error: 'チャレンジ集ではありません' });
		}

		const item = getMarketplaceItem('challenge-set', params.itemId);
		if (!item) {
			return fail(404, { error: 'チャレンジ集が見つかりません' });
		}

		// preserved: 取込前に formData を空読みして action 整合性を維持
		await request.formData();

		try {
			const source = loadFromMarketplace('challenge-set', params.itemId);
			const result = await dispatchImport({
				typeCode: 'challenge-set',
				rawPayload: source.payload,
				displayName: source.displayName,
				ctx: { tenantId, presetId: params.itemId },
			});
			return {
				challengeSetImport: {
					presetName: result.packName,
					imported: result.imported,
					skipped: result.skipped,
					errors: result.errors,
				},
			};
		} catch (e) {
			logger.error('[marketplace/challenge-set] インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { itemId: params.itemId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
