// admin/challenges/+page.server.ts
// per-child チャレンジ管理 + 兄弟連動表示 (#2362 PR-7、ADR-0055、User §6)
//
// 旧 family-wide sibling_challenges (createSiblingChallenge → 全員自動 enroll) は
// 並存維持 (sibling-challenge-service が継続稼働、cleanup は #2458)。
// 本 page は新 child_challenges (per-child instance) を SSOT として扱う。

import { fail } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import type { ChallengeSetPayload } from '$lib/domain/marketplace-item';
import { dispatchImport } from '$lib/marketplace';
import { loadFromMarketplace } from '$lib/marketplace/sources/marketplace-source';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { copyChildChallengesToSiblings } from '$lib/server/services/child-challenge-copy-service';
import {
	buildPerChildTargets,
	createChildChallenge,
	createChildChallengesBulk,
	deleteChildChallenge,
	getChallengeGroupsForAdmin,
} from '$lib/server/services/child-challenge-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);

	const [challengeGroups, children, familyStreakData] = await Promise.all([
		getChallengeGroupsForAdmin(tenantId),
		getAllChildren(tenantId),
		getFamilyStreak(tenantId),
	]);

	const familyStreak = {
		...familyStreakData,
		nextMilestone: getNextMilestone(familyStreakData.currentStreak),
	};

	// 子供別タブ切替 (?childId=N、未指定なら 'all')
	const childIdParam = url.searchParams.get('childId');
	const selectedChildId =
		childIdParam && childIdParam !== 'all' ? Number(childIdParam) : ('all' as const);

	// 取込時 ChildSelectionDialog auto-open (#2362 PR-7, CWE-598)
	// #2774: 5 type 取込 CTA 統一 — `?import=<presetId>` query 一本化 (User 指摘 #2 #4 根治)。
	// 旧 `?marketplace-import=` 名は廃止 (marketplace-import-flow.md §3.1)。
	// rewards / activities / checklists / settings/rules 同型の正規 query 名に統一。
	const importPresetIdRaw = url.searchParams.get('import')?.trim() || null;
	let marketplaceImport: {
		presetId: string;
		presetName: string;
		presetDescription: string;
		challenges: ChallengeSetPayload['challenges'];
	} | null = null;
	if (importPresetIdRaw) {
		const item = getMarketplaceItem('challenge-set', importPresetIdRaw);
		if (item) {
			const payload = item.payload as ChallengeSetPayload;
			marketplaceImport = {
				presetId: item.itemId,
				presetName: item.name,
				presetDescription: item.description,
				challenges: payload.challenges,
			};
		}
	}

	// #2554 follow-up CUJ-CH2 完全化: ChildSelectionDialog auto-open trigger
	// (admin-rewards `?import=` 経路と同型、ADR-0055 per-child fan-out + CWE-598 guard 整合)
	const importPresetId = marketplaceImport ? marketplaceImport.presetId : null;
	const importPresetInvalid = Boolean(importPresetIdRaw) && !importPresetId;

	// #2558 段階2 横展開: admin 内 marketplace 風 in-page browse UI を撤去し
	// `/marketplace?type=challenge-set` へ画面遷移する方式に統一 (DESIGN.md §10 構造的ルール
	// 「marketplace 取込はマーケットプレイス画面に一本化、admin 内ブラウズ UI 二重管理禁止」)。
	// 旧 `challengePresets` (UnifiedImportHub feed) は本 page で未参照になったため load 出力から削除。
	// 取込実行は marketplace 詳細 → `?import=<presetId>` → ChildSelectionDialog
	// auto-open の正規経路 (marketplace-import-flow.md §3.1、#2774 で 5 type 統一) に合流させる。

	return {
		challengeGroups,
		children,
		planTier,
		familyStreak,
		marketplaceImport,
		selectedChildId,
		// #2554 follow-up CUJ-CH2: dialog auto-open trigger 用 (rewards 同型)
		importPresetId,
		importPresetInvalid,
	};
};

