import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/certificate-service.ts
// がんばり証明書サービス — 証明書の発行判定・一覧取得

import {
	CERTIFICATE_LEVEL_MILESTONES,
	MONTHLY_HABIT_DAYS_THRESHOLD,
	MONTHLY_HABIT_POINTS,
	STREAK_MILESTONE_DAYS,
} from '$lib/domain/constants/habit-milestones';
import {
	findCertificateById,
	findCertificates,
	hasCertificate,
	issueCertificate,
} from '$lib/server/db/certificate-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';
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

// #4172 AC12': streak の閾値は 3 箇所に別々のリテラルとして存在していた
// (本 service / value-preview-service / family-streak-service)。数値だけを domain 定数に集約する。
// points の割り当ては family 側に残す — 同じ日数でも意味が違うため (PO 決裁 Q5)。
const STREAK_MILESTONES = STREAK_MILESTONE_DAYS;
const LEVEL_MILESTONES = CERTIFICATE_LEVEL_MILESTONES;

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
		// #4172: 「たくさん」= 量を褒める文言だった。褒めるのは続いたこと。
		description: `${Number(m)}がつは ${MONTHLY_HABIT_DAYS_THRESHOLD}にちいじょう つづきました！`,
		icon: '📜',
		condition: `${Number(m)}月に記録した日数が${MONTHLY_HABIT_DAYS_THRESHOLD}日以上`,
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
	childId: ChildId,
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
	childId: ChildId,
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

/**
 * 月間の習慣化を認めて証明書を発行し、成功したときだけ通貨を付与する (#4172)。
 *
 * ## 旧実装 (`issueMonthlyCertificateIfEligible`) から何を変えたか
 *
 * 旧条件は「その月の活動**回数** 10 回以上」だった。**1 日に 10 回記録しても達成する**ため、
 * 本 Issue が撤去した `totalRecords % 5` と同じ「量 vs 習慣」の取り違えを内包していた。
 * 呼び出し元が 0 件 (テストのみ) で顧客に届いていなかったため露見していなかっただけである。
 * PO 決裁 (2026-08-02 Q4) により**条件を差し替える**。別 type を並置すると「月次」が
 * 2 系統になり AC12 の重複を新たに 1 件作るため採らない。
 *
 * ## 判定
 *
 * 「その月に**記録した日数**」が {@link MONTHLY_HABIT_DAYS_THRESHOLD} 日以上。
 * 日数は `report-service` の `daysWithActivity` を使う — 定義が
 * 「その日に 1 件以上記録があれば 1」で本契約と一致しており、両 backend で test 済のため
 * 新しい数え方を作らない。
 *
 * ## 冪等と書き込み順 (AC10 / AC18)
 *
 * 冪等キーは**同月の証明書レコードの存在**。`hasCertificate` → `issueCertificate` →
 * `insertPointEntry` の順で、**厳密には原子ではない**。
 *
 * | 失敗 | 結果 |
 * |---|---|
 * | 証明書 INSERT 成功 → ledger 失敗 | 無償の証明書が残る。**証明書は通貨を持たないので実害なし** |
 * | **逆順にした場合** | **記録の無いポイントが増える。通貨の出所が追えなくなる** |
 *
 * **この順序でなければならない。** repo 層の原子 primitive 化 (sqlite / dsql / demo の 3 実装)
 * は月 1 回・50pt の付与漏れに対して過剰 (ADR-0010 / PO 決裁 Q6)。
 *
 * ## 通知 (AC11' / AC15)
 *
 * **親のみに送り、子への演出は出さない。** 子に演出を出すとその時点で子の中で完結し、
 * 親が「1 ヶ月続いたね」と言う前にアプリが言ってしまう (§2.1-2)。
 * 通貨は付与するので子の残高は増える — **そこで親が声をかければ噛み合う**。
 * 経路は既存の Web Push のみ。`/api/v1/notifications/subscribe` が child role を 403 で
 * 拒否する (#1593) ため、**親のみは経路の設計上すでに保証されている**。
 */
export async function issueMonthlyHabitCertificateIfEligible(
	childId: ChildId,
	yearMonth: string,
	tenantId: string,
): Promise<Certificate | null> {
	const { getMonthlyReport } = await import('$lib/server/services/report-service');
	const report = await getMonthlyReport(tenantId, childId, yearMonth);
	if (!report) return null;
	if (report.daysWithActivity < MONTHLY_HABIT_DAYS_THRESHOLD) return null;

	const def = getMonthlyDef(yearMonth);
	if (await hasCertificate(childId, def.type, tenantId)) return null;

	const certificate = await issueCertificate(
		{
			childId,
			certificateType: def.type,
			title: def.title,
			description: def.description,
			metadata: JSON.stringify({
				yearMonth,
				daysWithActivity: report.daysWithActivity,
				thresholdDays: MONTHLY_HABIT_DAYS_THRESHOLD,
				pointsGranted: MONTHLY_HABIT_POINTS,
				icon: def.icon,
			}),
		},
		tenantId,
	);

	// 証明書行が冪等キーなので、ここに来るのは同月で初めてのときだけ。
	await insertPointEntry(
		{
			childId,
			amount: MONTHLY_HABIT_POINTS,
			type: 'monthly_habit',
			description: def.title,
		},
		tenantId,
	);

	// #4261 ③: **Push が届かない家庭でも子が残高の増えた理由を知れるようにする。**
	// AC11' の「子への演出は出さない」は維持したまま、次回起動時に静かに 1 回だけ伝える
	// pending を残す (PO 決裁 2026-08-06)。Push の可否に関わらず 1 件だけ書くため、
	// 届いた家庭で二重に演出されることはない。
	// 通知と同じく付帯物 — 失敗しても証明書と通貨は取り消さない。
	try {
		const { recordHabitCertificateNotice } = await import(
			'$lib/server/services/habit-certificate-notice-service'
		);
		await recordHabitCertificateNotice(
			{ childId, yearMonth, points: MONTHLY_HABIT_POINTS },
			tenantId,
		);
	} catch (e) {
		logger.warn('[certificate] 月間習慣化の子向け告知の保存に失敗', {
			service: 'certificate',
			error: e instanceof Error ? e.message : String(e),
		});
	}

	// 通知は付帯物。失敗しても証明書と通貨は取り消さない。
	try {
		const { sendPushNotification } = await import('$lib/server/services/notification-service');
		await sendPushNotification(tenantId, 'monthly_habit', def.title, def.description, {
			childId,
			yearMonth,
			daysWithActivity: report.daysWithActivity,
		});
	} catch (e) {
		logger.warn('[certificate] 月間習慣化の通知に失敗', {
			service: 'certificate',
			error: e instanceof Error ? e.message : String(e),
		});
	}

	return certificate;
}

/** カテゴリマスター証明書を発行 */
export async function issueCategoryMasterCertificate(
	childId: ChildId,
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
	childId: ChildId,
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
	childId: ChildId,
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
	id: string,
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
	id: string;
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
