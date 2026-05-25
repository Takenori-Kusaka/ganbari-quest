import { fail } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { todayDateJST } from '$lib/domain/date-utils';
import { createPlanLimitError } from '$lib/domain/errors';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import type { ChecklistPayload } from '$lib/domain/marketplace-item';
// #2367 (EPIC #2362 P3): checklist 経路は dispatchImport 経由 (Strangler Fig)
// #2402 QM must-2: `marketplaceRegistry` 直接参照は dispatchImport API で代替済、import 撤去
import { dispatchImport } from '$lib/marketplace';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	findAssignmentsByTemplate,
	findOverrides,
	findTemplateItems,
	findTemplatesByTenant,
	findTodayLog,
} from '$lib/server/db/checklist-repo';
import { logger } from '$lib/server/logger';
import { syncDistribution } from '$lib/server/services/checklist-distribution-service';
import {
	addOverride,
	addTemplateItem,
	createTemplate,
	editTemplate,
	removeOverride,
	removeTemplate,
	removeTemplateItem,
	VALID_TIME_SLOTS,
} from '$lib/server/services/checklist-service';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	checkChecklistTemplateLimit,
	getPlanLimits,
	isPaidTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import type { Action, Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	const today = todayDateJST();

	// #2362 PR-5 Phase 2 (ADR-0055): family checklist 一覧 + 配信先 children + per-child progress
	const familyTemplatesRaw = await findTemplatesByTenant(tenantId, true);
	const familyTemplates = await Promise.all(
		familyTemplatesRaw.map(async (tpl) => {
			const items = await findTemplateItems(tpl.id, tenantId);
			const assignments = await findAssignmentsByTemplate(tpl.id, tenantId);
			// per-child progress: 配信中 child ごとに今日の log を取得
			const perChildProgress = await Promise.all(
				assignments.map(async (a) => {
					const log = await findTodayLog(a.childId, tpl.id, today, tenantId);
					const checkedIds = log ? (JSON.parse(log.itemsJson) as number[]) : [];
					const child = children.find((c) => c.id === a.childId);
					return {
						childId: a.childId,
						childName: child?.nickname ?? `#${a.childId}`,
						checkedCount: checkedIds.length,
						totalCount: items.length,
						completedAll: log?.completedAll === 1,
					};
				}),
			);
			return {
				...tpl,
				items,
				assignedChildIds: assignments.map((a) => a.childId),
				perChildProgress,
			};
		}),
	);

	// 旧 per-child legacy 経路 (admin UI の child 別タブ + override) 維持: family scope で
	// findAssignmentsByChild ベースに置換える代わりに、family scope の overrides を child 別に並べる。
	const childrenWithOverrides = await Promise.all(
		children.map(async (child) => {
			const overrides = await findOverrides(child.id, today, tenantId);
			return { ...child, overrides };
		}),
	);

	const tier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	const isPremium = isPaidTier(tier);
	// #723: UI 側で「残り何個作れるか」を表示するための上限情報
	const checklistTemplateMax = getPlanLimits(tier).maxChecklistTemplates;

	// #2137 (MP-2): マーケットプレイス checklist preset (event-* 3 件) を一覧化
	// childrenWithChecklists.sourcePresetId と突き合わせて「取込済」判定を UI で行う
	const marketplaceChecklists = getMarketplaceIndex()
		.filter((m) => m.type === 'checklist')
		.map((m) => ({
			itemId: m.itemId,
			name: m.name,
			description: m.description,
			icon: m.icon,
			targetAgeMin: m.targetAgeMin,
			targetAgeMax: m.targetAgeMax,
			tags: m.tags,
			itemCount: m.itemCount,
		}));

	// #2362 PR-5 Phase 2: `?import=<presetId>` query で ChecklistDistributionDialog auto-open
	const importPresetIdRaw = url.searchParams.get('import')?.trim() || null;
	const importPresetId =
		importPresetIdRaw && getMarketplaceItem('checklist', importPresetIdRaw)
			? importPresetIdRaw
			: null;
	const importPresetInvalid = Boolean(importPresetIdRaw) && !importPresetId;

	return {
		children: childrenWithOverrides,
		familyTemplates,
		today,
		isPremium,
		checklistTemplateMax,
		marketplaceChecklists,
		importPresetId,
		importPresetInvalid,
	};
};

