// tests/unit/server/db/demo/stub-repos.test.ts
// ADR-0048 §決定 §2: 残り全 Stub Repository (no fixture content) について、
// read API が空 / write API が no-op であり、いずれも例外を投げないことを一括検証。

import { describe, expect, it } from 'vitest';
import * as accountLockoutRepo from '../../../../../src/lib/server/db/demo/account-lockout-repo';
import * as activityMasteryRepo from '../../../../../src/lib/server/db/demo/activity-mastery-repo';
import * as activityPrefRepo from '../../../../../src/lib/server/db/demo/activity-pref-repo';
import * as battleRepo from '../../../../../src/lib/server/db/demo/battle-repo';
import * as cancellationReasonRepo from '../../../../../src/lib/server/db/demo/cancellation-reason-repo';
import * as cloudExportRepo from '../../../../../src/lib/server/db/demo/cloud-export-repo';
import * as evaluationRepo from '../../../../../src/lib/server/db/demo/evaluation-repo';
import * as graduationConsentRepo from '../../../../../src/lib/server/db/demo/graduation-consent-repo';
import * as imageRepo from '../../../../../src/lib/server/db/demo/image-repo';
import * as inquiryRepo from '../../../../../src/lib/server/db/demo/inquiry-repo';
import * as loginBonusRepo from '../../../../../src/lib/server/db/demo/login-bonus-repo';
import * as messageRepo from '../../../../../src/lib/server/db/demo/message-repo';
import * as pushSubscriptionRepo from '../../../../../src/lib/server/db/demo/push-subscription-repo';
import * as reportDailySummaryRepo from '../../../../../src/lib/server/db/demo/report-daily-summary-repo';
import * as rewardRedemptionRepo from '../../../../../src/lib/server/db/demo/reward-redemption-repo';
import * as seasonEventRepo from '../../../../../src/lib/server/db/demo/season-event-repo';
import * as siblingChallengeRepo from '../../../../../src/lib/server/db/demo/sibling-challenge-repo';
import * as siblingCheerRepo from '../../../../../src/lib/server/db/demo/sibling-cheer-repo';
import * as specialRewardRepo from '../../../../../src/lib/server/db/demo/special-reward-repo';
import * as storageRepo from '../../../../../src/lib/server/db/demo/storage-repo';
import * as tenantEventRepo from '../../../../../src/lib/server/db/demo/tenant-event-repo';
import * as trialHistoryRepo from '../../../../../src/lib/server/db/demo/trial-history-repo';
import * as viewerTokenRepo from '../../../../../src/lib/server/db/demo/viewer-token-repo';
import * as voiceRepo from '../../../../../src/lib/server/db/demo/voice-repo';

describe('demo/account-lockout-repo', () => {
	it('getLockout は null を返す (anonymous auth は lockout 不要)', async () => {
		expect(await accountLockoutRepo.getLockout('any@example.com')).toBeNull();
	});
	it('upsertLockout は no-op', async () => {
		await expect(
			accountLockoutRepo.upsertLockout({
				email: 'x',
				failedCount: 1,
				lockedUntil: null,
				lastFailedAt: null,
			}),
		).resolves.toBeUndefined();
	});
});

describe('demo/activity-mastery-repo', () => {
	it('findAllByChild / findByChildAndActivity は空', async () => {
		expect(await activityMasteryRepo.findAllByChild(902, 'demo')).toEqual([]);
		expect(await activityMasteryRepo.findByChildAndActivity(902, 1, 'demo')).toBeUndefined();
	});
	it('upsert は input から ActivityMastery を返す (no-op)', async () => {
		const r = await activityMasteryRepo.upsert(902, 1, 10, 2, 'demo');
		expect(r.childId).toBe(902);
		expect(r.level).toBe(2);
	});
});

describe('demo/activity-pref-repo', () => {
	it('findPinnedByChild は空', async () => {
		expect(await activityPrefRepo.findPinnedByChild(902, 'demo')).toEqual([]);
	});
	it('togglePin は ChildActivityPreference を返す (no-op)', async () => {
		const r = await activityPrefRepo.togglePin(902, 1, true, 'demo');
		expect(r.isPinned).toBe(1);
	});
});

// demo/auto-challenge-repo is fixture-backed (DEMO_AUTO_CHALLENGES) — covered in
// tests/unit/server/db/demo/auto-challenge-repo.test.ts (#2097 Phase B-4)

describe('demo/battle-repo', () => {
	// #2097 Phase B-5b: 902 (preschool) はバトル UI 対象外 / 401 はバトル対象外
	it('未登録 child や別日付なら findTodayBattle は undefined', async () => {
		expect(await battleRepo.findTodayBattle(902, '2026-04-01', 'demo')).toBeUndefined();
		expect(await battleRepo.findTodayBattle(99999, '2026-04-01', 'demo')).toBeUndefined();
	});
	it('battle UI 対象外 child の findRecentBattles は空', async () => {
		expect(await battleRepo.findRecentBattles(902, 5, 'demo')).toEqual([]);
		expect(await battleRepo.findRecentBattles(99999, 5, 'demo')).toEqual([]);
	});
	it('findCollection は空 (敵図鑑 fixture は別 Issue)', async () => {
		expect(await battleRepo.findCollection(902, 'demo')).toEqual([]);
	});
});

