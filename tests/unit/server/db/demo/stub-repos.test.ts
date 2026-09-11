// tests/unit/server/db/demo/stub-repos.test.ts
// ADR-0048 §決定 §2: 残り全 Stub Repository (no fixture content) について、
// read API が空 / write API が no-op であり、いずれも例外を投げないことを一括検証。

import { describe, expect, it } from 'vitest';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
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
// #2295 (EPIC #2294 ①): season-event-repo / tenant-event-repo 削除済 (2026-05-19)
// #2458 (Path B sibling drop): sibling-challenge-repo 削除済 (2026-05-26)、child-challenge-repo へ移行
import * as siblingCheerRepo from '../../../../../src/lib/server/db/demo/sibling-cheer-repo';
import * as specialRewardRepo from '../../../../../src/lib/server/db/demo/special-reward-repo';
import * as storageRepo from '../../../../../src/lib/server/db/demo/storage-repo';
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
		expect(await activityMasteryRepo.findAllByChild(asChildId(902), 'demo')).toEqual([]);
		expect(
			await activityMasteryRepo.findByChildAndActivity(asChildId(902), asActivityId(1), 'demo'),
		).toBeUndefined();
	});
	it('upsert は input から ActivityMastery を返す (no-op)', async () => {
		const r = await activityMasteryRepo.upsert(asChildId(902), asActivityId(1), 10, 2, 'demo');
		expect(r.childId).toBe('902');
		expect(r.level).toBe(2);
	});
});

describe('demo/activity-pref-repo', () => {
	it('findPinnedByChild は空', async () => {
		expect(await activityPrefRepo.findPinnedByChild(asChildId(902), 'demo')).toEqual([]);
	});
	it('togglePin は ChildActivityPreference を返す (no-op)', async () => {
		const r = await activityPrefRepo.togglePin(asChildId(902), asActivityId(1), true, 'demo');
		expect(r.isPinned).toBe(1);
	});

	// PR #4839: ピン留め上限の到達可否 (SS 撮影可否の根拠)。
	// `toggleActivityPin` service は `countPinnedInCategory(...) >= MAX_PINS_PER_CATEGORY` でのみ
	// PIN_LIMIT_EXCEEDED を投げる。demo backend の count は **常に 0** で、togglePin も永続しないため、
	// 何回ピン留めしても上限分岐に到達できない = 上限 toast は demo 環境では原理的に描画できない。
	// (ここが 0 でなくなったら demo でも撮影できるようになったということなので、
	//  PR body の ss-render-impossible 宣言を見直す。)
	it('countPinnedInCategory は togglePin を何度呼んでも 0 のまま (上限分岐に到達できない)', async () => {
		for (let i = 1; i <= 10; i++) {
			await activityPrefRepo.togglePin(asChildId(902), asActivityId(i), true, 'demo');
		}
		expect(
			await activityPrefRepo.countPinnedInCategory(asChildId(902), asCategoryId(1), 'demo'),
		).toBe(0);
	});
});

// #3213 (EPIC #3193): demo/auto-challenge-repo 削除済 (auto_challenges 廃止、child_challenges へ一本化)

