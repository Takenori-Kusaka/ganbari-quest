// tests/unit/services/certificate-service.test.ts
// 証明書サービスのユニットテスト（certificate-repo をモックして純粋にサービス層ロジックを検証）

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Certificate } from '../../../src/lib/server/db/types';

vi.mock('$lib/server/db/certificate-repo', () => ({
	hasCertificate: vi.fn(),
	issueCertificate: vi.fn(),
	findCertificates: vi.fn(),
	findCertificateById: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	findCertificateById,
	findCertificates,
	hasCertificate,
	issueCertificate,
} from '../../../src/lib/server/db/certificate-repo';
import {
	type CertificateWithMeta,
	buildRenderData,
	checkAndIssueLevelCertificates,
	checkAndIssueStreakCertificates,
	getCertificateDetail,
	getCertificatesForChild,
	issueAnnualCertificate,
	issueCategoryMasterCertificate,
	issueMonthlyCertificateIfEligible,
} from '../../../src/lib/server/services/certificate-service';

const TENANT = 'test-tenant';
const CHILD_ID = 1;

function makeCert(overrides: Partial<Certificate> = {}): Certificate {
	return {
		id: 1,
		childId: CHILD_ID,
		tenantId: TENANT,
		certificateType: 'streak_7',
		title: 'テスト証明書',
		description: 'テスト説明',
		issuedAt: '2026-04-01T00:00:00Z',
		metadata: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// checkAndIssueStreakCertificates
// ============================================================

describe('checkAndIssueStreakCertificates', () => {
	it('streak=7 で 1 件の証明書を発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);
		vi.mocked(issueCertificate).mockResolvedValue(
			makeCert({
				certificateType: 'streak_7',
				metadata: JSON.stringify({ streakDays: 7, icon: '⭐' }),
			}),
		);

		const result = await checkAndIssueStreakCertificates(CHILD_ID, 7, TENANT);

		expect(result).toHaveLength(1);
		expect(result[0]?.certificateType).toBe('streak_7');
		expect(hasCertificate).toHaveBeenCalledTimes(1);
		expect(issueCertificate).toHaveBeenCalledTimes(1);
	});

	it('streak=30 で 3 件 (7, 14, 30) の証明書を発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);

		let callCount = 0;
		vi.mocked(issueCertificate).mockImplementation(async (input) => {
			callCount++;
			return makeCert({
				id: callCount,
				certificateType: input.certificateType,
				metadata: input.metadata ?? null,
			});
		});

		const result = await checkAndIssueStreakCertificates(CHILD_ID, 30, TENANT);

		expect(result).toHaveLength(3);
		expect(result.map((c) => c.certificateType)).toEqual(['streak_7', 'streak_14', 'streak_30']);
		expect(hasCertificate).toHaveBeenCalledTimes(3);
		expect(issueCertificate).toHaveBeenCalledTimes(3);
	});

	it('既に発行済みの場合はスキップする', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(true);

		const result = await checkAndIssueStreakCertificates(CHILD_ID, 7, TENANT);

		expect(result).toHaveLength(0);
		expect(issueCertificate).not.toHaveBeenCalled();
	});

	it('streak=5 ではマイルストーン未到達なので何も発行しない', async () => {
		const result = await checkAndIssueStreakCertificates(CHILD_ID, 5, TENANT);

		expect(result).toHaveLength(0);
		expect(hasCertificate).not.toHaveBeenCalled();
		expect(issueCertificate).not.toHaveBeenCalled();
	});

	it('streak=100 で 5 件全マイルストーンを発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);

		let callCount = 0;
		vi.mocked(issueCertificate).mockImplementation(async (input) => {
			callCount++;
			return makeCert({ id: callCount, certificateType: input.certificateType });
		});

		const result = await checkAndIssueStreakCertificates(CHILD_ID, 100, TENANT);

		expect(result).toHaveLength(5);
		expect(result.map((c) => c.certificateType)).toEqual([
			'streak_7',
			'streak_14',
			'streak_30',
			'streak_60',
			'streak_100',
		]);
	});

	it('issueCertificate が null を返した場合は issued に含めない', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);
		vi.mocked(issueCertificate).mockResolvedValue(null);

		const result = await checkAndIssueStreakCertificates(CHILD_ID, 7, TENANT);

		expect(result).toHaveLength(0);
	});
});

// ============================================================
// checkAndIssueLevelCertificates
// ============================================================