describe('demo/cancellation-reason-repo', () => {
	it('aggregateRecent は total=0', async () => {
		const r = await cancellationReasonRepo.aggregateRecent();
		expect(r.total).toBe(0);
		expect(r.breakdown).toEqual([]);
	});
});

describe('demo/cloud-export-repo', () => {
	it('findByTenant / findByPin は空', async () => {
		expect(await cloudExportRepo.findByTenant('demo')).toEqual([]);
		expect(await cloudExportRepo.findByPin('any')).toBeUndefined();
	});
	it('countByTenant は 0 / deleteExpired は 0', async () => {
		expect(await cloudExportRepo.countByTenant('demo')).toBe(0);
		expect(await cloudExportRepo.deleteExpired('any')).toBe(0);
	});
});

describe('demo/evaluation-repo', () => {
	it('findAllChildren は demo Children を返す (fixture 経由)', async () => {
		const children = await evaluationRepo.findAllChildren('demo');
		expect(children.length).toBeGreaterThan(0);
	});
	it('isRestDay は false', async () => {
		expect(await evaluationRepo.isRestDay(902, '2026-04-01', 'demo')).toBe(false);
	});
	// #2097 Phase B-5b: 週次評価 fixture を返す
	it('findEvaluationsByChild は fixture から件数を返す (902)', async () => {
		const result = await evaluationRepo.findEvaluationsByChild(902, 10, 'demo');
		expect(result.length).toBeGreaterThan(0);
		expect(result.every((e) => e.childId === 902)).toBe(true);
	});
});

describe('demo/graduation-consent-repo', () => {
	it('aggregateRecent は totalGraduations=0', async () => {
		const r = await graduationConsentRepo.aggregateRecent();
		expect(r.totalGraduations).toBe(0);
	});
});

describe('demo/image-repo', () => {
	it('findCachedImage は undefined', async () => {
		expect(await imageRepo.findCachedImage(902, 'avatar', 'hash', 'demo')).toBeUndefined();
	});
	it('findChildForImage は demo Child を返す', async () => {
		const child = await imageRepo.findChildForImage(902, 'demo');
		expect(child?.id).toBe(902);
	});
});

describe('demo/inquiry-repo', () => {
	it('generateInquiryId は deterministic dummy を返す', async () => {
		const id = await inquiryRepo.generateInquiryId();
		expect(id).toBe('DEMO-INQUIRY');
	});
	it('saveInquiry は no-op', async () => {
		await expect(
			inquiryRepo.saveInquiry({
				inquiryId: 'x',
				tenantId: null,
				email: 'a@b',
				replyEmail: null,
				category: 'general',
				body: '',
				status: 'open',
				createdAt: '2026-04-01T00:00:00.000Z',
			}),
		).resolves.toBeUndefined();
	});
});

describe('demo/login-bonus-repo', () => {
	it('findTodayBonus は fixture から該当があれば返す', async () => {
		// 902 の TODAY (2026-03-27) ボーナスは fixture に存在
		const r = await loginBonusRepo.findTodayBonus(902, '2026-03-27', 'demo');
		expect(r).toBeDefined();
		expect(r?.childId).toBe(902);
	});
	it('未存在 child + 別 date は undefined', async () => {
		expect(await loginBonusRepo.findTodayBonus(99999, '2020-01-01', 'demo')).toBeUndefined();
	});
});

describe('demo/message-repo', () => {
	it('findMessages / findUnshownMessage は空 / undefined', async () => {
		expect(await messageRepo.findMessages(902, 10, 'demo')).toEqual([]);
		expect(await messageRepo.findUnshownMessage(902, 'demo')).toBeUndefined();
		expect(await messageRepo.countUnshownMessages(902, 'demo')).toBe(0);
	});
});

describe('demo/push-subscription-repo', () => {
	it('findByTenant は空', async () => {
		expect(await pushSubscriptionRepo.findByTenant('demo')).toEqual([]);
	});
	it('countTodayLogs は 0', async () => {
		expect(await pushSubscriptionRepo.countTodayLogs('demo', '2026-04-01')).toBe(0);
	});
});

describe('demo/report-daily-summary-repo', () => {
	it('findByChildAndDateRange は空', async () => {
		expect(
			await reportDailySummaryRepo.findByChildAndDateRange(902, '2026-01-01', '2026-12-31', 'demo'),
		).toEqual([]);
	});
});

describe('demo/reward-redemption-repo', () => {
	it('findRedemptionRequestsByChild / Tenant は空', async () => {
		expect(await rewardRedemptionRepo.findRedemptionRequestsByChild(902, 'demo')).toEqual([]);
		expect(await rewardRedemptionRepo.findRedemptionRequestsByTenant('demo')).toEqual([]);
	});
});

