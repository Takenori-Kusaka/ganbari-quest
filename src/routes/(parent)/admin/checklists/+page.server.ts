import { fail } from '@sveltejs/kit';
import { todayDateJST } from '$lib/domain/date-utils';
import { createPlanLimitError } from '$lib/domain/errors';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	findOverrides,
	findTemplateItems,
	findTemplatesByChild,
} from '$lib/server/db/checklist-repo';
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
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const childrenWithChecklists = await Promise.all(
		children.map(async (child) => {
			const templates = await findTemplatesByChild(child.id, tenantId, true);
			const templatesWithItems = await Promise.all(
				templates.map(async (tpl) => ({
					...tpl,
					items: await findTemplateItems(tpl.id, tenantId),
				})),
			);
			const overrides = await findOverrides(child.id, todayDateJST(), tenantId);
			return {
				...child,
				templates: templatesWithItems,
				overrides,
			};
		}),
	);

	const tier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
	);
	const isPremium = isPaidTier(tier);
	// #723: UI 側で「残り何個作れるか」を表示するための上限情報
	const checklistTemplateMax = getPlanLimits(tier).maxChecklistTemplates;

	return {
		children: childrenWithChecklists,
		today: todayDateJST(),
		isPremium,
		checklistTemplateMax,
	};
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

		// #723: Free プランの上限チェック（UI ゲートをバイパスした直接 POST を防ぐ）
		const licenseStatus = locals.context?.licenseStatus ?? 'none';
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

		const licenseStatus = locals.context?.licenseStatus ?? 'none';
		const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', 'AI チェックリスト提案はスタンダードプラン以上でご利用いただけます'),
			});
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const templateName = String(formData.get('templateName') ?? '').trim();
		const templateIcon = String(formData.get('templateIcon') ?? '📋').trim();
		const itemsJson = String(formData.get('items') ?? '[]');

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!templateName) return fail(400, { error: 'テンプレート名が必要です' });

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

		let items: { name: string; icon: string; frequency: string; direction: string }[];
		try {
			items = JSON.parse(itemsJson);
		} catch {
			items = [];
		}

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
};
