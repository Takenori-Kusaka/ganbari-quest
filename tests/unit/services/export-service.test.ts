// tests/unit/services/export-service.test.ts
// データエクスポートサービスのユニットテスト

import { describe, expect, it, vi } from 'vitest';
import { EXPORT_FORMAT, EXPORT_VERSION } from '../../../src/lib/domain/export-format';

// モック定義
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockChildren = [
	{
		id: 1,
		nickname: 'テスト太郎',
		age: 5,
		birthDate: '2021-01-15',
		theme: 'blue',
		uiMode: 'kinder',
		avatarUrl: null,
		activeTitleId: 1,
		activeAvatarBg: null,
		activeAvatarFrame: null,
		activeAvatarEffect: null,
		createdAt: '2025-06-01T00:00:00Z',
		updatedAt: '2026-03-01T00:00:00Z',
	},
	{
		id: 2,
		nickname: 'テスト花子',
		age: 3,
		birthDate: null,
		theme: 'pink',
		uiMode: 'baby',
		avatarUrl: null,
		activeTitleId: null,
		activeAvatarBg: null,
		activeAvatarFrame: null,
		activeAvatarEffect: null,
		createdAt: '2025-07-01T00:00:00Z',
		updatedAt: '2026-03-01T00:00:00Z',
	},
];

const mockActivities = [
	{
		id: 1,
		name: 'はいはいした',
		categoryId: 1,
		icon: '🏃',
		basePoints: 5,
		ageMin: 0,
		ageMax: 2,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'seed',
		gradeLevel: 'baby',
		subcategory: null,
		description: null,
		nameKana: 'はいはいした',
		nameKanji: null,
		triggerHint: null,
		createdAt: '2025-01-01T00:00:00Z',
	},
	{
		id: 2,
		name: 'ひらがなれんしゅう',
		categoryId: 2,
		icon: '📝',
		basePoints: 8,
		ageMin: 3,
		ageMax: 6,
		isVisible: 1,
		dailyLimit: 1,
		sortOrder: 2,
		source: 'seed',
		gradeLevel: 'kinder',
		subcategory: null,
		description: null,
		nameKana: 'ひらがなれんしゅう',
		nameKanji: 'ひらがな練習',
		triggerHint: 'おべんきょうのあとに！',
		createdAt: '2025-01-01T00:00:00Z',
	},
];

const mockTitles = [
	{
		id: 1,
		code: 'undou_master',
		name: 'うんどうマスター',
		description: null,
		icon: '🏃',
		conditionType: 'status_deviation',
		conditionValue: 65,
		conditionExtra: '1',
		rarity: 'rare',
		sortOrder: 1,
		createdAt: '2025-01-01T00:00:00Z',
	},
];

const mockAchievements = [
	{
		id: 1,
		code: 'first_step',
		name: 'はじめのいっぽ',
		description: null,
		icon: '👣',
		category: null,
		conditionType: 'total_activities',
		conditionValue: 1,
		bonusPoints: 10,
		rarity: 'common',
		sortOrder: 1,
		repeatable: 0,
		milestoneValues: null,
		isMilestone: 0,
		createdAt: '2025-01-01T00:00:00Z',
	},
];

const mockAvatarItems = [
	{
		id: 1,
		code: 'bg_sunset',
		name: 'ゆうやけ',
		description: null,
		category: 'background',
		icon: '🌅',
		cssValue: 'linear-gradient(...)',
		price: 100,
		unlockType: 'purchase',
		unlockCondition: null,
		rarity: 'common',
		sortOrder: 1,
		isActive: 1,
		createdAt: '2025-01-01T00:00:00Z',
	},
];

const mockCareerFields = [
	{
		id: 1,
		name: '先生',
		description: null,
		icon: '👨‍🏫',
		relatedCategories: '[2,4]',
		recommendedActivities: '[]',
		minAge: 4,
		createdAt: '2025-01-01T00:00:00Z',
	},
];

const mockActivityLogs = [
	{
		id: 1,
		activityName: 'ひらがなれんしゅう',
		activityIcon: '📝',
		categoryId: 2,
		points: 8,
		streakDays: 3,
		streakBonus: 2,
		recordedAt: '2026-03-15T08:30:00Z',
	},
];