describe('demo/season-event-repo', () => {
	it('findActiveEvents / findAllEvents は空', async () => {
		expect(await seasonEventRepo.findAllEvents('demo')).toEqual([]);
		expect(await seasonEventRepo.findActiveEvents('2026-04-01', 'demo')).toEqual([]);
	});
});

describe('demo/sibling-challenge-repo', () => {
	// #2097 Phase B-5b: fixture を返すので空ではない
	it('findAllChallenges は fixture 件数を返す', async () => {
		const challenges = await siblingChallengeRepo.findAllChallenges('demo');
		expect(challenges.length).toBeGreaterThan(0);
	});
	it('countTodayCheersFrom は 0 (write 系は stub)', async () => {
		// findActiveChallenges は date 範囲フィルタを行うため、範囲外は空が正常
		expect(await siblingChallengeRepo.findActiveChallenges('2099-01-01', 'demo')).toEqual([]);
	});
});

describe('demo/sibling-cheer-repo', () => {
	// #2097 Phase B-5b: 未表示 cheer fixture が含まれるため findUnshownCheers は件数を返す
	it('countTodayCheersFrom は 0', async () => {
		expect(await siblingCheerRepo.countTodayCheersFrom(902, 'demo')).toBe(0);
	});
});

describe('demo/special-reward-repo', () => {
	// #2097 Phase B-7: findSpecialRewards は marketplace 由来の pre-granted rewards を返す
	it('findSpecialRewards は 902 (kinder-rewards) で 5 件返す', async () => {
		const rewards = await specialRewardRepo.findSpecialRewards(902, 'demo');
		expect(rewards.length).toBe(5);
		expect(rewards.every((r) => r.childId === 902)).toBe(true);
		expect(rewards.every((r) => r.sourcePresetId === 'kinder-rewards')).toBe(true);
	});

	it('findSpecialRewards は 901 (baby、marketplace 対象外) で空配列', async () => {
		expect(await specialRewardRepo.findSpecialRewards(901, 'demo')).toEqual([]);
	});

	it('findUnshownReward は marketplace 由来 idx 0 (shownAt=null) を返す (#2097 B-5a)', async () => {
		const unshown = await specialRewardRepo.findUnshownReward(902, 'demo');
		expect(unshown).toBeDefined();
		expect(unshown?.childId).toBe(902);
		expect(unshown?.shownAt).toBeNull();
	});

	it('findUnshownReward は 901 (baby、marketplace 対象外) で undefined', async () => {
		expect(await specialRewardRepo.findUnshownReward(901, 'demo')).toBeUndefined();
	});
});

// NOTE: demo/stamp-card-repo は #2097 Phase B-2 で fixture 化したため、
// 固有テストを tests/unit/server/db/demo/stamp-card-repo.test.ts に移管。

describe('demo/storage-repo (S3 等への write 権限なし)', () => {
	it('readFile / fileExists / listFiles は空 / false', async () => {
		expect(await storageRepo.readFile('any')).toBeNull();
		expect(await storageRepo.fileExists('any')).toBe(false);
		expect(await storageRepo.listFiles('any')).toEqual([]);
	});
	it('saveFile は no-op (Lambda has no S3 write permission)', async () => {
		await expect(
			storageRepo.saveFile('any', Buffer.from('x'), 'text/plain'),
		).resolves.toBeUndefined();
	});
	it('deleteByPrefix は 0', async () => {
		expect(await storageRepo.deleteByPrefix('any')).toBe(0);
	});
});

describe('demo/tenant-event-repo', () => {
	it('findByTenantAndYear は空', async () => {
		expect(await tenantEventRepo.findByTenantAndYear('demo', 2026)).toEqual([]);
	});
});

describe('demo/trial-history-repo', () => {
	it('findLatestByTenant / findActiveTrials は undefined / 空', async () => {
		expect(await trialHistoryRepo.findLatestByTenant('demo')).toBeUndefined();
		expect(await trialHistoryRepo.findActiveTrials()).toEqual([]);
	});
});

describe('demo/viewer-token-repo', () => {
	it('findByTenant / findByToken は空 / undefined', async () => {
		expect(await viewerTokenRepo.findByTenant('demo')).toEqual([]);
		expect(await viewerTokenRepo.findByToken('any')).toBeUndefined();
	});
});

describe('demo/voice-repo', () => {
	it('findByChild / findActiveVoice / findById は空 / null', async () => {
		expect(await voiceRepo.findByChild(902, 'wakeup', 'demo')).toEqual([]);
		expect(await voiceRepo.findActiveVoice(902, 'wakeup', 'demo')).toBeNull();
		expect(await voiceRepo.findById(1, 'demo')).toBeNull();
	});
	it('insert は { id: 0 } dummy を返す', async () => {
		const r = await voiceRepo.insert({
			childId: 902,
			scene: 'wakeup',
			label: 'test',
			filePath: '/tmp/x',
			publicUrl: 'http://example.com/x',
			durationMs: null,
			isActive: 1,
			tenantId: 'demo',
		});
		expect(r.id).toBe(0);
	});
});