describe('demo/battle-repo', () => {
	// #2097 Phase B-5b: 902 (preschool) はバトル UI 対象外 / 401 はバトル対象外
	it('未登録 child や別日付なら findTodayBattle は undefined', async () => {
		expect(await battleRepo.findTodayBattle(asChildId(902), '2026-04-01', 'demo')).toBeUndefined();
		expect(
			await battleRepo.findTodayBattle(asChildId(99999), '2026-04-01', 'demo'),
		).toBeUndefined();
	});
	it('battle UI 対象外 child の findRecentBattles は空', async () => {
		expect(await battleRepo.findRecentBattles(asChildId(902), 5, 'demo')).toEqual([]);
		expect(await battleRepo.findRecentBattles(asChildId(99999), 5, 'demo')).toEqual([]);
	});
	it('findCollection は空 (敵図鑑 fixture は別 Issue)', async () => {
		expect(await battleRepo.findCollection(asChildId(902), 'demo')).toEqual([]);
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
	// #2097 Phase B-5b: 週次評価 fixture を返す
	it('findEvaluationsByChild は fixture から件数を返す (902)', async () => {
		const result = await evaluationRepo.findEvaluationsByChild(asChildId(902), 10, 'demo');
		expect(result.length).toBeGreaterThan(0);
		expect(result.every((e) => e.childId === '902')).toBe(true);
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
		expect(
			await imageRepo.findCachedImage(asChildId(902), 'avatar', 'hash', 'demo'),
		).toBeUndefined();
	});
	it('findChildForImage は demo Child を返す', async () => {
		const child = await imageRepo.findChildForImage(asChildId(902), 'demo');
		expect(child?.id).toBe('902');
	});
	// #4466: 条件付き更新 (compare-and-set) も no-op。demo は書き込みを永続しないので
	// 踏み潰される写真自体が存在せず、条件検査は空回りになる。呼び出し元が false を
	// 「レースで負けた」と誤読して毎回 warn を出さないよう、無条件版と揃えて成功扱い。
	it('updateChildAvatarUrl / updateChildAvatarUrlIfMatches は no-op (後者は成功扱い)', async () => {
		await expect(
			imageRepo.updateChildAvatarUrl(asChildId(902), '/a.png', 'demo'),
		).resolves.toBeUndefined();
		expect(
			await imageRepo.updateChildAvatarUrlIfMatches(asChildId(902), null, '/a.png', 'demo'),
		).toBe(true);
		// 期待値が実データと合わない場合でも stub は分岐しない (永続しないので判定材料が無い)
		expect(
			await imageRepo.updateChildAvatarUrlIfMatches(asChildId(902), '/other.png', '/a.png', 'demo'),
		).toBe(true);
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

describe('demo/login-bonus-repo (#3330 counter 縮約)', () => {
	it('findStreak は fixture から該当 counter を返す', async () => {
		const r = await loginBonusRepo.findStreak(asChildId(902), 'demo');
		expect(r).toBeDefined();
		expect(r?.childId).toBe('902');
		expect(r?.currentStreak).toBeGreaterThan(0);
	});
	it('未存在 child は undefined', async () => {
		expect(await loginBonusRepo.findStreak(asChildId(99999), 'demo')).toBeUndefined();
	});
	it('claimToday は fixture 上 claim 済 (lastLoginDate=TODAY) なら undefined', async () => {
		const streak = await loginBonusRepo.findStreak(asChildId(902), 'demo');
		if (!streak) throw new Error('fixture missing');
		expect(
			await loginBonusRepo.claimToday(asChildId(902), streak.lastLoginDate, '2000-01-01', 'demo'),
		).toBeUndefined();
	});
});

describe('demo/message-repo', () => {
	it('findMessages / findUnshownMessage は空 / undefined', async () => {
		expect(await messageRepo.findMessages(asChildId(902), 10, 'demo')).toEqual([]);
		expect(await messageRepo.findUnshownMessage(asChildId(902), 'demo')).toBeUndefined();
		expect(await messageRepo.countUnshownMessages(asChildId(902), 'demo')).toBe(0);
	});
});

describe('demo/push-subscription-repo', () => {
	it('findByTenant は空', async () => {
		expect(await pushSubscriptionRepo.findByTenant('demo')).toEqual([]);
	});
	it('countLogsBetween は 0', async () => {
		expect(
			await pushSubscriptionRepo.countLogsBetween(
				'demo',
				'2026-04-01T00:00:00Z',
				'2026-04-02T00:00:00Z',
			),
		).toBe(0);
	});
});

describe('demo/report-daily-summary-repo', () => {
	// #4712: read は fixture 活動ログの集計を返す Fake になった (旧: 常に空 stub)。
	// 集計内容の検証は tests/unit/server/db/demo/report-daily-summary-repo.test.ts が担う。
	// ここでは「fixture 期間外は空」= 範囲条件が効いていることだけを見る。
	it('fixture 期間外の日付範囲では空', async () => {
		expect(
			await reportDailySummaryRepo.findByChildAndDateRange(
				asChildId(902),
				'1999-01-01',
				'1999-12-31',
				'demo',
			),
		).toEqual([]);
	});
});

describe('demo/reward-redemption-repo', () => {
	it('findRedemptionRequestsByChild / Tenant は空', async () => {
		expect(
			await rewardRedemptionRepo.findRedemptionRequestsByChild(asChildId(902), 'demo'),
		).toEqual([]);
		expect(await rewardRedemptionRepo.findRedemptionRequestsByTenant('demo')).toEqual([]);
	});
});

// #2295 (EPIC #2294 ①): demo/season-event-repo describe 削除済 (2026-05-19) — repo 自体撤去

// #2458 (Path B sibling drop): demo/sibling-challenge-repo describe 削除済 (2026-05-26)、
// repo / table 物理 drop 済。per-child child-challenge-repo に移行 (ADR-0055 / User §6)。

describe('demo/sibling-cheer-repo', () => {
	// #4691: きょうだい間おうえんは機能撤去済。demo は削除 no-op のみ。
	it('deleteByTenantId は no-op で throw しない', async () => {
		await expect(siblingCheerRepo.deleteByTenantId('demo')).resolves.toBeUndefined();
	});
});

describe('demo/special-reward-repo', () => {
	// #2097 Phase B-7: findSpecialRewards は marketplace 由来の pre-granted rewards を返す
	it('findSpecialRewards は 902 (kinder-rewards) で 5 件返す', async () => {
		const rewards = await specialRewardRepo.findSpecialRewards(asChildId(902), 'demo');
		expect(rewards.length).toBe(5);
		expect(rewards.every((r) => r.childId === '902')).toBe(true);
		expect(rewards.every((r) => r.sourcePresetId === 'kinder-rewards')).toBe(true);
	});

	it('findSpecialRewards は 901 (baby、marketplace 対象外) で空配列', async () => {
		expect(await specialRewardRepo.findSpecialRewards(asChildId(901), 'demo')).toEqual([]);
	});

	it('findUnshownReward は marketplace 由来 idx 0 (shownAt=null) を返す (#2097 B-5a)', async () => {
		const unshown = await specialRewardRepo.findUnshownReward(asChildId(902), 'demo');
		expect(unshown).toBeDefined();
		expect(unshown?.childId).toBe('902');
		expect(unshown?.shownAt).toBeNull();
	});

	it('findUnshownReward は 901 (baby、marketplace 対象外) で undefined', async () => {
		expect(await specialRewardRepo.findUnshownReward(asChildId(901), 'demo')).toBeUndefined();
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

// #2295 (EPIC #2294 ①): demo/tenant-event-repo describe 削除済 (2026-05-19) — repo 自体撤去

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
		expect(await voiceRepo.findByChild(asChildId(902), 'wakeup', 'demo')).toEqual([]);
		expect(await voiceRepo.findActiveVoice(asChildId(902), 'wakeup', 'demo')).toBeNull();
		expect(await voiceRepo.findById('1', 'demo')).toBeNull();
	});
	it('insert は { id: 0 } dummy を返す', async () => {
		const r = await voiceRepo.insert({
			childId: asChildId(902),
			scene: 'wakeup',
			label: 'test',
			filePath: '/tmp/x',
			publicUrl: 'http://example.com/x',
			durationMs: null,
			isActive: 1,
			tenantId: 'demo',
		});
		expect(r.id).toBe('0');
	});
});
