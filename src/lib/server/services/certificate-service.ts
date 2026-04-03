// src/lib/server/services/certificate-service.ts
// がんばり証明書サービス — 証明書の発行判定・一覧取得

import {
	findCertificateById,
	findCertificates,
	hasCertificate,
	issueCertificate,
} from '$lib/server/db/certificate-repo';
import type { Certificate } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

// ============================================================
// Types
// ============================================================

export type CertificateCategory = 'streak' | 'monthly' | 'level' | 'category_master' | 'annual';

export interface CertificateDefinition {
	type: string;
	category: CertificateCategory;
	title: string;
	description: string;
	icon: string;
	condition: string; // Human-readable condition
}

export interface CertificateWithMeta extends Certificate {
	icon: string;
	category: CertificateCategory;
}

// ============================================================
// Certificate Definitions
// ============================================================

const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;
const LEVEL_MILESTONES = [5, 10, 20, 30, 50] as const;

function getStreakDef(days: number): CertificateDefinition {
	return {
		type: `streak_${days}`,
		category: 'streak',
		title: `れんぞく${days}にちのぼうけんしゃ`,
		description: `${days}にちれんぞくで がんばりました！`,
		icon: days >= 60 ? '🏅' : days >= 30 ? '🔥' : '⭐',
		condition: `${days}日連続記録`,
	};
}

function getLevelDef(level: number): CertificateDefinition {
	return {
		type: `level_${level}`,
		category: 'level',
		title: `レベル${level}とうたつ！`,
		description: `レベル${level}に たっせいしました！`,
		icon: level >= 30 ? '👑' : level >= 10 ? '🏆' : '🌟',
		condition: `レベル${level}到達`,
	};
}

function getMonthlyDef(yearMonth: string): CertificateDefinition {
	const [y, m] = yearMonth.split('-');
	return {
		type: `monthly_${yearMonth}`,
		category: 'monthly',
		title: `${y}ねん${Number(m)}がつの がんばりしょうめいしょ`,
		description: `${Number(m)}がつも たくさん がんばりました！`,
		icon: '📜',
		condition: `${Number(m)}月の活動10回以上`,
	};
}

function getCategoryMasterDef(categoryName: string, categoryCode: string): CertificateDefinition {
	return {
		type: `category_master_${categoryCode}`,
		category: 'category_master',
		title: `${categoryName}マスター`,
		description: `${categoryName}の カテゴリで ★5を たっせい！`,
		icon: '🎓',
		condition: `${categoryName}カテゴリ ★5到達`,
	};
}

function getAnnualDef(year: string): CertificateDefinition {
	return {
		type: `annual_${year}`,
		category: 'annual',
		title: `${year}ねんど がんばりたいしょう`,
		description: `${year}ねんど いちねんかん がんばりました！`,
		icon: '🏆',
		condition: `${year}年度の年間がんばり大賞`,
	};
}

/** 証明書タイプから定義を逆引き */
function getDefinitionForType(certificateType: string): {
	icon: string;
	category: CertificateCategory;
} {
	if (certificateType.startsWith('streak_')) return { icon: '🔥', category: 'streak' };
	if (certificateType.startsWith('monthly_')) return { icon: '📜', category: 'monthly' };
	if (certificateType.startsWith('level_')) return { icon: '🌟', category: 'level' };
	if (certificateType.startsWith('category_master_'))
		return { icon: '🎓', category: 'category_master' };
	if (certificateType.startsWith('annual_')) return { icon: '🏆', category: 'annual' };
	return { icon: '📜', category: 'monthly' };
}

// ============================================================
// Issue Certificates (条件チェック + 発行)
// ============================================================

/** ストリーク証明書を発行チェック */
export async function checkAndIssueStreakCertificates(
	childId: number,
	streakDays: number,
	tenantId: string,
): Promise<Certificate[]> {
	const issued: Certificate[] = [];

	for (const milestone of STREAK_MILESTONES) {
		if (streakDays >= milestone) {
			const def = getStreakDef(milestone);
			const exists = await hasCertificate(childId, def.type, tenantId);
			if (!exists) {
				const cert = await issueCertificate(
					{
						childId,
						certificateType: def.type,
						title: def.title,
						description: def.description,
						metadata: JSON.stringify({ streakDays, icon: def.icon }),
					},
					tenantId,
				);
				if (cert) {
					issued.push(cert);
					logger.info('[certificate] Streak certificate issued', {
						context: { childId, type: def.type, streakDays },
					});
				}
			}
		}
	}

	return issued;
}

