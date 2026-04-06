import { fail } from '@sveltejs/kit';
import { todayDateJST } from '$lib/domain/date-utils';
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
} from '$lib/server/services/checklist-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
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

	const isPremium = isPaidTier(
		await resolveFullPlanTier(
			tenantId,
			locals.context?.licenseStatus ?? 'none',
			locals.context?.plan,
		),
	);

	return { children: childrenWithChecklists, today: todayDateJST(), isPremium };
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
		const validSlots = ['morning', 'afternoon', 'evening', 'anytime'];
		if (!validSlots.includes(timeSlot)) return fail(400, { error: '時間帯が不正です' });

		await createTemplate({ childId, name, icon, timeSlot }, tenantId);
		return { success: true };
	},

	updateTimeSlot: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const timeSlot = String(formData.get('timeSlot') ?? 'anytime').trim();

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });
		const validSlots = ['morning', 'afternoon', 'evening', 'anytime'];
		if (!validSlots.includes(timeSlot)) return fail(400, { error: '時間帯が不正です' });

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
};
