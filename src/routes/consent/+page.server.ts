// /consent — 規約再同意ページ (#0192)

import { getAuthMode } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	CURRENT_PRIVACY_VERSION,
	CURRENT_TERMS_VERSION,
	checkConsent,
	recordConsent,
} from '$lib/server/services/consent-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const authMode = getAuthMode();
	if (authMode === 'local') redirect(302, '/');

	if (!locals.authenticated || !locals.context?.tenantId) {
		redirect(302, '/auth/login');
	}

	const consent = await checkConsent(locals.context.tenantId);
	if (!consent.needsReconsent) {
		redirect(302, '/admin');
	}

	return {
		termsAccepted: consent.termsAccepted,
		privacyAccepted: consent.privacyAccepted,
		currentTermsVersion: CURRENT_TERMS_VERSION,
		currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
	};
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (!locals.authenticated || !locals.context?.tenantId) {
			return fail(401, { error: 'ログインが必要です' });
		}

		const formData = await request.formData();
		const agreedTerms = formData.get('agreedTerms') === 'on';
		const agreedPrivacy = formData.get('agreedPrivacy') === 'on';

		if (!agreedTerms || !agreedPrivacy) {
			return fail(400, {
				error: '利用規約とプライバシーポリシーの両方に同意してください',
			});
		}

		const tenantId = locals.context.tenantId;
		const userId = locals.identity?.type === 'cognito' ? locals.identity.userId : 'unknown';
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? '';

		try {
			await recordConsent(tenantId, userId, ['terms', 'privacy'], ip, ua);
		} catch (err) {
			logger.error('[CONSENT] Failed to record re-consent', {
				error: err instanceof Error ? err.message : String(err),
			});
			return fail(500, { error: '同意の記録に失敗しました。もう一度お試しください。' });
		}

		redirect(302, '/admin');
	},
};