/** レベルアップ証明書を発行チェック */
export async function checkAndIssueLevelCertificates(
	childId: number,
	level: number,
	tenantId: string,
): Promise<Certificate[]> {
	const issued: Certificate[] = [];

	for (const milestone of LEVEL_MILESTONES) {
		if (level >= milestone) {
			const def = getLevelDef(milestone);
			const exists = await hasCertificate(childId, def.type, tenantId);
			if (!exists) {
				const cert = await issueCertificate(
					{
						childId,
						certificateType: def.type,
						title: def.title,
						description: def.description,
						metadata: JSON.stringify({ level, icon: def.icon }),
					},
					tenantId,
				);
				if (cert) issued.push(cert);
			}
		}
	}

	return issued;
}

/** 月間がんばり証明書を発行（月の活動回数10回以上） */
export async function issueMonthlyCertificateIfEligible(
	childId: number,
	yearMonth: string,
	activityCount: number,
	totalPoints: number,
	level: number,
	tenantId: string,
): Promise<Certificate | null> {
	if (activityCount < 10) return null;

	const def = getMonthlyDef(yearMonth);
	const exists = await hasCertificate(childId, def.type, tenantId);
	if (exists) return null;

	return issueCertificate(
		{
			childId,
			certificateType: def.type,
			title: def.title,
			description: def.description,
			metadata: JSON.stringify({
				yearMonth,
				activityCount,
				totalPoints,
				level,
				icon: def.icon,
			}),
		},
		tenantId,
	);
}

/** カテゴリマスター証明書を発行 */
export async function issueCategoryMasterCertificate(
	childId: number,
	categoryCode: string,
	categoryName: string,
	tenantId: string,
): Promise<Certificate | null> {
	const def = getCategoryMasterDef(categoryName, categoryCode);
	const exists = await hasCertificate(childId, def.type, tenantId);
	if (exists) return null;

	return issueCertificate(
		{
			childId,
			certificateType: def.type,
			title: def.title,
			description: def.description,
			metadata: JSON.stringify({ categoryCode, categoryName, icon: def.icon }),
		},
		tenantId,
	);
}

/** 年間がんばり大賞を発行 */
export async function issueAnnualCertificate(
	childId: number,
	year: string,
	stats: { totalActivities: number; totalPoints: number; maxStreak: number; level: number },
	tenantId: string,
): Promise<Certificate | null> {
	const def = getAnnualDef(year);
	const exists = await hasCertificate(childId, def.type, tenantId);
	if (exists) return null;

	return issueCertificate(
		{
			childId,
			certificateType: def.type,
			title: def.title,
			description: def.description,
			metadata: JSON.stringify({ year, ...stats, icon: def.icon }),
		},
		tenantId,
	);
}

// ============================================================
// Query
// ============================================================

/** 子供の全証明書を取得（メタデータ付き） */
export async function getCertificatesForChild(
	childId: number,
	tenantId: string,
): Promise<CertificateWithMeta[]> {
	const certs = await findCertificates(childId, tenantId);
	return certs.map((c) => {
		const def = getDefinitionForType(c.certificateType);
		const meta = c.metadata ? JSON.parse(c.metadata) : {};
		return {
			...c,
			icon: meta.icon ?? def.icon,
			category: def.category,
		};
	});
}

/** 証明書を1件取得 */
export async function getCertificateDetail(
	id: number,
	tenantId: string,
): Promise<CertificateWithMeta | null> {
	const cert = await findCertificateById(id, tenantId);
	if (!cert) return null;

	const def = getDefinitionForType(cert.certificateType);
	const meta = cert.metadata ? JSON.parse(cert.metadata) : {};
	return {
		...cert,
		icon: meta.icon ?? def.icon,
		category: def.category,
	};
}

// ============================================================
// Certificate Template Data (for rendering)
// ============================================================

export interface CertificateRenderData {
	id: number;
	childName: string;
	title: string;
	description: string;
	icon: string;
	issuedAt: string;
	stats: {
		label: string;
		value: string;
	}[];
}

/** 証明書のレンダリング用データを生成 */
export function buildRenderData(
	cert: CertificateWithMeta,
	childName: string,
): CertificateRenderData {
	const meta = cert.metadata ? JSON.parse(cert.metadata) : {};
	const stats: { label: string; value: string }[] = [];

	if (meta.streakDays) stats.push({ label: 'れんぞくにっすう', value: `${meta.streakDays}にち` });
	if (meta.activityCount)
		stats.push({ label: 'かつどうかいすう', value: `${meta.activityCount}かい` });
	if (meta.totalPoints) stats.push({ label: 'かくとくポイント', value: `${meta.totalPoints}pt` });
	if (meta.level) stats.push({ label: 'レベル', value: `${meta.level}` });
	if (meta.maxStreak) stats.push({ label: 'さいちょうストリーク', value: `${meta.maxStreak}にち` });
	if (meta.totalActivities)
		stats.push({ label: 'ねんかんかつどう', value: `${meta.totalActivities}かい` });

	return {
		id: cert.id,
		childName,
		title: cert.title,
		description: cert.description ?? '',
		icon: cert.icon,
		issuedAt: cert.issuedAt,
		stats,
	};
}