// #2391 (Phase 2): UnifiedImportHub 規約 (`?/importMarketplace<TypeCode>`) に合わせ
// `importMarketplaceChecklist` を実装。後方互換のため旧 `?/importMarketplace` も同一 handler を
// 両 action 名から参照させる。alias 後付け (`actions.importMarketplace = actions.importMarketplaceChecklist`)
// は Actions 型 (optional プロパティ無し) と衝突して svelte-check error になるため、
// handler 変数を括り出してから `Actions` リテラル内で 2 つの名前にバインドする。
const importMarketplaceChecklistAction: Action = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	const formData = await request.formData();
	const childId = Number(formData.get('childId'));
	const presetId = String(formData.get('presetId') ?? '').trim();

	if (!childId) return fail(400, { error: 'こどもを選択してください' });
	if (!presetId) return fail(400, { error: 'プリセットIDが必要です' });

	// プラン制限 (Free プランのテンプレート数)
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const limit = await checkChecklistTemplateLimit(tenantId, licenseStatus, childId);
	if (!limit.allowed) {
		const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
		return fail(403, {
			error: createPlanLimitError(
				tier,
				'standard',
				`フリープランではお子さま1人あたり ${limit.max} 個までです。スタンダード以上にアップグレードすると無制限に作成できます。`,
			),
			upgradeRequired: true,
		});
	}

	// #2367: checklist は dispatchImport 経由 (EPIC #2362 P3)
	// #2402 QM must-2: 旧来 `(strategy as any).parse/preview` で全件重複判定を別途呼んでいたが、
	// dispatchImport の戻り値 (imported / skipped / total) から「全件重複」を同等に判定可能。
	// Registry 内部 (`ImportStrategy<unknown>`) への `as any` cast 不要化 + biome-ignore 削減 +
	// parse/preview/apply の重複実行 (二重 DB read) も解消。
	const item = getMarketplaceItem('checklist', presetId);
	if (!item) {
		return fail(404, { error: 'プリセットが見つかりません' });
	}
	const payload = item.payload as ChecklistPayload;
	try {
		const result = await dispatchImport({
			typeCode: 'checklist',
			rawPayload: payload,
			displayName: item.name,
			ctx: {
				tenantId,
				presetId,
				childId,
			},
		});
		// #2391 / #2402: UnifiedImportHub 互換 top-level shape。
		// 全件重複の場合 (`imported === 0 && skipped === total && total > 0`) も
		// 同 shape で返るため UI 側 (`UnifiedImportHub.svelte`) で分岐表示できる。
		return {
			packName: result.packName,
			imported: result.imported,
			skipped: result.skipped,
			total: result.total,
			errors: result.errors,
			presetId,
		};
	} catch (e) {
		logger.error('[admin/checklists] マーケットプレイスインポート失敗', {
			error: e instanceof Error ? e.message : String(e),
			context: { presetId, childId },
		});
		return fail(500, { error: 'インポートに失敗しました' });
	}
};

