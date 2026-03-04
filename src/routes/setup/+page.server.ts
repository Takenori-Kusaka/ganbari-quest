import { pinSchema } from '$lib/domain/validation/auth';
import { getSetting } from '$lib/server/db/settings-repo';
import { setupPin } from '$lib/server/services/auth-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	// PIN already set -> skip to step 2
	const pinHash = getSetting('pin_hash');
	if (pinHash) {
		redirect(302, '/setup/children');
	}
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const pin = formData.get('pin')?.toString() ?? '';
		const confirmPin = formData.get('confirmPin')?.toString() ?? '';

		const parsed = pinSchema.safeParse(pin);
		if (!parsed.success) {
			const msg = parsed.error.errors[0]?.message ?? 'PINの形式が不正です';
			return fail(400, { error: msg });
		}

		if (pin !== confirmPin) {
			return fail(400, { error: 'PINが一致しません' });
		}

		setupPin(parsed.data);
		redirect(302, '/setup/children');
	},
};