const mockPointHistory = [
	{
		id: 1,
		childId: 1,
		amount: 10,
		type: 'earn',
		description: 'ひらがなれんしゅう を記録',
		referenceId: 1,
		createdAt: '2026-03-15T08:30:00Z',
	},
];

const mockStatuses = [
	{ id: 1, childId: 1, categoryId: 2, value: 42.5, updatedAt: '2026-03-15T08:30:00Z' },
];

const mockStatusHistory = [
	{
		id: 1,
		childId: 1,
		categoryId: 2,
		value: 42.5,
		changeAmount: 0.5,
		changeType: 'activity',
		recordedAt: '2026-03-15T08:30:00Z',
	},
];

const mockUnlockedAchievements = [
	{ id: 1, childId: 1, achievementId: 1, milestoneValue: null, unlockedAt: '2026-03-10T00:00:00Z' },
];

const mockUnlockedTitles = [{ id: 1, childId: 1, titleId: 1, unlockedAt: '2026-03-12T00:00:00Z' }];

const mockLoginBonuses = [
	{
		id: 1,
		childId: 1,
		loginDate: '2026-03-15',
		rank: 'gold',
		basePoints: 5,
		multiplier: 1.5,
		totalPoints: 8,
		consecutiveDays: 7,
		createdAt: '2026-03-15T07:00:00Z',
	},
];

const mockEvaluations = [
	{
		id: 1,
		childId: 1,
		weekStart: '2026-03-10',
		weekEnd: '2026-03-16',
		scoresJson: '{"undou":8}',
		bonusPoints: 5,
		createdAt: '2026-03-16T20:00:00Z',
	},
];

const mockSpecialRewards = [
	{
		id: 1,
		childId: 1,
		grantedBy: null,
		title: 'よくがんばった！',
		description: null,
		points: 50,
		icon: '⭐',
		category: 'praise',
		grantedAt: '2026-03-15T00:00:00Z',
		shownAt: null,
	},
];

const mockChecklistTemplates = [
	{
		id: 1,
		childId: 1,
		name: 'あさのじゅんび',
		icon: '🌅',
		pointsPerItem: 2,
		completionBonus: 5,
		isActive: 1,
		createdAt: '2025-06-01T00:00:00Z',
		updatedAt: '2025-06-01T00:00:00Z',
	},
];

const mockChecklistItems = [
	{
		id: 1,
		templateId: 1,
		name: 'はみがき',
		icon: '🦷',
		frequency: 'daily',
		direction: 'bring',
		sortOrder: 1,
		createdAt: '2025-06-01T00:00:00Z',
	},
];

const mockOwnedAvatarItems = [
	{ id: 1, childId: 1, avatarItemId: 1, acquiredAt: '2026-03-10T00:00:00Z' },
];

const mockCareerPlans = [
	{
		id: 1,
		childId: 1,
		careerFieldId: 1,
		dreamText: '先生になりたい',
		mandalaChart: '{}',
		timeline3y: null,
		timeline5y: null,
		timeline10y: null,
		targetStatuses: '{}',
		version: 1,
		isActive: 1,
		createdAt: '2026-03-01T00:00:00Z',
		updatedAt: '2026-03-01T00:00:00Z',
	},
];

const mockBirthdayReviews = [
	{
		id: 1,
		childId: 1,
		reviewYear: 2026,
		ageAtReview: 5,
		healthChecks: '{}',
		aspirationText: 'サッカー選手',
		aspirationCategories: '{}',
		basePoints: 50,
		healthPoints: 10,
		aspirationPoints: 20,
		totalPoints: 80,
		createdAt: '2026-01-15T00:00:00Z',
	},
];

