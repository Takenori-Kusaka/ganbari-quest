import { error, fail, redirect } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import type { MarketplaceItemType, RulePresetPayload } from '$lib/domain/marketplace-item';
// #2366 / #2367 / #2368 / #2369 (ADR-0052 / EPIC #2362 P3): reward-set / checklist / rule-preset /
// challenge-set を新 Strategy + dispatchImport 経由に移行。
// `$lib/marketplace` の eager-load (`./types/reward-set` / `./types/checklist` / `./types/rule-preset` /
// `./types/challenge-set`) で Registry 登録される。
// #2138 (MP-3) / #2368: rule-preset 4 ruleType 全対応の一括取込
// 新 SSOT: marketplaceRegistry.get('rule-preset').strategy 経由 (Strategy 内部 sub-dispatcher)
// #2458-B: challenge-set / reward-set / checklist は admin 画面 ?import=<itemId> redirect モデルへ統一済
// (CWE-598 整合)。dispatchImport / loadFromMarketplace は本 file では未使用。
import { marketplaceRegistry } from '$lib/marketplace';
import type { rulePresetStrategy } from '$lib/marketplace/strategies/rule-preset-strategy';
import { requireTenantId } from '$lib/server/auth/factory';
import { findActivities } from '$lib/server/db/activity-repo';
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
	// Round 18 Cluster H (#13/#16/#20/#25/#28): activity-pack subset 選択用に、
	// 既存活動の name を集めて preschool 親が「[既存]」ラベルで重複を一目で見分けられるようにする。
	// per-child / family master 並存期 (ADR-0055) のため tenant aggregate (`findActivities`) で
	// 全 child の既存活動 name を集約。重複判定は name match のみ (icon は SSOT が活動 master のため
	// 比較に含めない)。空配列で初期化、未認証時はそのまま空配列のまま返る。
	let existingActivityNames: string[] = [];
	if (isAuthenticated) {
		try {
			const tenantId = requireTenantId(locals);
			const allChildren = await getAllChildren(tenantId);
			children = allChildren.map((c) => ({ id: c.id, nickname: c.nickname }));

			if (type === 'activity-pack') {
				const existing = await findActivities(tenantId);
				existingActivityNames = Array.from(new Set(existing.map((a) => a.name)));
			}
		} catch {
			// 認証コンテキストはあるがテナント解決失敗 — 未認証扱いにフォールバック
			children = [];
			existingActivityNames = [];
		}
	}

	return {
		item,
		isAuthenticated,
		// #2137: MP-2 側 svelte が `data.isLoggedIn` を参照するためのエイリアス
		isLoggedIn: isAuthenticated,
		children,
		// Round 18 Cluster H: activity-pack 詳細で「[既存]」ラベル表示用 (未認証時 / 他 type 時は空配列)
		existingActivityNames,
	};
};

export const actions: Actions = {
	// #2362 PR-4 (ADR-0055 / CWE-598): reward-set marketplace action は child 情報を
	// 持たず、admin/rewards へ `?import=<itemId>` で遷移するだけ。
	// 取込実行 (per-child fan-out) は admin/rewards 側の ChildSelectionDialog 経由で行う。
	// 旧来 form data (`childId`) は受信せず、URL/body に child 情報を一切露出させない
	// (User §7.3 直接判断 + marketplace-import-flow.md §2.1)。
	importRewardSet: async ({ params, locals }) => {
		const { type, itemId } = params;

		if (type !== 'reward-set') {
			return fail(400, { error: 'このコンテンツタイプは一括追加に対応していません' });
		}

		if (!locals.context) {
			// #2303: 未ログイン redirect は /auth/login 経由 (誤新規登録防止 / data integrity 保護)
			redirect(303, `/auth/login?redirect=/marketplace/${type}/${itemId}`);
		}

		// presetId のみ持って親管理画面へ遷移 (childId は URL/body どこにも露出させない)
		redirect(303, `/admin/rewards?import=${encodeURIComponent(itemId)}`);
	},

	// #2362 PR-5 Phase 2 (ADR-0055 / CWE-598): checklist marketplace action は child 情報を
	// 持たず、admin/checklists へ `?import=<itemId>` で遷移するだけ。
	// 取込実行 (family scope + 配信先選択) は admin/checklists 側の ChecklistDistributionDialog
	// 経由で行う (User §7.3 / marketplace-import-flow.md §2.1)。
	importChecklist: async ({ params, locals }) => {
		if (params.type !== 'checklist') {
			return fail(400, { error: 'チェックリストではありません' });
		}

		if (!locals.context) {
			// #2303: 未ログイン redirect は /auth/login 経由 (誤新規登録防止 / data integrity 保護)
			redirect(303, `/auth/login?redirect=/marketplace/checklist/${params.itemId}`);
		}

		// presetId のみ持って親管理画面へ遷移 (childId は URL/body どこにも露出させない)
		redirect(303, `/admin/checklists?import=${encodeURIComponent(params.itemId)}`);
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

		// #2362 PR-6: bonus は family scope。marketplace 経由の in-page import を
		// 撤去し /admin/settings/rules?import=<itemId> 経由に統一 (CWE-598 整合)。
		// 直接 POST してきた場合 (form 撤去後の互換 / 攻撃) は admin 側へ redirect。
		if (payload.ruleType === 'bonus') {
			redirect(303, `/admin/settings/rules?import=${params.itemId}`);
		}

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

	// #2458-B: marketplace challenge-set action は child 情報を持たず、
	// admin/challenges へ `?marketplace-import=<itemId>` で遷移するだけ。
	// 取込実行 (per-child 配信) は admin/challenges 側の ChildSelectionDialog 経由で行う。
	// (User §7.3 / marketplace-import-flow.md §2.1: CWE-598 整合 = childIds を URL/body に出さない)
	importChallengeSet: async ({ params, locals }) => {
		if (params.type !== 'challenge-set') {
			return fail(400, { error: 'チャレンジ集ではありません' });
		}

		if (!locals.context) {
			// #2303: 未ログイン redirect は /auth/login 経由 (誤新規登録防止 / data integrity 保護)
			redirect(303, `/auth/login?redirect=/marketplace/challenge-set/${params.itemId}`);
		}

		// presetId のみ持って親管理画面へ遷移 (childIds は URL/body どこにも露出させない)
		redirect(303, `/admin/challenges?marketplace-import=${encodeURIComponent(params.itemId)}`);
	},
};
