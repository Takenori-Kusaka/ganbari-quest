// /admin/rewards — ごほうび管理 (#336, #501, #581 プリセット追加, #728 プランゲート, #787 PlanLimitError 統一, #1337 申請タブ追加, #2136 MP-1 マーケットプレイス一括追加, #2268 CRUD 整備 + 命名訂正 + 検索 + grant→add リネーム + 申請タブ削除)

import { fail } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
// #2558 段階2 横展開: admin 内 marketplace 風 in-page browse UI を撤去し
// `/marketplace?type=reward-set` への画面遷移に統一 (DESIGN.md §10 構造的ルール
// 「marketplace 取込はマーケットプレイス画面に一本化、admin 内ブラウズ UI 二重管理禁止」)。
// 旧 `PRESET_REWARD_GROUPS` の in-page render は撤去済 (本 file の load 出力からも削除)。
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { ADMIN_REWARDS_PAGE_LABELS, PLAN_GATE_LABELS } from '$lib/domain/labels';
// #2366 (ADR-0052): reward-set を新 Strategy + dispatchImport 経由に移行。
// `$lib/marketplace` の eager-load (`./types/reward-set`) で Registry 登録される。
import { dispatchImport } from '$lib/marketplace';
// #2775 (Issue #2774 Phase 2): rule-preset exchange を本画面 ?import= 受領フローに統合するため
// Strategy + identity を直接 import (rule-preset 固有 warnings / ruleType を扱うため Registry
// 経由 generic dispatch ではなく拡張 method `applyRulePreset` を呼ぶ)。
import { rulePresetStrategy } from '$lib/marketplace/strategies/rule-preset-strategy';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
// #2362 PR-4 (ADR-0055): per-child reward 兄弟共通化 copy
import {
	copyChildRewardsToSibling,
	copyChildRewardsToSiblings,
} from '$lib/server/services/child-reward-copy-service';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	isPaidTier,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import { getRedemptionRequestsForParent } from '$lib/server/services/reward-redemption-service';
import {
	addReward,
	deleteReward,
	getChildSpecialRewards,
	getRewardTemplates,
	type RewardTemplate,
	saveRewardTemplates,
	updateReward,
} from '$lib/server/services/special-reward-service';
import type { Actions, PageServerLoad } from './$types';