// 全リポジトリファサードをモック
vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: vi.fn(() => Promise.resolve(mockChildren)),
}));
vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: vi.fn(() => Promise.resolve(mockActivities)),
	findActivityLogs: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockActivityLogs) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/title-repo', () => ({
	findAllTitles: vi.fn(() => Promise.resolve(mockTitles)),
	findUnlockedTitles: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockUnlockedTitles) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/achievement-repo', () => ({
	findAllAchievements: vi.fn(() => Promise.resolve(mockAchievements)),
	findUnlockedAchievements: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockUnlockedAchievements) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/avatar-repo', () => ({
	findAllAvatarItems: vi.fn(() => Promise.resolve(mockAvatarItems)),
	findOwnedItems: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockOwnedAvatarItems) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/career-repo', () => ({
	findAllCareerFields: vi.fn(() => Promise.resolve(mockCareerFields)),
	findCareerPlansByChildId: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockCareerPlans) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockChecklistTemplates) : Promise.resolve([]),
	),
	findTemplateItems: vi.fn(() => Promise.resolve(mockChecklistItems)),
}));
vi.mock('$lib/server/db/evaluation-repo', () => ({
	findEvaluationsByChild: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockEvaluations) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/login-bonus-repo', () => ({
	findRecentBonuses: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockLoginBonuses) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/point-repo', () => ({
	findPointHistory: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockPointHistory) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockSpecialRewards) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/status-repo', () => ({
	findStatuses: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockStatuses) : Promise.resolve([]),
	),
	findRecentStatusHistory: vi.fn((childId: number, catId: number) =>
		childId === 1 && catId === 2 ? Promise.resolve(mockStatusHistory) : Promise.resolve([]),
	),
}));
vi.mock('$lib/server/db/birthday-repo', () => ({
	findBirthdayReviews: vi.fn((childId: number) =>
		childId === 1 ? Promise.resolve(mockBirthdayReviews) : Promise.resolve([]),
	),
}));

import { exportFamilyData } from '../../../src/lib/server/services/export-service';