export const actions: Actions = {
	createTemplate: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const name = String(formData.get('name') ?? '').trim();
		const icon = String(formData.get('icon') ?? '📋').trim();

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!name) return fail(400, { error: '名前を入力してください' });

		const timeSlot = String(formData.get('timeSlot') ?? 'anytime').trim();
		if (!(VALID_TIME_SLOTS as readonly string[]).includes(timeSlot))
			return fail(400, { error: '時間帯が不正です' });

		// #1755 (#1709-A): kind 削除 — 持ち物純化（旧 'routine' は activities.priority='must' に役割移管）

		// #723: Free プランの上限チェック（UI ゲートをバイパスした直接 POST を防ぐ）
		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const limit = await checkChecklistTemplateLimit(tenantId, licenseStatus, childId);
		if (!limit.allowed) {
			// #787: PlanLimitError 形式に統一。tier は memoize 済み (#788) なので 2 回目の呼び出しは安い
			const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'standard',
					`フリープランではお子さま1人あたり ${limit.max} 個までです。スタンダード以上にアップグレードすると無制限に作成できます。`,
				),
				upgradeRequired: true,
			});
		}

		await createTemplate({ childId, name, icon, timeSlot }, tenantId);
		return { success: true };
	},

	updateTimeSlot: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const timeSlot = String(formData.get('timeSlot') ?? 'anytime').trim();

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });
		if (!(VALID_TIME_SLOTS as readonly string[]).includes(timeSlot))
			return fail(400, { error: '時間帯が不正です' });

		await editTemplate(templateId, { timeSlot }, tenantId);
		return { success: true };
	},

	toggleTemplate: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const isActive = Number(formData.get('isActive'));

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });

		await editTemplate(templateId, { isActive: isActive ? 0 : 1 }, tenantId);
		return { success: true };
	},

	deleteTemplate: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });

		await removeTemplate(templateId, tenantId);
		return { success: true };
	},

	addItem: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const name = String(formData.get('name') ?? '').trim();
		const icon = String(formData.get('icon') ?? '🏫').trim();
		const frequency = String(formData.get('frequency') ?? 'daily');
		const direction = String(formData.get('direction') ?? 'bring');

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });
		if (!name) return fail(400, { error: 'アイテム名を入力してください' });

		await addTemplateItem({ templateId, name, icon, frequency, direction }, tenantId);
		return { success: true };
	},

	removeItem: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));

		if (!itemId) return fail(400, { error: 'アイテムIDが不正です' });

		await removeTemplateItem(itemId, tenantId);
		return { success: true };
	},

	addOverride: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const targetDate = String(formData.get('targetDate') ?? '').trim();
		const action = String(formData.get('action') ?? 'add');
		const itemName = String(formData.get('itemName') ?? '').trim();
		const icon = String(formData.get('icon') ?? '📦').trim();

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!targetDate) return fail(400, { error: '日付を入力してください' });
		if (!itemName) return fail(400, { error: 'アイテム名を入力してください' });

		await addOverride({ childId, targetDate, action, itemName, icon }, tenantId);
		return { success: true };
	},

	removeOverride: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const overrideId = Number(formData.get('overrideId'));

		if (!overrideId) return fail(400, { error: 'オーバーライドIDが不正です' });

		await removeOverride(overrideId, tenantId);
		return { success: true };
	},

	// #720: AI提案からテンプレート+アイテムを一括作成
	createFromAi: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
		if (tier !== 'family') {
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'family',
					PLAN_GATE_LABELS.familyOnlyFor('AI チェックリスト提案'),
				),
			});
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const templateName = String(formData.get('templateName') ?? '').trim();
		const templateIcon = String(formData.get('templateIcon') ?? '📋').trim();
		const itemsJson = String(formData.get('items') ?? '[]');

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!templateName) return fail(400, { error: 'テンプレート名が必要です' });

		// JSON パース + バリデーションを DB 作成前に実行（パース失敗時に空テンプレートが残る問題を防ぐ）
		let items: { name: string; icon: string; frequency: string; direction: string }[];
		try {
			const parsed = JSON.parse(itemsJson);
			if (!Array.isArray(parsed)) {
				return fail(400, { error: 'items must be an array' });
			}
			items = parsed;
		} catch {
			return fail(400, { error: 'items must be an array' });
		}

		const limit = await checkChecklistTemplateLimit(tenantId, licenseStatus, childId);
		if (!limit.allowed) {
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'standard',
					`フリープランではお子さま1人あたり ${limit.max} 個までです。`,
				),
			});
		}

		const template = await createTemplate(
			{ childId, name: templateName, icon: templateIcon, timeSlot: 'anytime' },
			tenantId,
		);

		for (const item of items.slice(0, 15)) {
			await addTemplateItem(
				{
					templateId: template.id,
					name: String(item.name ?? '').slice(0, 50),
					icon: String(item.icon ?? '📦'),
					frequency: String(item.frequency ?? 'daily'),
					direction: String(item.direction ?? 'both'),
				},
				tenantId,
			);
		}

		return { success: true, aiCreated: true };
	},

	// #2137 (MP-2): マーケットプレイス event-checklist の一括追加
	// #2391 (Phase 2): UnifiedImportHub 規約 (`?/importMarketplace<TypeCode>`) に合わせ
	// `importMarketplaceChecklist` を実装。後方互換のため旧 `?/importMarketplace` も
	// 同一 handler (`importMarketplaceChecklistAction`) を両 action 名から参照させる。
	// 既存 E2E spec (admin-checklists-import-marketplace / marketplace-checklist-import) が
	// `?/importMarketplace` を呼ぶ互換性をテンポラリに維持するため、両エントリを用意。
	importMarketplaceChecklist: importMarketplaceChecklistAction,
	importMarketplace: importMarketplaceChecklistAction,

	// #2362 PR-5 Phase 2 (ADR-0055): family scope 取込 + 配信先 children 指定
	// ChecklistDistributionDialog (auto-open `?import=<presetId>`) から呼ばれる action。
	// childIds: 'all' (全 child 配信) or CSV 'id1,id2,id3' (個別配信) を受け取る。
	//
	// CWE-598 防御 (PR-4 reward-set 同型 / Copilot must-3):
	//   childIds が tenant 配下 child の ID 集合に全て含まれることを assert。
	//   未含有 1 件で 403 fail (cross-tenant child IDOR 防止)。
	importPresetToChildren: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const presetId = String(formData.get('presetId') ?? '').trim();
		const childIdsRaw = String(formData.get('childIds') ?? '').trim();

		if (!presetId) return fail(400, { error: 'プリセットが指定されていません' });

		// プラン制限 (Free プランのテンプレート数、per-child quota: LP「3個/子まで」と整合)
		// 配信先 child 0 件でも family template 自体は作成可能 (後で distribution 編集)
		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const tenantChildren = await getAllChildren(tenantId);
		// 配信先 child が指定済みなら各 child の per-child quota を事前確認
		const childIdsForLimitCheck =
			childIdsRaw === 'all'
				? tenantChildren.map((c) => c.id)
				: childIdsRaw === ''
					? []
					: childIdsRaw
							.split(',')
							.map((s) => Number(s.trim()))
							.filter((n) => Number.isInteger(n) && n > 0);
		for (const cId of childIdsForLimitCheck) {
			const limit = await checkChecklistTemplateLimit(tenantId, licenseStatus, cId);
			if (!limit.allowed) {
				const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
				return fail(403, {
					error: createPlanLimitError(
						tier,
						'standard',
						`フリープランではお子さま1人あたり ${limit.max} 個までです。スタンダード以上にアップグレードすると無制限に作成できます。`,
					),
					upgradeRequired: true,
				});
			}
		}

		// childIds: 'all' or comma-separated number list ('' で配信先未指定 = template のみ作成)
		const allowedChildIdSet = new Set(tenantChildren.map((c) => c.id));
		let childIds: number[];
		if (childIdsRaw === 'all') {
			childIds = tenantChildren.map((c) => c.id);
		} else if (childIdsRaw === '') {
			childIds = [];
		} else {
			childIds = childIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		}

		// CWE-598 guard: tenant 外 child を 1 件でも含む場合は即 reject
		const foreignChildIds = childIds.filter((id) => !allowedChildIdSet.has(id));
		if (foreignChildIds.length > 0) {
			logger.warn('[admin/checklists] tenant 外 child ID が importPresetToChildren に指定された', {
				context: { presetId, foreignChildIds, tenantId },
			});
			return fail(403, {
				error: '指定されたお子さまの一部が見つかりませんでした',
			});
		}

		const item = getMarketplaceItem('checklist', presetId);
		if (!item) {
			return fail(404, { error: `プリセット「${presetId}」が見つかりません` });
		}
		const payload = item.payload as ChecklistPayload;

		try {
			const result = await dispatchImport({
				typeCode: 'checklist',
				rawPayload: payload,
				displayName: item.name,
				ctx: {
					tenantId,
					presetId,
					childIds,
				},
			});
			return {
				perChildImport: true,
				packName: result.packName,
				imported: result.imported,
				skipped: result.skipped,
				total: result.total,
				errors: result.errors,
				presetId,
				distributedCount: childIds.length,
			};
		} catch (e) {
			logger.error('[admin/checklists] family scope import 失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId, childIds },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	// #2362 PR-5 Phase 2 (ADR-0055): family checklist の配信先 children を同期
	// ChecklistDistributionDialog の「配信先を保存」ボタンから呼ばれる action。
	// childIds: 'all' or CSV 'id1,id2,id3' を受け取り、現在の配信先と差分計算して add/remove。
	syncDistribution: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const childIdsRaw = String(formData.get('childIds') ?? '').trim();

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });

		const tenantChildren = await getAllChildren(tenantId);
		const allowedChildIdSet = new Set(tenantChildren.map((c) => c.id));

		let desiredChildIds: number[];
		if (childIdsRaw === 'all') {
			desiredChildIds = tenantChildren.map((c) => c.id);
		} else if (childIdsRaw === '') {
			desiredChildIds = [];
		} else {
			desiredChildIds = childIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		}

		// CWE-598 guard
		const foreignChildIds = desiredChildIds.filter((id) => !allowedChildIdSet.has(id));
		if (foreignChildIds.length > 0) {
			logger.warn('[admin/checklists] tenant 外 child ID が syncDistribution に指定された', {
				context: { templateId, foreignChildIds, tenantId },
			});
			return fail(403, {
				error: '指定されたお子さまの一部が見つかりませんでした',
			});
		}

		try {
			const result = await syncDistribution(templateId, desiredChildIds, tenantId);
			return {
				distributionSynced: true,
				templateId,
				added: result.added.length,
				removed: result.removed.length,
			};
		} catch (e) {
			logger.error('[admin/checklists] 配信先同期失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { templateId, desiredChildIds },
			});
			return fail(500, { error: '配信先の同期に失敗しました' });
		}
	},
};
