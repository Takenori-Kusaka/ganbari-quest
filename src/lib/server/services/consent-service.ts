// src/lib/server/services/consent-service.ts
// 利用規約・プライバシーポリシー同意管理サービス (#0192)

import type { ConsentRecord } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

/** 規約バージョン（改訂日ベース） */
export const CURRENT_TERMS_VERSION = '2026-04-28';
export const CURRENT_PRIVACY_VERSION = '2026-04-28';

export interface ConsentCheck {
	termsAccepted: boolean;
	privacyAccepted: boolean;
	needsReconsent: boolean;
	termsVersion?: string;
	privacyVersion?: string;
}

/** テナントの同意状況を確認 */
export async function checkConsent(tenantId: string): Promise<ConsentCheck> {
	const repos = getRepos();
	const [termsConsent, privacyConsent] = await Promise.all([
		repos.auth.findLatestConsent(tenantId, 'terms'),
		repos.auth.findLatestConsent(tenantId, 'privacy'),
	]);

	const termsAccepted = termsConsent?.version === CURRENT_TERMS_VERSION;
	const privacyAccepted = privacyConsent?.version === CURRENT_PRIVACY_VERSION;

	return {
		termsAccepted,
		privacyAccepted,
		needsReconsent: !termsAccepted || !privacyAccepted,
		termsVersion: termsConsent?.version,
		privacyVersion: privacyConsent?.version,
	};
}

/** 同意を記録 */
export async function recordConsent(
	tenantId: string,
	userId: string,
	types: Array<'terms' | 'privacy'>,
	ipAddress: string,
	userAgent: string,
): Promise<ConsentRecord[]> {
	const repos = getRepos();
	const records: ConsentRecord[] = [];

	for (const type of types) {
		const version = type === 'terms' ? CURRENT_TERMS_VERSION : CURRENT_PRIVACY_VERSION;
		const record = await repos.auth.recordConsent({
			tenantId,
			userId,
			type,
			version,
			ipAddress,
			userAgent,
		});
		records.push(record);
	}

	logger.info(`[CONSENT] Recorded consent for tenant=${tenantId} types=${types.join(',')}`);
	return records;
}

/** テナントの全同意履歴を取得 */
export async function getConsentHistory(tenantId: string): Promise<ConsentRecord[]> {
	const repos = getRepos();
	return repos.auth.findAllConsents(tenantId);
}