// #2268: 「特別なごほうび設定」→「ごほうび管理」に文言更新
const UPGRADE_MESSAGE = PLAN_GATE_LABELS.standardOrAboveFor('ごほうび管理');

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	const isPremium = isPaidTier(tier);

	const children = await getAllChildren(tenantId);
	const templates = await getRewardTemplates(tenantId);

	// #2362 PR-4 (ADR-0055): per-child rewards 取得 (child タブ切替 + 兄弟 copy UI 用)
	const childRewardsByChild: Record<
		number,
		Awaited<ReturnType<typeof getChildSpecialRewards>>['rewards']
	> = {};
	const childrenWithRewards = await Promise.all(
		children.map(async (child) => {
			const rewards = await getChildSpecialRewards(child.id, tenantId);
			childRewardsByChild[child.id] = rewards.rewards;
			return {
				...child,
				rewardCount: rewards.rewards.length,
				totalRewardPoints: rewards.totalPoints,
			};
		}),
	);

	// #2362 PR-4 / #2775: `?import=<presetId>` query で ChildSelectionDialog auto-open。
	// reward-set または rule-preset (exchange) の preset id を受け付ける (Issue #2774 Phase 2、
	// 5 type 統一)。bonus / penalty / special は本画面の受領対象外 (bonus は
	// /admin/settings/rules、penalty / special は marketplace 詳細で warning 表示)。
	const importPresetIdRaw = url.searchParams.get('import')?.trim() || null;
	let importPresetId: string | null = null;
	let importPresetTypeCode: 'reward-set' | 'rule-preset' | null = null;
	if (importPresetIdRaw) {
		const rewardSetItem = getMarketplaceItem('reward-set', importPresetIdRaw);
		if (rewardSetItem) {
			importPresetId = importPresetIdRaw;
			importPresetTypeCode = 'reward-set';
		} else {
			const rulePresetItem = getMarketplaceItem('rule-preset', importPresetIdRaw);
			// rule-preset は exchange のみ受領 (special_rewards に挿入される ruleType)。
			// bonus / penalty / special は別フロー (admin/settings/rules or warning) のため
			// 本画面の `?import=` 対象外として invalid 扱い → UI 警告。
			if (rulePresetItem) {
				const ruleType = (
					rulePresetItem.payload as { ruleType?: 'exchange' | 'bonus' | 'penalty' | 'special' }
				).ruleType;
				if (ruleType === 'exchange') {
					importPresetId = importPresetIdRaw;
					importPresetTypeCode = 'rule-preset';
				}
			}
		}
	}
	const importPresetInvalid = Boolean(importPresetIdRaw) && !importPresetId;
	// `?childId=<n>` query で初期 child 選択復元 (refresh / share link 対応)
	const initialChildIdRaw = url.searchParams.get('childId');
	const initialChildId =
		initialChildIdRaw && /^\d+$/.test(initialChildIdRaw) ? Number(initialChildIdRaw) : null;

	// #2268: 申請承認画面は /admin/rewards/requests に分離 (子#3)。
	// 本画面は pending 件数のみ取得し、overflow menu のバッジに使用する。
	const pendingRequests = await getRedemptionRequestsForParent(tenantId, {
		status: 'pending_parent_approval',
	});

	// #2558 段階2 横展開: 旧 in-page marketplace browse UI で参照していた `rewardSets` /
	// `presetGroups` は、marketplace への画面遷移統一に伴い load 出力から削除。
	// 取込実行は marketplace 詳細 → `?import=<presetId>` → ChildSelectionDialog auto-open
	// の正規経路 (marketplace-import-flow.md §3.1) に合流させる。

	// #2832 AC2: pending redemption が存在する reward の集合。
	// 編集 dialog の「申請時点の内容で処理」note + 削除前の処理待ちバッジ表示に使う。
	const pendingRewardIds = [...new Set(pendingRequests.map((r) => r.rewardId))];

	return {
		children: childrenWithRewards,
		childRewardsByChild,
		templates,
		isPremium,
		planTier: tier,
		pendingRequestsCount: pendingRequests.length,
		pendingRewardIds,
		importPresetId,
		// #2775: rule-preset (exchange) も `?import=` で受領可能化 — typeCode を svelte に伝達して
		// fetch action 振り分けに使う
		importPresetTypeCode,
		importPresetInvalid,
		initialChildId,
	};
};

/** 現在のプラン tier を解決して返すヘルパー (#787) */
async function resolveTier(locals: App.Locals, tenantId: string): Promise<PlanTier> {
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	return resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
}