describe('checkAndIssueLevelCertificates', () => {
	it('level=5 で 1 件発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);
		vi.mocked(issueCertificate).mockResolvedValue(
			makeCert({ certificateType: 'level_5', metadata: JSON.stringify({ level: 5, icon: '🌟' }) }),
		);

		const result = await checkAndIssueLevelCertificates(CHILD_ID, 5, TENANT);

		expect(result).toHaveLength(1);
		expect(result[0]?.certificateType).toBe('level_5');
	});

	it('level=20 で 3 件 (5, 10, 20) 発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);

		let callCount = 0;
		vi.mocked(issueCertificate).mockImplementation(async (input) => {
			callCount++;
			return makeCert({ id: callCount, certificateType: input.certificateType });
		});

		const result = await checkAndIssueLevelCertificates(CHILD_ID, 20, TENANT);

		expect(result).toHaveLength(3);
		expect(result.map((c) => c.certificateType)).toEqual(['level_5', 'level_10', 'level_20']);
	});

	it('既に発行済みの場合はスキップする', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(true);

		const result = await checkAndIssueLevelCertificates(CHILD_ID, 10, TENANT);

		expect(result).toHaveLength(0);
		expect(issueCertificate).not.toHaveBeenCalled();
	});

	it('level=3 ではマイルストーン未到達なので何も発行しない', async () => {
		const result = await checkAndIssueLevelCertificates(CHILD_ID, 3, TENANT);

		expect(result).toHaveLength(0);
		expect(hasCertificate).not.toHaveBeenCalled();
	});
});

// ============================================================
// issueMonthlyCertificateIfEligible
// ============================================================

describe('issueMonthlyCertificateIfEligible', () => {
	it('activityCount < 10 の場合は null を返す', async () => {
		const result = await issueMonthlyCertificateIfEligible(CHILD_ID, '2026-03', 9, 100, 5, TENANT);

		expect(result).toBeNull();
		expect(hasCertificate).not.toHaveBeenCalled();
		expect(issueCertificate).not.toHaveBeenCalled();
	});

	it('activityCount >= 10 で証明書を発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);
		vi.mocked(issueCertificate).mockResolvedValue(
			makeCert({
				certificateType: 'monthly_2026-03',
				metadata: JSON.stringify({
					yearMonth: '2026-03',
					activityCount: 15,
					totalPoints: 200,
					level: 8,
					icon: '📜',
				}),
			}),
		);

		const result = await issueMonthlyCertificateIfEligible(CHILD_ID, '2026-03', 15, 200, 8, TENANT);

		expect(result).not.toBeNull();
		expect(result?.certificateType).toBe('monthly_2026-03');
		expect(issueCertificate).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: CHILD_ID,
				certificateType: 'monthly_2026-03',
			}),
			TENANT,
		);
	});

	it('既に発行済みの場合は null を返す', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(true);

		const result = await issueMonthlyCertificateIfEligible(
			CHILD_ID,
			'2026-03',
			20,
			300,
			10,
			TENANT,
		);

		expect(result).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
	});
});

// ============================================================
// issueCategoryMasterCertificate
// ============================================================

describe('issueCategoryMasterCertificate', () => {
	it('カテゴリマスター証明書を発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);
		vi.mocked(issueCertificate).mockResolvedValue(
			makeCert({
				certificateType: 'category_master_undou',
				metadata: JSON.stringify({ categoryCode: 'undou', categoryName: 'うんどう', icon: '🎓' }),
			}),
		);

		const result = await issueCategoryMasterCertificate(CHILD_ID, 'undou', 'うんどう', TENANT);

		expect(result).not.toBeNull();
		expect(result?.certificateType).toBe('category_master_undou');
	});

	it('既に発行済みの場合は null を返す', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(true);

		const result = await issueCategoryMasterCertificate(CHILD_ID, 'undou', 'うんどう', TENANT);

		expect(result).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
	});
});

// ============================================================
// issueAnnualCertificate
// ============================================================

describe('issueAnnualCertificate', () => {
	const stats = { totalActivities: 120, totalPoints: 5000, maxStreak: 45, level: 25 };

	it('年間がんばり大賞を発行する', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(false);
		vi.mocked(issueCertificate).mockResolvedValue(
			makeCert({
				certificateType: 'annual_2025',
				metadata: JSON.stringify({ year: '2025', ...stats, icon: '🏆' }),
			}),
		);

		const result = await issueAnnualCertificate(CHILD_ID, '2025', stats, TENANT);

		expect(result).not.toBeNull();
		expect(result?.certificateType).toBe('annual_2025');
		expect(issueCertificate).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: CHILD_ID,
				certificateType: 'annual_2025',
			}),
			TENANT,
		);
	});

	it('既に発行済みの場合は null を返す', async () => {
		vi.mocked(hasCertificate).mockResolvedValue(true);

		const result = await issueAnnualCertificate(CHILD_ID, '2025', stats, TENANT);

		expect(result).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
	});
});

// ============================================================
// getCertificatesForChild
// ============================================================

describe('getCertificatesForChild', () => {
	it('証明書一覧にメタデータ (icon, category) を付与して返す', async () => {
		vi.mocked(findCertificates).mockResolvedValue([
			makeCert({
				id: 1,
				certificateType: 'streak_7',
				metadata: JSON.stringify({ streakDays: 7, icon: '⭐' }),
			}),
			makeCert({
				id: 2,
				certificateType: 'monthly_2026-03',
				metadata: JSON.stringify({ yearMonth: '2026-03', icon: '📜' }),
			}),
			makeCert({
				id: 3,
				certificateType: 'level_10',
				metadata: JSON.stringify({ level: 10, icon: '🏆' }),
			}),
		]);

		const result = await getCertificatesForChild(CHILD_ID, TENANT);

		expect(result).toHaveLength(3);
		expect(result[0]?.icon).toBe('⭐');
		expect(result[0]?.category).toBe('streak');
		expect(result[1]?.icon).toBe('📜');
		expect(result[1]?.category).toBe('monthly');
		expect(result[2]?.icon).toBe('🏆');
		expect(result[2]?.category).toBe('level');
	});

	it('metadata に icon がない場合はデフォルトアイコンを使う', async () => {
		vi.mocked(findCertificates).mockResolvedValue([
			makeCert({ certificateType: 'category_master_undou', metadata: '{}' }),
		]);

		const result = await getCertificatesForChild(CHILD_ID, TENANT);

		expect(result[0]?.icon).toBe('🎓');
		expect(result[0]?.category).toBe('category_master');
	});
});

