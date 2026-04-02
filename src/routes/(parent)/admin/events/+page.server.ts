import { requireTenantId } from '$lib/server/auth/factory';
import { deleteEvent } from '$lib/server/db/season-event-repo';
import { createEvent, editEvent, getAllEvents } from '$lib/server/services/season-event-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const events = await getAllEvents(tenantId);
	return { events };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const code = String(fd.get('code') ?? '').trim();
		const name = String(fd.get('name') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		const eventType = String(fd.get('eventType') ?? 'seasonal');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');
		const bannerIcon = String(fd.get('bannerIcon') ?? '🎉');
		const bannerColor = String(fd.get('bannerColor') ?? '').trim() || null;
		const rewardConfig = String(fd.get('rewardConfig') ?? '').trim() || null;

		if (!code) return fail(400, { error: 'コードを入力してください' });
		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!startDate || !endDate) return fail(400, { error: '開始日・終了日を入力してください' });
		if (startDate > endDate) return fail(400, { error: '終了日は開始日以降にしてください' });

		try {
			await createEvent(
				{
					code,
					name,
					description,
					eventType,
					startDate,
					endDate,
					bannerIcon,
					bannerColor,
					rewardConfig,
				},
				tenantId,
			);
			return { created: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'イベント作成に失敗しました' });
		}
	},

	update: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		const name = String(fd.get('name') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');
		const bannerIcon = String(fd.get('bannerIcon') ?? '🎉');
		const bannerColor = String(fd.get('bannerColor') ?? '').trim() || null;
		const isActive = fd.get('isActive') === 'on' ? 1 : 0;
		const rewardConfig = String(fd.get('rewardConfig') ?? '').trim() || null;

		if (!id) return fail(400, { error: 'IDが不正です' });

		await editEvent(
			id,
			{ name, description, startDate, endDate, bannerIcon, bannerColor, isActive, rewardConfig },
			tenantId,
		);
		return { updated: true };
	},

	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'IDが不正です' });

		await deleteEvent(id, tenantId);
		return { deleted: true };
	},
};
