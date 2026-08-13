// src/lib/server/services/consent-service.ts
// 利用規約・プライバシーポリシー・越境移転同意の管理サービス (#0192 / #4497)

import { CONSENT_TYPES, type ConsentRecord, type ConsentType } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

/**
 * 規約バージョン（改訂日ベース）。
 *
 * site/terms.html / site/privacy.html の「最終改定日」と一致していること。
 * 一致は tests/unit/services/legal-doc-version-parity.test.ts が機械強制する (#4497)。
 * 文書を改定したらここも上げる。上げないと既存利用者に再同意が発火せず、
 * 新規の同意記録も旧 version で保存され続ける（表示文書と同意証跡の恒常不一致）。
 */
export const CURRENT_TERMS_VERSION = '2026-04-28';
export const CURRENT_PRIVACY_VERSION = '2026-08-12';

/**
 * 越境移転同意（個人情報保護法 §28）の version。
 *
 * 同意時に提供する情報（移転先国・当該国の個人情報保護制度・移転先が講ずる措置。
 * 施行規則 17 条 2 項）は privacy.html 第 10 条が実体であるため、プライバシーポリシーと
 * 同一 version を刻む。§10 の記載が変われば privacy の改定日が動き、越境同意も再取得される。
 */
export const CURRENT_CROSS_BORDER_VERSION = CURRENT_PRIVACY_VERSION;

/** 同意種別 → 記録する version。recordConsent はここだけを見る（呼び出し側に version を持たせない）。 */
const CONSENT_VERSIONS: Record<ConsentType, string> = {
	terms: CURRENT_TERMS_VERSION,
	privacy: CURRENT_PRIVACY_VERSION,
	'cross-border': CURRENT_CROSS_BORDER_VERSION,
};

export interface ConsentCheck {
	termsAccepted: boolean;
	privacyAccepted: boolean;
	/** #4497: 越境移転同意（§28）。未取得なら再同意画面へ誘導する = OAuth 経路の取りこぼしを塞ぐ */
	crossBorderAccepted: boolean;
	needsReconsent: boolean;
	termsVersion?: string;
	privacyVersion?: string;
	crossBorderVersion?: string;
}

/** テナントの同意状況を確認 */
export async function checkConsent(tenantId: string): Promise<ConsentCheck> {
	const repos = getRepos();
	const [termsConsent, privacyConsent, crossBorderConsent] = await Promise.all([
		repos.auth.findLatestConsent(tenantId, 'terms'),
		repos.auth.findLatestConsent(tenantId, 'privacy'),
		repos.auth.findLatestConsent(tenantId, 'cross-border'),
	]);

	const termsAccepted = termsConsent?.version === CURRENT_TERMS_VERSION;
	const privacyAccepted = privacyConsent?.version === CURRENT_PRIVACY_VERSION;
	const crossBorderAccepted = crossBorderConsent?.version === CURRENT_CROSS_BORDER_VERSION;

	return {
		termsAccepted,
		privacyAccepted,
		crossBorderAccepted,
		needsReconsent: !termsAccepted || !privacyAccepted || !crossBorderAccepted,
		termsVersion: termsConsent?.version,
		privacyVersion: privacyConsent?.version,
		crossBorderVersion: crossBorderConsent?.version,
	};
}

/** 同意を記録 */
export async function recordConsent(
	tenantId: string,
	userId: string,
	types: readonly ConsentType[],
	ipAddress: string,
	userAgent: string,
): Promise<ConsentRecord[]> {
	const repos = getRepos();
	const records: ConsentRecord[] = [];

	for (const type of types) {
		// consents.type の DB CHECK は #4497 (migration 0007) で外した — DSQL は値集合を
		// 後から広げられないため。許可値の強制点はここに移っている。未知の type を書かせない。
		if (!CONSENT_TYPES.includes(type)) {
			throw new Error(`[CONSENT] Unknown consent type: ${String(type)}`);
		}

		const record = await repos.auth.recordConsent({
			tenantId,
			userId,
			type,
			version: CONSENT_VERSIONS[type],
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
