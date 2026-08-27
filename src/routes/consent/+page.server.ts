// /consent — 規約再同意ページ (#0192)

import { fail, redirect } from '@sveltejs/kit';
import { CONSENT_LABELS } from '$lib/domain/labels';
import type { ConsentType } from '$lib/server/auth/entities';
import { getAuthMode } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	CURRENT_CROSS_BORDER_VERSION,
	CURRENT_PRIVACY_VERSION,
	CURRENT_TERMS_VERSION,
	checkConsent,
	recordConsent,
} from '$lib/server/services/consent-service';
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

	// #589: 過去の同意がない → 「新規同意」
	// 過去の同意があり古いバージョン → 「規約更新」
	// この区別で見出し文言を切り替える
	const hasExistingConsent =
		consent.termsVersion !== undefined ||
		consent.privacyVersion !== undefined ||
		consent.crossBorderVersion !== undefined;

	return {
		termsAccepted: consent.termsAccepted,
		privacyAccepted: consent.privacyAccepted,
		crossBorderAccepted: consent.crossBorderAccepted,
		currentTermsVersion: CURRENT_TERMS_VERSION,
		currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
		currentCrossBorderVersion: CURRENT_CROSS_BORDER_VERSION,
		hasExistingConsent,
		previousTermsVersion: consent.termsVersion ?? null,
		previousPrivacyVersion: consent.privacyVersion ?? null,
		previousCrossBorderVersion: consent.crossBorderVersion ?? null,
	};
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (!locals.authenticated || !locals.context?.tenantId) {
			return fail(401, { error: CONSENT_LABELS.errors.loginRequired });
		}

		const formData = await request.formData();
		const agreedTerms = formData.get('agreedTerms') === 'on';
		const agreedPrivacy = formData.get('agreedPrivacy') === 'on';
		// #4497: 越境移転同意（§28）。OAuth 経由の登録は signup フォームを通らないため、
		// この画面が唯一の取得点になる。
		const agreedCrossBorder = formData.get('agreedCrossBorder') === 'on';

		if (!agreedTerms || !agreedPrivacy || !agreedCrossBorder) {
			return fail(400, {
				error: CONSENT_LABELS.errors.bothRequired,
			});
		}

		const tenantId = locals.context.tenantId;
		const userId = locals.identity?.type === 'cognito' ? locals.identity.userId : 'unknown';
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') ?? '';

		// 既に最新版へ同意済みの種別は記録し直さない。画面に出していない文書について
		// 「いま同意した」証跡を作ると、記録が実際の行為とずれるため（append-only、監査対象）。
		const current = await checkConsent(tenantId);
		const missing: ConsentType[] = [];
		if (!current.termsAccepted) missing.push('terms');
		if (!current.privacyAccepted) missing.push('privacy');
		if (!current.crossBorderAccepted) missing.push('cross-border');

		try {
			await recordConsent(tenantId, userId, missing, ip, ua);
		} catch (err) {
			logger.error('[CONSENT] Failed to record re-consent', {
				error: err instanceof Error ? err.message : String(err),
			});
			return fail(500, { error: CONSENT_LABELS.errors.recordFailed });
		}

		redirect(302, '/admin');
	},
};