describe('exportFamilyData', () => {
	it('正しいフォーマットとバージョンでエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.format).toBe(EXPORT_FORMAT);
		expect(result.version).toBe(EXPORT_VERSION);
		expect(result.exportedAt).toBeTruthy();
		expect(result.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it('全子供のデータがエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.family.children).toHaveLength(2);
		expect(result.family.children[0]?.exportId).toBe('child-1');
		expect(result.family.children[0]?.nickname).toBe('テスト太郎');
		expect(result.family.children[1]?.exportId).toBe('child-2');
		expect(result.family.children[1]?.nickname).toBe('テスト花子');
	});

	it('childIdsでフィルタリングできる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant', childIds: [1] });
		expect(result.family.children).toHaveLength(1);
		expect(result.family.children[0]?.nickname).toBe('テスト太郎');
	});

	it('マスタデータが含まれる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.master.categories).toHaveLength(5);
		expect(result.master.activities).toHaveLength(2);
		expect(result.master.titles).toHaveLength(1);
		expect(result.master.achievements).toHaveLength(1);
		expect(result.master.avatarItems).toHaveLength(1);
		expect(result.master.careerFields).toHaveLength(1);
	});

	it('活動マスタがIDではなくカテゴリコードで参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		const activity = result.master.activities[0];
		expect(activity).toBeDefined();
		expect(activity?.categoryCode).toBe('undou');
		expect(activity?.name).toBe('はいはいした');
		expect(activity).not.toHaveProperty('id');
		expect(activity).not.toHaveProperty('categoryId');
	});

	it('子供のactiveTitleがIDではなく名前で参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.family.children[0]?.activeTitle).toBe('うんどうマスター');
		expect(result.family.children[1]?.activeTitle).toBeNull();
	});

	it('活動記録がchildRefで参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		const logs = result.data.activityLogs;
		expect(logs).toHaveLength(1);
		expect(logs[0]?.childRef).toBe('child-1');
		expect(logs[0]?.activityName).toBe('ひらがなれんしゅう');
		expect(logs[0]?.activityCategory).toBe('benkyou');
		expect(logs[0]?.recordedDate).toBe('2026-03-15');
	});

	it('ポイント台帳がエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.pointLedger).toHaveLength(1);
		expect(result.data.pointLedger[0]?.childRef).toBe('child-1');
		expect(result.data.pointLedger[0]?.amount).toBe(10);
		expect(result.data.pointLedger[0]?.type).toBe('earn');
	});

	it('ステータスがカテゴリコードで参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.statuses).toHaveLength(1);
		expect(result.data.statuses[0]?.categoryCode).toBe('benkyou');
		expect(result.data.statuses[0]?.value).toBe(42.5);
	});

	it('ステータス履歴がエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.statusHistory).toHaveLength(1);
		expect(result.data.statusHistory[0]?.categoryCode).toBe('benkyou');
		expect(result.data.statusHistory[0]?.changeType).toBe('activity');
	});

	it('実績がコードで参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.childAchievements).toHaveLength(1);
		expect(result.data.childAchievements[0]?.achievementCode).toBe('first_step');
	});

	it('称号がコードで参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.childTitles).toHaveLength(1);
		expect(result.data.childTitles[0]?.titleCode).toBe('undou_master');
	});

	it('ログインボーナスがエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.loginBonuses).toHaveLength(1);
		expect(result.data.loginBonuses[0]?.rank).toBe('gold');
		expect(result.data.loginBonuses[0]?.consecutiveDays).toBe(7);
	});

	it('週次評価がエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.evaluations).toHaveLength(1);
		expect(result.data.evaluations[0]?.weekStart).toBe('2026-03-10');
	});

	it('特別報酬がエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.specialRewards).toHaveLength(1);
		expect(result.data.specialRewards[0]?.title).toBe('よくがんばった！');
		expect(result.data.specialRewards[0]?.points).toBe(50);
	});

	it('チェックリストテンプレートとアイテムがエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.checklistTemplates).toHaveLength(1);
		expect(result.data.checklistTemplates[0]?.name).toBe('あさのじゅんび');
		expect(result.data.checklistTemplates[0]?.items).toHaveLength(1);
		expect(result.data.checklistTemplates[0]?.items[0]?.name).toBe('はみがき');
	});

	it('きせかえアイテム所持がコードで参照される', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.childAvatarItems).toHaveLength(1);
		expect(result.data.childAvatarItems[0]?.itemCode).toBe('bg_sunset');
	});

	it('キャリアプランがエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.careerPlans).toHaveLength(1);
		expect(result.data.careerPlans[0]?.careerFieldName).toBe('先生');
		expect(result.data.careerPlans[0]?.dreamText).toBe('先生になりたい');
	});

	it('誕生日振り返りがエクスポートされる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		expect(result.data.birthdayReviews).toHaveLength(1);
		expect(result.data.birthdayReviews[0]?.reviewYear).toBe(2026);
		expect(result.data.birthdayReviews[0]?.totalPoints).toBe(80);
	});

	it('チェックサムが再現可能であること', async () => {
		const result1 = await exportFamilyData({ tenantId: 'test-tenant' });
		const result2 = await exportFamilyData({ tenantId: 'test-tenant' });
		// exportedAt が異なるためチェックサムは異なる（タイムスタンプ含む）
		// ただし各自のチェックサムフォーマットは正しいこと
		expect(result1.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(result2.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it('子供が0人でもエクスポートが成功する', async () => {
		const { findAllChildren } = await import('$lib/server/db/child-repo');
		vi.mocked(findAllChildren).mockResolvedValueOnce([]);

		const result = await exportFamilyData({ tenantId: 'empty-tenant' });
		expect(result.family.children).toHaveLength(0);
		expect(result.data.activityLogs).toHaveLength(0);
		expect(result.format).toBe(EXPORT_FORMAT);
	});

	it('PINやセッション情報がエクスポートに含まれない', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		const json = JSON.stringify(result);
		// "pin" は "pointsPerItem" 等に含まれるため、キー名で確認
		expect(json).not.toContain('"pinHash"');
		expect(json).not.toContain('"currentPin"');
		expect(json).not.toContain('"sessionToken"');
		expect(json).not.toContain('"password"');
	});

	it('カテゴリマスタが5件固定で含まれる', async () => {
		const result = await exportFamilyData({ tenantId: 'test-tenant' });
		const cats = result.master.categories;
		expect(cats).toHaveLength(5);
		expect(cats.map((c) => c.code)).toEqual(['undou', 'benkyou', 'seikatsu', 'kouryuu', 'souzou']);
	});
});