export const actions: Actions = {
	// #2268: grant → add リネーム (実態は special_rewards INSERT、子供 shop に並べる商品の追加)
	add: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはカスタム報酬追加不可
		// #787: PlanLimitError 形式に統一
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? 'other');

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (points <= 0 || points > 10000) return fail(400, { error: 'ポイントは1〜10000の範囲です' });

		const result = await addReward({ childId, title, points, icon, category }, tenantId);
		if ('error' in result) {
			return fail(400, { error: result.error });
		}

		return { granted: true, reward: result };
	},

	// #2832 AC2 (案 b): reward 編集。pending redemption 中も許容。
	// 申請済みの交換は申請時点 snapshot で処理される (UI が note で明示)。
	// プランゲートは add と同じ (編集で実質新規作成できるため bypass を防ぐ)。
	update: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const rewardId = Number(formData.get('rewardId'));
		const childId = Number(formData.get('childId'));
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? '');

		if (!rewardId || !childId) return fail(400, { error: 'ごほうびが指定されていません' });
		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (points <= 0 || points > 10000) return fail(400, { error: 'ポイントは1〜10000の範囲です' });

		const result = await updateReward(
			rewardId,
			childId,
			{ title, points, icon, category: category || undefined },
			tenantId,
		);
		if ('error' in result) {
			return fail(404, { error: ADMIN_REWARDS_PAGE_LABELS.editFailed });
		}

		return { rewardUpdated: true, reward: result };
	},

	// #2832 AC1: reward 削除。pending redemption ガード (hasPendingByReward) 配線。
	// 処理待ち申請あり → 409 で削除拒否 (labels SSOT メッセージ)。
	// プランゲートなし: 既存データの整理 (削除) は free tier でも可能でなければならない
	// (downgrade 後の data lifecycle 整合)。
	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		const formData = await request.formData();
		const rewardId = Number(formData.get('rewardId'));
		const childId = Number(formData.get('childId'));

		if (!rewardId || !childId) return fail(400, { error: 'ごほうびが指定されていません' });

		const result = await deleteReward(rewardId, childId, tenantId);
		if ('error' in result) {
			if (result.error === 'PENDING_REDEMPTION') {
				logger.info('[admin/rewards] pending redemption により削除拒否', {
					context: { rewardId, childId, tenantId },
				});
				return fail(409, { error: ADMIN_REWARDS_PAGE_LABELS.deletePendingBlocked });
			}
			return fail(404, { error: ADMIN_REWARDS_PAGE_LABELS.deleteFailed });
		}

		return { rewardDeleted: true };
	},

	addPreset: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはプリセットの取り込みも不可
		// #787: PlanLimitError 形式に統一
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? 'other');

		if (!title || points <= 0) return fail(400, { error: 'プリセットデータが不正です' });

		const existing = await getRewardTemplates(tenantId);
		if (existing.some((t) => t.title === title)) {
			return { presetAdded: true };
		}

		const newTemplate: RewardTemplate = {
			title,
			points,
			icon,
			category: category as RewardTemplate['category'],
		};
		await saveRewardTemplates([...existing, newTemplate], tenantId);

		return { presetAdded: true };
	},

	// #2136 MP-1: マーケットプレイス reward-set 一括追加
	importMarketplaceRewardSet: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// プランゲート: 無料プランは特別ごほうび設定不可（grant と同等）
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const presetId = String(formData.get('presetId') ?? '').trim();
		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!presetId) return fail(400, { error: 'プリセットが指定されていません' });

		const item = getMarketplaceItem('reward-set', presetId);
		if (!item) {
			return fail(404, { error: `プリセット「${presetId}」が見つかりません` });
		}

		// #2366 (ADR-0052): Strategy + dispatchImport 経由でインポート。
		// requiresChildId=true の Descriptor が ctx.childId 必須を表明する。
		try {
			const result = await dispatchImport({
				typeCode: 'reward-set',
				rawPayload: item.payload,
				displayName: item.name,
				ctx: { tenantId, presetId, childId },
			});

			// #2391: UnifiedImportHub 互換の top-level shape で返却。
			// 旧 `marketplaceImport: {...}` shape は #2391 Phase 2 で撤去。
			// 全件重複の場合も imported=0, skipped=total で表現 (Hub 側が判定する)。
			return {
				packName: item.name,
				imported: result.imported,
				skipped: result.skipped,
				total: result.total,
				errors: result.errors,
				// #2955: 実失敗件数 (UI partial-failure 表示の SSOT)
				failed: result.failed,
				presetId,
			};
		} catch (e) {
			logger.error('[admin/rewards] marketplace reward-set インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId, childId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	// #2362 PR-4 (ADR-0055): per-child 取込 (ChildSelectionDialog から呼出)
	// `?import=<presetId>` query で auto-open した dialog で「全員 / 個別」選択 → 本 action に POST
	// childIds=all で全 child、childIds=1,2,3 で個別 child 配列
	//
	// CWE-598 防御 (PR #2474 QM Re-Review must-1 / Copilot must-3):
	//   childIds が tenant 配下 child の ID 集合に全て含まれることを assert。
	//   未含有 1 件で 403 fail (orphan reward / 兄弟外 IDOR を新設しない)。
	importPresetToChildren: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// プラン制限ガード (既存 form と同じ)
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const presetId = String(formData.get('presetId') ?? '').trim();
		const childIdsRaw = String(formData.get('childIds') ?? '').trim();

		if (!presetId) return fail(400, { error: 'プリセットが指定されていません' });
		if (!childIdsRaw) return fail(400, { error: '対象のお子さまを選択してください' });

		// 先に tenant 配下 child の ID 集合を取得 (childIds=all でも guard 後にも使う)
		const tenantChildren = await getAllChildren(tenantId);
		const allowedChildIdSet = new Set(tenantChildren.map((c) => c.id));

		// childIds: 'all' or comma-separated number list
		let childIds: number[];
		if (childIdsRaw === 'all') {
			childIds = tenantChildren.map((c) => c.id);
		} else {
			childIds = childIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		}
		if (childIds.length === 0) {
			return fail(400, { error: '有効な対象が指定されていません' });
		}

		// #2474 must-1 CWE-598 guard: tenant 外 child を 1 件でも含む場合は即 reject。
		// 'all' 経路は構造的に tenant 配下のみだが、明示的ユーザ指定 (CSV) で他 tenant ID を
		// 紛れ込ませた場合に orphan reward / IDOR にならないよう必ず検証する。
		const foreignChildIds = childIds.filter((id) => !allowedChildIdSet.has(id));
		if (foreignChildIds.length > 0) {
			logger.warn('[admin/rewards] tenant 外 child ID が importPresetToChildren に指定された', {
				context: { presetId, foreignChildIds, tenantId },
			});
			return fail(403, {
				error: '指定されたお子さまの一部が見つかりませんでした',
			});
		}

		// #2775 (Issue #2774 Phase 2): reward-set または rule-preset (exchange) を判別。
		// 同じ `?import=` query 経路で 2 type 取り込めるよう dispatcher を分岐する。
		const rewardSetItem = getMarketplaceItem('reward-set', presetId);
		const rulePresetItem = !rewardSetItem ? getMarketplaceItem('rule-preset', presetId) : null;
		if (!rewardSetItem && !rulePresetItem) {
			return fail(404, { error: `プリセット「${presetId}」が見つかりません` });
		}

		try {
			if (rewardSetItem) {
				// #2366 / PR-4: Strategy + dispatchImport 経由 (ctx.childIds で per-child fan-out)
				const result = await dispatchImport({
					typeCode: 'reward-set',
					rawPayload: rewardSetItem.payload,
					displayName: rewardSetItem.name,
					ctx: { tenantId, presetId, childIds },
				});
				return {
					perChildImport: true,
					packName: result.packName,
					imported: result.imported,
					skipped: result.skipped,
					total: result.total,
					errors: result.errors,
					// #2955: 実失敗件数 (UI partial-failure 表示の SSOT、errors.length は表示ログ専用)
					failed: result.failed,
					presetId,
				};
			}

			// rule-preset (exchange) 経路: special_rewards に childId 単位で挿入。
			// rulePresetStrategy.applyRulePreset を child ごとに呼出して fan-out する
			// (reward-set Strategy が built-in fan-out 持つのと異なり、rule-preset Strategy は
			//  single-child / single-tenant 単位で動作する設計のため、本 callsite で fan-out する)。
			// rulePresetItem は L289 の判定で non-null と確定済 (defensive guard for biome)
			if (!rulePresetItem) {
				return fail(404, { error: `プリセット「${presetId}」が見つかりません` });
			}
			const item = rulePresetItem;
			const payload = item.payload as Parameters<typeof rulePresetStrategy.applyRulePreset>[1];
			if (payload.ruleType !== 'exchange') {
				// exchange 以外は本画面の受領対象外 (server load の query validation で弾かれる想定だが防御)
				return fail(400, {
					error: 'このプリセットは exchange ruleType ではないため、本画面で取り込めません',
				});
			}
			const identity = {
				presetId: item.itemId,
				presetName: item.name,
				presetIcon: item.icon,
			};
			let totalImported = 0;
			let totalSkipped = 0;
			let totalFailed = 0;
			const allErrors: string[] = [];
			for (const childId of childIds) {
				const result = await rulePresetStrategy.applyRulePreset(identity, payload, {
					tenantId,
					childId,
				});
				totalImported += result.imported;
				totalSkipped += result.skipped;
				// #2955: 実失敗数は genuine errors のみで数える。warnings (already-imported 等の
				// 非失敗通知) は表示ログ (allErrors) には載せるが失敗件数に算入しない
				// (rule-preset-strategy.apply の errors/failed 非対称と同じ精度規約)。
				totalFailed += result.errors.length;
				allErrors.push(...result.errors, ...result.warnings);
			}
			return {
				perChildImport: true,
				packName: item.name,
				imported: totalImported,
				skipped: totalSkipped,
				total: totalImported + totalSkipped,
				errors: allErrors,
				failed: totalFailed,
				presetId,
			};
		} catch (e) {
			logger.error('[admin/rewards] per-child インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId, childIds },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	// #2362 PR-4 (ADR-0055): 「他の子供から copy」action
	// source child の reward 全件を target child (現在の表示 child) に複製
	// targetChildIds (CSV) 指定で複数 target にも一括複製可能 (兄弟全員に同期)
	//
	// CWE-598 防御 (PR #2474 QM Re-Review must-1 / Copilot must-4):
	//   source / target childId が tenant 配下 child の ID 集合に全て含まれることを assert。
	//   未含有 1 件で 403 fail (兄弟外 reward 漏洩 IDOR を新設しない)。
	copyFromChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// プラン制限ガード
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const sourceChildId = Number(formData.get('sourceChildId'));
		const targetChildIdsRaw = String(formData.get('targetChildIds') ?? '').trim();
		const singleTargetChildId = Number(formData.get('targetChildId'));

		if (!sourceChildId) {
			return fail(400, { error: 'コピー元のお子さまが必要です' });
		}

		let targetChildIds: number[] | null = null;
		if (targetChildIdsRaw) {
			targetChildIds = targetChildIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		} else if (singleTargetChildId) {
			targetChildIds = [singleTargetChildId];
		}

		if (!targetChildIds || targetChildIds.length === 0) {
			return fail(400, { error: 'コピー先のお子さまが必要です' });
		}

		// #2474 must-1 CWE-598 guard: tenant 配下 child ID 集合と source / target 全件を照合。
		// 兄弟以外への reward 複製を構造的に防ぐ。
		const tenantChildrenForCopy = await getAllChildren(tenantId);
		const allowedChildIdSetCopy = new Set(tenantChildrenForCopy.map((c) => c.id));
		const allChildIdsForCopy = [sourceChildId, ...targetChildIds];
		const foreignCopyChildIds = allChildIdsForCopy.filter((id) => !allowedChildIdSetCopy.has(id));
		if (foreignCopyChildIds.length > 0) {
			logger.warn('[admin/rewards] tenant 外 child ID が copyFromChild に指定された', {
				context: { sourceChildId, targetChildIds, foreignCopyChildIds, tenantId },
			});
			return fail(403, {
				error: '指定されたお子さまの一部が見つかりませんでした',
			});
		}

		try {
			const target = targetChildIds[0];
			if (targetChildIds.length === 1 && target !== undefined) {
				if (sourceChildId === target) {
					return fail(400, { error: '同じお子さまにはコピーできません' });
				}
				const copied = await copyChildRewardsToSibling(tenantId, sourceChildId, target);
				return { copyResult: true, copiedCount: copied };
			}
			const result = await copyChildRewardsToSiblings({
				tenantId,
				sourceChildId,
				targetChildIds,
			});
			if (result.errors.length > 0) {
				logger.warn('[admin/rewards] 兄弟へのコピーで partial failure', {
					context: { sourceChildId, errorCount: result.errors.length },
				});
			}
			return {
				copyResult: true,
				copiedCount: result.totalCopied,
				errorCount: result.errors.length,
			};
		} catch (e) {
			logger.error('[admin/rewards] copy 失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { sourceChildId, targetChildIds },
			});
			return fail(500, { error: 'コピーに失敗しました' });
		}
	},
};