export const actions: Actions = {
	// 単一 child に 1 challenge 作成 (admin form)
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: form 検証 + JSON 組立 + insert で複雑度 24、可読性のため fragment 分離せず維持
	create: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const childId = Number(fd.get('childId'));
		const title = String(fd.get('title') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		// #2296 (EPIC #2294 ②): cooperative 固定 (新規作成、競争禁止)
		const challengeType = 'cooperative';
		const periodType = String(fd.get('periodType') ?? 'weekly');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');
		const metric = String(fd.get('metric') ?? 'count');
		const baseTarget = Number(fd.get('baseTarget') ?? 3);
		const categoryIdStr = String(fd.get('categoryId') ?? '');
		const categoryId = categoryIdStr ? Number(categoryIdStr) : undefined;
		const rewardPoints = Number(fd.get('rewardPoints') ?? 50);
		const rewardMessage = String(fd.get('rewardMessage') ?? '').trim() || undefined;

		if (!childId) return fail(400, { error: 'お子さまを選択してください' });
		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (!startDate || !endDate) return fail(400, { error: '開始日・終了日を入力してください' });
		if (startDate > endDate) return fail(400, { error: '終了日は開始日以降にしてください' });
		if (baseTarget < 1) return fail(400, { error: '目標回数は1以上にしてください' });

		const targetConfig = JSON.stringify({
			metric,
			baseTarget,
			...(categoryId ? { categoryId } : {}),
		});
		const rewardConfig = JSON.stringify({
			points: rewardPoints,
			...(rewardMessage ? { message: rewardMessage } : {}),
		});

		try {
			await createChildChallenge(
				{
					childId,
					title,
					description,
					challengeType,
					periodType,
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
					targetValue: baseTarget,
				},
				tenantId,
			);
			return { created: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'チャレンジ作成に失敗しました' });
		}
	},

	// 一括追加 (複数 child に同じ challenge を同時 instance 化、兄弟連動デモ向け)
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: form 検証 + JSON 組立 + bulk insert で複雑度 25、create と対称形のため分離せず維持
	bulkCreate: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const childIdsRaw = fd
			.getAll('childIds')
			.map((v) => Number(v))
			.filter((n) => !Number.isNaN(n));
		if (childIdsRaw.length === 0)
			return fail(400, { error: '対象お子さまを 1 名以上選択してください' });

		const title = String(fd.get('title') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		const periodType = String(fd.get('periodType') ?? 'weekly');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');
		const metric = String(fd.get('metric') ?? 'count');
		const baseTarget = Number(fd.get('baseTarget') ?? 3);
		const categoryIdStr = String(fd.get('categoryId') ?? '');
		const categoryId = categoryIdStr ? Number(categoryIdStr) : undefined;
		const rewardPoints = Number(fd.get('rewardPoints') ?? 50);
		const rewardMessage = String(fd.get('rewardMessage') ?? '').trim() || undefined;
		const sourceTemplateId =
			String(fd.get('sourceTemplateId') ?? '').trim() || `bulk:${Date.now()}`;

		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (!startDate || !endDate) return fail(400, { error: '開始日・終了日を入力してください' });
		if (baseTarget < 1) return fail(400, { error: '目標回数は1以上にしてください' });

		const targetConfig = JSON.stringify({
			metric,
			baseTarget,
			...(categoryId ? { categoryId } : {}),
		});
		const rewardConfig = JSON.stringify({
			points: rewardPoints,
			...(rewardMessage ? { message: rewardMessage } : {}),
		});

		const perChildTargets = await buildPerChildTargets(
			baseTarget,
			undefined,
			childIdsRaw,
			tenantId,
		);

		try {
			const created = await createChildChallengesBulk(
				{
					title,
					description,
					challengeType: 'cooperative',
					periodType,
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
					sourceTemplateId,
					perChildTargets,
				},
				childIdsRaw,
				tenantId,
			);
			return { bulkCreated: created.length };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : '一括作成に失敗しました' });
		}
	},

	// 1 instance 削除
	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'IDが不正です' });
		await deleteChildChallenge(id, tenantId);
		return { deleted: true };
	},

	// cross-child copy (source 1 名 → targets 複数名)
	copyToSiblings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const sourceChildId = Number(fd.get('sourceChildId'));
		const targetChildIds = fd
			.getAll('targetChildIds')
			.map((v) => Number(v))
			.filter((n) => !Number.isNaN(n));
		if (!sourceChildId) return fail(400, { error: 'コピー元のお子さまが必要です' });
		if (targetChildIds.length === 0)
			return fail(400, { error: 'コピー先のお子さまを 1 名以上選択してください' });

		const result = await copyChildChallengesToSiblings({
			tenantId,
			sourceChildId,
			targetChildIds,
		});
		return {
			copyResult: {
				totalCopied: result.totalCopied,
				byTargetChild: result.byTargetChild,
				errorCount: result.errors.length,
			},
		};
	},

	// marketplace 取込 (per-child 配信、CWE-598: childIds は body のみ・URL に出さない)
	// #2402 QM must-3 (OWASP A01) family-only gate を維持 (LP/pricing 整合性は別 PR で判断)
	importMarketplaceChallengeSet: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
		if (tier !== 'family') {
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'family',
					PLAN_GATE_LABELS.familyOnlyFor('きょうだいチャレンジ'),
				),
			});
		}

		const fd = await request.formData();
		const presetId = String(fd.get('presetId') ?? '').trim();
		if (!presetId) return fail(400, { error: 'presetId が必要です' });

		// #2362 PR-7: per-child 配信 (childIds body 必須、URL には出さない = CWE-598)
		// #2554 follow-up CUJ-CH2 完全化: ChildSelectionDialog からの POST は CSV (`childIds=1,2,3`) or
		// `'all'` 形式を許容 (admin-rewards `importPresetToChildren` 同型)。
		// UnifiedImportHub から直接 POST する旧経路 (childIds repeated form field) も後方互換維持。
		//
		// 解析戦略:
		//   1. `getAll('childIds')` で複数値が来た = UnifiedImportHub 旧 repeated form 経路
		//   2. 単一値で `'all'` = ChildSelectionDialog の「全員に追加」
		//   3. 単一値で CSV ('1,2,3') = ChildSelectionDialog の個別選択
		//   4. 単一値で純数値 = (CSV と同形だが要素 1 件)
		const childIdsRawAll = fd.getAll('childIds');
		const childIdsSingle = String(childIdsRawAll[0] ?? '').trim();
		// tenantChildren は CWE-598 guard と 'all' 経路の両方で参照する。
		const tenantChildren = (await getAllChildren(tenantId)) ?? [];
		const allowedChildIdSet = new Set(tenantChildren.map((c) => c.id));
		let childIds: number[];
		if (childIdsRawAll.length > 1) {
			// 経路 1: 後方互換 repeated form (UnifiedImportHub の旧 multipart)
			childIds = childIdsRawAll.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
		} else if (childIdsSingle === 'all') {
			// 経路 2: ChildSelectionDialog 「全員に追加」
			childIds = tenantChildren.map((c) => c.id);
		} else if (childIdsSingle.length > 0) {
			// 経路 3/4: CSV or 単一 numeric (ChildSelectionDialog 個別、admin-rewards 同型)
			childIds = childIdsSingle
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		} else {
			childIds = [];
		}
		if (childIds.length === 0) {
			return fail(400, { error: 'お子さまを 1 名以上選択してください' });
		}

		// #2554 follow-up CUJ-CH2 / PR #2474 CWE-598 guard 整合:
		// 'all' 経路は構造的に tenant 配下のみだが、明示的ユーザ指定 (CSV / repeated) で他 tenant ID を
		// 紛れ込ませた場合に orphan challenge / IDOR にならないよう必ず検証する。
		// 'all' 経路は tenantChildren から構築済のため skip 可能 (tenant 集合 = childIds)。
		if (childIdsSingle !== 'all') {
			const foreignChildIds = childIds.filter((id) => !allowedChildIdSet.has(id));
			if (foreignChildIds.length > 0) {
				logger.warn(
					'[admin/challenges] tenant 外 child ID が importMarketplaceChallengeSet に指定された',
					{
						context: { presetId, foreignChildIds, tenantId },
					},
				);
				return fail(403, {
					error: '指定されたお子さまの一部が見つかりませんでした',
				});
			}
		}

		try {
			const source = loadFromMarketplace('challenge-set', presetId);
			const result = await dispatchImport({
				typeCode: 'challenge-set',
				rawPayload: source.payload,
				displayName: source.displayName,
				ctx: { tenantId, presetId, childIds },
			});
			return {
				packName: result.packName,
				imported: result.imported,
				skipped: result.skipped,
				total: result.total,
				errors: result.errors,
				presetId,
			};
		} catch (e) {
			if (e instanceof Error && e.message.includes('not found in marketplace SSOT')) {
				return fail(404, { error: 'チャレンジ集が見つかりません' });
			}
			logger.error('[admin/challenges] importMarketplaceChallengeSet 失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId, childCount: childIds.length },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
