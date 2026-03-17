import { todayDateJST } from '$lib/domain/date-utils';
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
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();

	const childrenWithChecklists = children.map((child) => {
		const templates = findTemplatesByChild(child.id, true);
		const templatesWithItems = templates.map((tpl) => ({
			...tpl,
			items: findTemplateItems(tpl.id),
		}));
		const overrides = findOverrides(child.id, todayDateJST());
		return {
			...child,
			templates: templatesWithItems,
			overrides,
		};
	});

	return { children: childrenWithChecklists, today: todayDateJST() };
};

export const actions: Actions = {
	createTemplate: async ({ request }) => {
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const name = String(formData.get('name') ?? '').trim();
		const icon = String(formData.get('icon') ?? '📋').trim();

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!name) return fail(400, { error: '名前を入力してください' });

		createTemplate({ childId, name, icon });
		return { success: true };
	},

	toggleTemplate: async ({ request }) => {
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const isActive = Number(formData.get('isActive'));

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });

		editTemplate(templateId, { isActive: isActive ? 0 : 1 });
		return { success: true };
	},

	deleteTemplate: async ({ request }) => {
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });

		removeTemplate(templateId);
		return { success: true };
	},

	addItem: async ({ request }) => {
		const formData = await request.formData();
		const templateId = Number(formData.get('templateId'));
		const name = String(formData.get('name') ?? '').trim();
		const icon = String(formData.get('icon') ?? '🏫').trim();
		const frequency = String(formData.get('frequency') ?? 'daily');
		const direction = String(formData.get('direction') ?? 'bring');

		if (!templateId) return fail(400, { error: 'テンプレートIDが不正です' });
		if (!name) return fail(400, { error: 'アイテム名を入力してください' });

		addTemplateItem({ templateId, name, icon, frequency, direction });
		return { success: true };
	},

	removeItem: async ({ request }) => {
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));

		if (!itemId) return fail(400, { error: 'アイテムIDが不正です' });

		removeTemplateItem(itemId);
		return { success: true };
	},

	addOverride: async ({ request }) => {
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const targetDate = String(formData.get('targetDate') ?? '').trim();
		const action = String(formData.get('action') ?? 'add');
		const itemName = String(formData.get('itemName') ?? '').trim();
		const icon = String(formData.get('icon') ?? '📦').trim();

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!targetDate) return fail(400, { error: '日付を入力してください' });
		if (!itemName) return fail(400, { error: 'アイテム名を入力してください' });

		addOverride({ childId, targetDate, action, itemName, icon });
		return { success: true };
	},

	removeOverride: async ({ request }) => {
		const formData = await request.formData();
		const overrideId = Number(formData.get('overrideId'));

		if (!overrideId) return fail(400, { error: 'オーバーライドIDが不正です' });

		removeOverride(overrideId);
		return { success: true };
	},
};