// ============================================================
// getCertificateDetail
// ============================================================

describe('getCertificateDetail', () => {
	it('証明書が見つかった場合はメタデータ付きで返す', async () => {
		vi.mocked(findCertificateById).mockResolvedValue(
			makeCert({
				id: 42,
				certificateType: 'annual_2025',
				metadata: JSON.stringify({ year: '2025', icon: '🏆' }),
			}),
		);

		const result = await getCertificateDetail(42, TENANT);

		expect(result).not.toBeNull();
		expect(result?.id).toBe(42);
		expect(result?.icon).toBe('🏆');
		expect(result?.category).toBe('annual');
	});

	it('証明書が見つからない場合は null を返す', async () => {
		vi.mocked(findCertificateById).mockResolvedValue(undefined);

		const result = await getCertificateDetail(999, TENANT);

		expect(result).toBeNull();
	});
});

// ============================================================
// buildRenderData
// ============================================================

describe('buildRenderData', () => {
	it('ストリーク証明書のレンダリングデータを生成する', () => {
		const cert: CertificateWithMeta = {
			...makeCert({
				id: 10,
				certificateType: 'streak_30',
				title: 'れんぞく30にちのぼうけんしゃ',
				description: '30にちれんぞくで がんばりました！',
				metadata: JSON.stringify({ streakDays: 30, icon: '🔥' }),
			}),
			icon: '🔥',
			category: 'streak',
		};

		const result = buildRenderData(cert, 'テスト太郎');

		expect(result.id).toBe(10);
		expect(result.childName).toBe('テスト太郎');
		expect(result.title).toBe('れんぞく30にちのぼうけんしゃ');
		expect(result.icon).toBe('🔥');
		expect(result.stats).toContainEqual({ label: 'れんぞくにっすう', value: '30にち' });
	});

	it('月間証明書のレンダリングデータに activityCount と totalPoints を含む', () => {
		const cert: CertificateWithMeta = {
			...makeCert({
				id: 20,
				certificateType: 'monthly_2026-03',
				title: '2026ねん3がつの がんばりしょうめいしょ',
				description: '3がつも たくさん がんばりました！',
				metadata: JSON.stringify({
					yearMonth: '2026-03',
					activityCount: 25,
					totalPoints: 500,
					level: 12,
					icon: '📜',
				}),
			}),
			icon: '📜',
			category: 'monthly',
		};

		const result = buildRenderData(cert, 'テスト花子');

		expect(result.stats).toContainEqual({ label: 'かつどうかいすう', value: '25かい' });
		expect(result.stats).toContainEqual({ label: 'かくとくポイント', value: '500pt' });
		expect(result.stats).toContainEqual({ label: 'レベル', value: '12' });
	});

	it('年間証明書のレンダリングデータに全統計を含む', () => {
		const cert: CertificateWithMeta = {
			...makeCert({
				id: 30,
				certificateType: 'annual_2025',
				title: '2025ねんど がんばりたいしょう',
				description: '2025ねんど いちねんかん がんばりました！',
				metadata: JSON.stringify({
					year: '2025',
					totalActivities: 120,
					totalPoints: 5000,
					maxStreak: 45,
					level: 25,
					icon: '🏆',
				}),
			}),
			icon: '🏆',
			category: 'annual',
		};

		const result = buildRenderData(cert, 'テスト次郎');

		expect(result.stats).toContainEqual({ label: 'ねんかんかつどう', value: '120かい' });
		expect(result.stats).toContainEqual({ label: 'かくとくポイント', value: '5000pt' });
		expect(result.stats).toContainEqual({ label: 'さいちょうストリーク', value: '45にち' });
		expect(result.stats).toContainEqual({ label: 'レベル', value: '25' });
	});

	it('metadata が null の場合は stats が空配列になる', () => {
		const cert: CertificateWithMeta = {
			...makeCert({ id: 40, metadata: null }),
			icon: '📜',
			category: 'monthly',
		};

		const result = buildRenderData(cert, 'テスト');

		expect(result.stats).toEqual([]);
	});

	it('description が null の場合は空文字列を返す', () => {
		const cert: CertificateWithMeta = {
			...makeCert({ id: 50, description: null }),
			icon: '📜',
			category: 'monthly',
		};

		const result = buildRenderData(cert, 'テスト');

		expect(result.description).toBe('');
	});
});
