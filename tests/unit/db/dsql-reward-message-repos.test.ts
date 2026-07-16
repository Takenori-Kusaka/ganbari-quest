// tests/unit/db/dsql-reward-message-repos.test.ts
// EPIC #3424 / PR-R8 / 設計 SSOT: dsql-data-model.md §5 / §11.2 / §11.3 / §P9
//
// DSQL 報酬・メッセージ系 5 repo 実装のテスト (実 schema pushSchema、dsql-test-db helper)。
// 設計判断の要点:
//   - **total_point 共更新は不要**: sqlite backend の special-reward / reward-redemption repo は
//     children.total_point を一切触らない (ポイント付与/控除は service 層 = point-repo 経由)。
//     したがって本 5 repo は §5 P7 の共更新対象外。付与経路が repo に無いことを [RD-note] で明示。
//   - **§11.3 temporal 正規化**: reward_redemption の requested/resolved/shown は entity=epoch(number)、
//     DSQL 格納=timestamptz。repo が epoch↔ISO を境界変換する ([RR2] round-trip で検証)。
//   - **login_bonuses は surrogate id 無しの自然複合 PK** (family, child, login_date、daily-mission と
//     同型): entity.id は `child:login_date` 合成 ([LB1])。
//
// ── Canon TDD test list ──
// ── ISpecialRewardRepo ──
//   [SR1] insert + findSpecialRewards (降順) + §P9
//   [SR2] findUnshownReward (shown_at NULL の最新) / markRewardShown (composite key、他 child no-op)
//   [SR2b] #3581 ②: markRewardShown は非 uuid id で throw せず undefined (/shown +server の 22P02 fail-safe)
//   [SR3] updateSpecialReward (composite key、部分更新 / 空更新 = 現状返却 / 他 child no-op)
//   [SR4] deleteSpecialReward (解決済 redemption も同 txn cascade、他 child no-op) + hasPending は残す
//   [SR5] deleteByTenantId は §P9 tenant 限定 (他 tenant 無傷)
// ── IRewardRedemptionRepo ──
//   [RR1] insertRedemptionRequest: pending 固定 + 申請時点 snapshot 保存 + §P9
//   [RR2] epoch↔timestamptz round-trip (requestedAt を秒精度で保全)
//   [RR3] findByTenant (JOIN child/reward、snapshot 優先 COALESCE) + countByTenant (limit なし)
//   [RR4] updateRedemptionRequestStatus 遷移 (composite key、resolvedAt epoch 保全、他 child no-op)
//   [RR5] status CHECK 実効 (不正 status 直 INSERT 拒否)
//   [RR6] pending dedup (#3356 (1)) / findUnshownResultByChild / markRedemptionResultShown
//   [RR7] expireOldRedemptions (30 日超 pending → expired) / hasPendingByReward
//   [RR8] insertRedemptionForRestore (status/解決情報/snapshot verbatim)
// ── IMessageRepo ──
//   [MSG1] insertMessage (icon 既定 💌 は schema DEFAULT 経由) + findMessages 降順 + §P9
//   [MSG2] findUnshownMessage / countUnshownMessages / markMessageShown (composite、他 child no-op)
//   [MSG2b] #3581 ②: markMessageShown は非 uuid id で throw せず undefined (/shown +server の 22P02 fail-safe)
//   [MSG3] insertForRestore (sentAt/shownAt verbatim) + message_type CHECK 実効
// ── ISiblingCheerRepo ──
//   [SC1] insertCheer (from/to 2 参照、tenantId=family マップ) + findUnshownCheers + §P9
//   [SC2] markShown (複数 id 一括、空は no-op) / countTodayCheersFrom (JST 当日境界)
//   [SC3] findAllByTenant + insertForRestore (sentAt/shownAt verbatim)
//   [SC4] #3566 ②: from/to child ∈ family を INSERT ... SELECT JOIN children で構造強制
//         (cross-family child は 0 行 → throw、行は書かれない)
// ── ILoginBonusRepo ──
//   [LB1] insertLoginBonus 冪等 (自然複合 PK ON CONFLICT、id=child:date 合成) + findTodayBonus + §P9
//   [LB2] findRecentBonuses (login_date 降順 limit) / findChildById (§P9)
//   [LB3] deleteLoginBonusesBeforeDate (strict less than) / deleteByTenantId §P9

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asChildId, type ChildId } from '../../../src/lib/domain/ids';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlLoginBonusRepo } from '../../../src/lib/server/db/dsql/login-bonus-repo';
import { createDsqlMessageRepo } from '../../../src/lib/server/db/dsql/message-repo';
import { createDsqlRewardRedemptionRepo } from '../../../src/lib/server/db/dsql/reward-redemption-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import { createDsqlSiblingCheerRepo } from '../../../src/lib/server/db/dsql/sibling-cheer-repo';
import { createDsqlSpecialRewardRepo } from '../../../src/lib/server/db/dsql/special-reward-repo';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { ILoginBonusRepo } from '../../../src/lib/server/db/interfaces/login-bonus-repo.interface';
import type { IMessageRepo } from '../../../src/lib/server/db/interfaces/message-repo.interface';
import type { IRewardRedemptionRepo } from '../../../src/lib/server/db/interfaces/reward-redemption-repo.interface';
import { REDEMPTION_DEDUP_WINDOW_SEC } from '../../../src/lib/server/db/interfaces/reward-redemption-repo.interface';
import type { ISiblingCheerRepo } from '../../../src/lib/server/db/interfaces/sibling-cheer-repo.interface';
import type { ISpecialRewardRepo } from '../../../src/lib/server/db/interfaces/special-reward-repo.interface';
import type { TransactionRunner } from '../../../src/lib/server/db/interfaces/transaction.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

/** insertRedemptionRequest の union 戻り値を row に unwrap する (#3356 (1))。dedup 発火は失敗扱い。 */
function mustRow<T>(r: T | { error: 'DUPLICATE_REQUEST' }): T {
	if (r && typeof r === 'object' && 'error' in (r as object)) {
		throw new Error('unexpected DUPLICATE_REQUEST');
	}
	return r as T;
}

const FAMILY = '00000000-0000-4000-8000-0000000000d1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000d2';
const UUID_RE = /^[0-9a-f-]{36}$/;

describe('DSQL reward / message repos (PR-R8、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let rewardRepo: ISpecialRewardRepo;
	let redemptionRepo: IRewardRedemptionRepo;
	let messageRepo: IMessageRepo;
	let cheerRepo: ISiblingCheerRepo;
	let loginBonusRepo: ILoginBonusRepo;
	let runner: TransactionRunner<SqlExecutor>;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	const seedReward = async (childId: ChildId, title: string, points: number, family = FAMILY) =>
		rewardRepo.insertSpecialReward({ childId, title, points, category: 'privilege' }, family);

	const countRows = async (query: ReturnType<typeof sql>): Promise<number> => {
		const r = await t.db.execute(query);
		return Number((r.rows[0] as { c: unknown }).c);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		rewardRepo = createDsqlSpecialRewardRepo(t.db, runner);
		redemptionRepo = createDsqlRewardRedemptionRepo(t.db, runner);
		messageRepo = createDsqlMessageRepo(t.db);
		cheerRepo = createDsqlSiblingCheerRepo(t.db);
		loginBonusRepo = createDsqlLoginBonusRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── ISpecialRewardRepo ───────────────────

	it('[SR1] insertSpecialReward + findSpecialRewards (granted_at 降順) + §P9', async () => {
		const childId = await newChild('報酬一郎');
		const a = await rewardRepo.insertSpecialReward(
			{
				childId,
				title: 'アイス',
				points: 50,
				category: 'physical',
				icon: '🍦',
				grantedBy: 'parent-1',
				sourcePresetId: 'preset-9',
				shopCategory: 'physical',
			},
			FAMILY,
		);
		expect(a.id).toMatch(UUID_RE);
		expect(a.childId).toBe(childId);
		expect(a.title).toBe('アイス');
		expect(a.icon).toBe('🍦');
		expect(a.grantedBy).toBe('parent-1');
		expect(a.sourcePresetId).toBe('preset-9');
		expect(a.shopCategory).toBe('physical');
		expect(a.shownAt).toBe(null);

		await new Promise((r) => setTimeout(r, 5));
		const b = await seedReward(childId, 'ゲーム時間', 30);
		const list = await rewardRepo.findSpecialRewards(childId, FAMILY);
		expect(list.map((r) => r.title)).toEqual(['ゲーム時間', 'アイス']); // granted_at 降順
		expect(b.description).toBe(null);
		// §P9
		expect(await rewardRepo.findSpecialRewards(childId, OTHER_FAMILY)).toEqual([]);
	});

	it('[SR2] findUnshownReward + markRewardShown (composite key、他 child no-op)', async () => {
		const childId = await newChild('報酬二郎');
		const stranger = await newChild('他人二郎');
		const r1 = await seedReward(childId, '古い', 10);
		await new Promise((r) => setTimeout(r, 5));
		const r2 = await seedReward(childId, '新しい', 20);

		const unshown = await rewardRepo.findUnshownReward(childId, FAMILY);
		expect(unshown?.id).toBe(r2.id); // 最新の未表示

		// 他 child を名乗った mark は no-op
		expect(await rewardRepo.markRewardShown(stranger, r2.id, FAMILY)).toBe(undefined);
		expect((await rewardRepo.findUnshownReward(childId, FAMILY))?.id).toBe(r2.id);

		const shown = await rewardRepo.markRewardShown(childId, r2.id, FAMILY);
		expect(shown?.shownAt).not.toBe(null);
		// r2 が既読になったので次の未表示は r1
		expect((await rewardRepo.findUnshownReward(childId, FAMILY))?.id).toBe(r1.id);
	});

	it('[SR2b] #3581 ②: markRewardShown は非 uuid id で throw せず undefined (22P02 正規化)', async () => {
		// `/api/v1/special-rewards/[rewardId]/shown` POST (+server) が stale cookie 由来の旧数値 id を
		// 直達させる repo 入口。guard 無しだと WHERE child_id = <非uuid> で 22P02 throw → 500。
		// undefined = 「対象なし」(endpoint は 404 で graceful) に正規化する。
		for (const bad of ['3', 'not-a-uuid', '']) {
			await expect(rewardRepo.markRewardShown(asChildId(bad), 'r-x', FAMILY)).resolves.toBe(
				undefined,
			);
		}
	});

	it('[SR3] updateSpecialReward (composite、部分更新 / 空更新 = 現状 / 他 child no-op)', async () => {
		const childId = await newChild('報酬三郎');
		const stranger = await newChild('他人三郎');
		const r = await seedReward(childId, '元タイトル', 40);

		// 他 child は no-op (undefined)
		expect(await rewardRepo.updateSpecialReward(stranger, r.id, { title: 'X' }, FAMILY)).toBe(
			undefined,
		);

		const updated = await rewardRepo.updateSpecialReward(
			childId,
			r.id,
			{ title: '新タイトル', points: 99, icon: null, shopCategory: 'money' },
			FAMILY,
		);
		expect(updated?.title).toBe('新タイトル');
		expect(updated?.points).toBe(99);
		expect(updated?.icon).toBe(null);
		expect(updated?.shopCategory).toBe('money');

		// 空更新は現状を返す (副作用なし)
		const noop = await rewardRepo.updateSpecialReward(childId, r.id, {}, FAMILY);
		expect(noop?.title).toBe('新タイトル');
		expect(noop?.points).toBe(99);
	});

	it('[SR4] deleteSpecialReward: 解決済 redemption も同 txn 削除、他 child no-op', async () => {
		const childId = await newChild('報酬四郎');
		const stranger = await newChild('他人四郎');
		const reward = await seedReward(childId, '削除対象', 15);
		// 解決済 (approved) の申請履歴を作る
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: Math.floor(Date.now() / 1000) },
				FAMILY,
			),
		);
		await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			req.id,
			{ status: 'approved', resolvedAt: Math.floor(Date.now() / 1000) },
			FAMILY,
		);

		// 他 child を名乗った削除は no-op
		expect(await rewardRepo.deleteSpecialReward(stranger, reward.id, FAMILY)).toBe(false);
		expect((await rewardRepo.findSpecialRewards(childId, FAMILY)).length).toBe(1);

		expect(await rewardRepo.deleteSpecialReward(childId, reward.id, FAMILY)).toBe(true);
		expect((await rewardRepo.findSpecialRewards(childId, FAMILY)).length).toBe(0);
		// FK 整合: 交換申請履歴も同 txn で消える
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM reward_redemption_requests WHERE reward_id = ${reward.id}`,
			),
		).toBe(0);
	});

	it('[SR5] deleteByTenantId: §P9 tenant 限定 (他 tenant 無傷)', async () => {
		const mine = await newChild('全削除五郎', OTHER_FAMILY);
		const keep = await newChild('無傷五郎');
		await seedReward(mine, '消える', 10, OTHER_FAMILY);
		await seedReward(keep, '残る', 10);

		await rewardRepo.deleteByTenantId(OTHER_FAMILY);
		expect((await rewardRepo.findSpecialRewards(mine, OTHER_FAMILY)).length).toBe(0);
		expect((await rewardRepo.findSpecialRewards(keep, FAMILY)).length).toBe(1);
	});

	// ─────────────────── IRewardRedemptionRepo ───────────────────

	it('[RR1] insertRedemptionRequest: pending 固定 + 申請時点 snapshot 保存 + §P9', async () => {
		const childId = await newChild('交換一郎');
		const reward = await rewardRepo.insertSpecialReward(
			{ childId, title: 'スナップ元', points: 60, icon: '🎮', category: 'privilege' },
			FAMILY,
		);
		const at = Math.floor(Date.now() / 1000);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: at },
				FAMILY,
			),
		);
		expect(req.id).toMatch(UUID_RE);
		expect(req.status).toBe('pending_parent_approval');
		expect(req.childId).toBe(childId);
		expect(req.rewardId).toBe(reward.id);
		expect(req.resolvedAt).toBe(null);

		// 申請後に reward を編集しても snapshot は申請時点の値のまま
		await rewardRepo.updateSpecialReward(
			childId,
			reward.id,
			{ title: '編集後', points: 999 },
			FAMILY,
		);
		const details = await redemptionRepo.findRedemptionRequestsByTenant(FAMILY, { childId });
		expect(details[0]?.rewardTitle).toBe('スナップ元'); // snapshot 優先
		expect(details[0]?.rewardPoints).toBe(60);
		expect(details[0]?.rewardIcon).toBe('🎮');
		expect(details[0]?.childName).toBe('交換一郎');
		// §P9
		expect(await redemptionRepo.findRedemptionRequestsByChild(childId, OTHER_FAMILY)).toEqual([]);
	});

	it('[RR2] epoch↔timestamptz round-trip: requestedAt を秒精度で保全', async () => {
		const childId = await newChild('時刻二郎');
		const reward = await seedReward(childId, '時刻報酬', 10);
		const at = 1_781_000_000; // 固定 epoch 秒
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: at },
				FAMILY,
			),
		);
		expect(req.requestedAt).toBe(at);
		const roundTrip = await redemptionRepo.findRedemptionRequestsByChild(childId, FAMILY);
		expect(roundTrip[0]?.requestedAt).toBe(at); // ISO 変換往復でも秒一致
	});

	it('[RR3] findByTenant (JOIN + snapshot COALESCE) + countByTenant (limit なし)', async () => {
		const family = '00000000-0000-4000-8000-0000000000d3';
		const childId = await newChild('件数三郎', family);
		// #3356 (1): 同一 (child, reward) の pending は dedup で 1 件に制限されるため、
		// 件数系の検証は別 reward 3 種で行う (dedup 自体の検証は [RR9])。
		for (let i = 0; i < 3; i++) {
			const reward = await seedReward(childId, `件数報酬${i}`, 10, family);
			mustRow(
				await redemptionRepo.insertRedemptionRequest(
					{ childId, rewardId: reward.id, requestedAt: Math.floor(Date.now() / 1000) + i },
					family,
				),
			);
		}
		// 1 件を approved に
		const all = await redemptionRepo.findRedemptionRequestsByChild(childId, family);
		await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			all[0]!.id,
			{ status: 'approved' },
			family,
		);
		expect(await redemptionRepo.countRedemptionRequestsByTenant(family)).toBe(3);
		expect(
			await redemptionRepo.countRedemptionRequestsByTenant(family, {
				status: 'pending_parent_approval',
			}),
		).toBe(2);
		const pendingOnly = await redemptionRepo.findRedemptionRequestsByTenant(family, {
			status: 'pending_parent_approval',
		});
		expect(pendingOnly.length).toBe(2);
	});

	it('[RR4] updateRedemptionRequestStatus: 遷移 + resolvedAt epoch 保全 + composite no-op', async () => {
		const childId = await newChild('遷移四郎');
		const stranger = await newChild('他人四2郎');
		const reward = await seedReward(childId, '遷移報酬', 10);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: Math.floor(Date.now() / 1000) },
				FAMILY,
			),
		);
		// 他 child を名乗った更新は no-op
		expect(
			await redemptionRepo.updateRedemptionRequestStatus(
				stranger,
				req.id,
				{ status: 'rejected' },
				FAMILY,
			),
		).toBe(undefined);

		const resolvedAt = 1_781_500_000;
		const updated = await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			req.id,
			{ status: 'approved', parentNote: 'よくがんばった', resolvedAt, resolvedByParentId: 'p-1' },
			FAMILY,
		);
		expect(updated?.status).toBe('approved');
		expect(updated?.parentNote).toBe('よくがんばった');
		expect(updated?.resolvedAt).toBe(resolvedAt); // epoch 保全
		expect(updated?.resolvedByParentId).toBe('p-1');
	});

	it('[RR5] status CHECK 実効: 不正 status 直 INSERT 拒否', async () => {
		const childId = await newChild('制約五郎');
		const reward = await seedReward(childId, '制約報酬', 10);
		await expect(
			t.db.execute(sql`
				INSERT INTO reward_redemption_requests (family_id, child_id, reward_id, requested_at, status)
				VALUES (${FAMILY}, ${String(childId)}, ${reward.id}, now(), 'bogus')
			`),
		).rejects.toThrow(); // reward_redemption_requests_status_ck
	});

	it('[RR6] pending dedup / findUnshownResult / markRedemptionResultShown', async () => {
		const childId = await newChild('通知六郎');
		const reward = await seedReward(childId, '通知報酬', 10);
		const at = Math.floor(Date.now() / 1000);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: at },
				FAMILY,
			),
		);
		// #3356 (1): pending 既存中の再申請は repo 原子境界で DUPLICATE_REQUEST
		// (旧 findPendingByChildAndReward の check-then-act を repo に内蔵)
		const dup = await redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward.id, requestedAt: at + 1 },
			FAMILY,
		);
		expect(dup).toEqual({ error: 'DUPLICATE_REQUEST' });

		// pending 中は未表示結果なし
		expect(await redemptionRepo.findUnshownResultByChild(childId, FAMILY)).toBe(undefined);

		await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			req.id,
			{ status: 'approved', resolvedAt: Math.floor(Date.now() / 1000) },
			FAMILY,
		);
		// approved 後は pending なし (count で検証)
		expect(
			await redemptionRepo.countRedemptionRequestsByTenant(FAMILY, {
				status: 'pending_parent_approval',
				childId,
			}),
		).toBe(0);
		const result = await redemptionRepo.findUnshownResultByChild(childId, FAMILY);
		expect(result?.id).toBe(req.id);
		expect(result?.rewardTitle).toBe('通知報酬'); // snapshot

		const marked = await redemptionRepo.markRedemptionResultShown(childId, req.id, FAMILY);
		expect(marked?.shownToChildAt).not.toBe(null);
		expect(await redemptionRepo.findUnshownResultByChild(childId, FAMILY)).toBe(undefined);
	});

	it('[RR9] #3356 (1) dedup: 直近 approved 窓内の再申請は DUPLICATE / 窓外は許可 / fire→settle 並行申請は 1 件のみ成立', async () => {
		const family = '00000000-0000-4000-8000-0000000000d9';
		const childId = await newChild('連打九郎', family);
		const reward = await seedReward(childId, '連打報酬', 10, family);
		const now = Math.floor(Date.now() / 1000);

		// 1 回目 → 即時 approved (即時交換の流れを再現)
		const first = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: now },
				family,
			),
		);
		await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			first.id,
			{ status: 'approved', resolvedAt: now },
			family,
		);

		// 窓内 (resolvedAt から REDEMPTION_DEDUP_WINDOW_SEC 以内) の再申請 = 連打/再送 → DUPLICATE
		const withinWindow = await redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward.id, requestedAt: now + 2 },
			family,
		);
		expect(withinWindow).toEqual({ error: 'DUPLICATE_REQUEST' });

		// 窓外 (意図的な連続購入) は許可
		const afterWindow = await redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward.id, requestedAt: now + REDEMPTION_DEDUP_WINDOW_SEC + 5 },
			family,
		);
		expect('error' in afterWindow).toBe(false);
		// 後続 case を汚さないよう解消しておく
		await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			mustRow(afterWindow).id,
			{ status: 'rejected', resolvedAt: now },
			family,
		);

		// fire→settle 並行申請 (#3531 パターン): 同時 2 発は一方のみ成立
		const reward2 = await seedReward(childId, '並行報酬', 10, family);
		const fireA = redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward2.id, requestedAt: now + 100 },
			family,
		);
		const fireB = redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward2.id, requestedAt: now + 100 },
			family,
		);
		const settled = await Promise.all([fireA, fireB]);
		expect(settled.filter((r) => !('error' in r))).toHaveLength(1);
		expect(settled.filter((r) => 'error' in r)).toHaveLength(1);
	});

	it('[RR7] expireOldRedemptions (30 日超 pending → expired) / hasPendingByReward', async () => {
		// expireOldRedemptions は tenant 全体を走査するため、[RR3] と同様に専用 family へ隔離する。
		// 共有 FAMILY だと他 case が残す pending (例 [RR2] の固定 epoch) が cutoff を跨いだ日に
		// 混入し expired 件数が非決定になる (time-bomb)。tenant 隔離で件数を決定的にする。
		const family = '00000000-0000-4000-8000-0000000000d7';
		const childId = await newChild('期限七郎', family);
		const reward = await seedReward(childId, '期限報酬', 10, family);
		const old = Math.floor(Date.now() / 1000) - 40 * 24 * 60 * 60; // 40 日前
		mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: old },
				family,
			),
		);
		expect(await redemptionRepo.hasPendingByReward(reward.id, family)).toBe(true);

		const expired = await redemptionRepo.expireOldRedemptions(family);
		expect(expired).toBe(1);
		expect(await redemptionRepo.hasPendingByReward(reward.id, family)).toBe(false);
		const rows = await redemptionRepo.findRedemptionRequestsByChild(childId, family);
		expect(rows[0]?.status).toBe('expired');
	});

	it('[RR8] insertRedemptionForRestore: status/解決情報/snapshot verbatim', async () => {
		const childId = await newChild('復元八郎');
		const reward = await seedReward(childId, 'live報酬', 10);
		const requestedAt = 1_780_000_000;
		const resolvedAt = 1_780_100_000;
		const shownToChildAt = 1_780_200_000;
		const restored = await redemptionRepo.insertRedemptionForRestore(
			{
				childId,
				rewardId: reward.id,
				requestedAt,
				status: 'rejected',
				parentNote: '却下理由',
				resolvedAt,
				resolvedByParentId: 'p-9',
				shownToChildAt,
				rewardTitle: 'snap名',
				rewardPoints: 77,
				rewardIcon: '🎁',
			},
			FAMILY,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(restored.status).toBe('rejected'); // pending 固定でなく verbatim
		expect(restored.requestedAt).toBe(requestedAt);
		expect(restored.resolvedAt).toBe(resolvedAt);
		expect(restored.shownToChildAt).toBe(shownToChildAt);
		expect(restored.parentNote).toBe('却下理由');
		// snapshot verbatim (live reward=live報酬/10 でなく snap名/77)
		const details = await redemptionRepo.findRedemptionRequestsByTenant(FAMILY, { childId });
		expect(details.find((d) => d.id === restored.id)?.rewardTitle).toBe('snap名');
		expect(details.find((d) => d.id === restored.id)?.rewardPoints).toBe(77);
	});

	// ─────────────────── IMessageRepo ───────────────────

	it('[MSG1] insertMessage (icon 既定 💌 = schema DEFAULT) + findMessages 降順 + §P9', async () => {
		const childId = await newChild('伝言一郎');
		const m1 = await messageRepo.insertMessage(
			{ childId, messageType: 'text', body: 'おはよう' },
			FAMILY,
		);
		expect(m1.id).toMatch(UUID_RE);
		expect(m1.icon).toBe('💌'); // schema DEFAULT 経由
		expect(m1.shownAt).toBe(null);
		await new Promise((r) => setTimeout(r, 5));
		const m2 = await messageRepo.insertMessage(
			{
				childId,
				messageType: 'reward_notice',
				body: 'ごほうび',
				icon: '🎁',
				bonusPoints: 20,
				rewardCategory: 'physical',
			},
			FAMILY,
		);
		expect(m2.icon).toBe('🎁');
		expect(m2.bonusPoints).toBe(20);
		expect(m2.rewardCategory).toBe('physical');

		const list = await messageRepo.findMessages(childId, 10, FAMILY);
		expect(list.map((m) => m.body)).toEqual(['ごほうび', 'おはよう']); // sent_at 降順
		expect(await messageRepo.findMessages(childId, 10, OTHER_FAMILY)).toEqual([]);
	});

	it('[MSG2] findUnshownMessage / countUnshownMessages / markMessageShown (composite no-op)', async () => {
		const childId = await newChild('伝言二郎');
		const stranger = await newChild('他人二郎b');
		await messageRepo.insertMessage({ childId, messageType: 'text', body: 'a' }, FAMILY);
		await new Promise((r) => setTimeout(r, 5));
		const m2 = await messageRepo.insertMessage({ childId, messageType: 'text', body: 'b' }, FAMILY);
		expect(await messageRepo.countUnshownMessages(childId, FAMILY)).toBe(2);
		expect((await messageRepo.findUnshownMessage(childId, FAMILY))?.body).toBe('b'); // 最新

		// 他 child を名乗った mark は no-op
		expect(await messageRepo.markMessageShown(stranger, m2.id, FAMILY)).toBe(undefined);
		expect(await messageRepo.countUnshownMessages(childId, FAMILY)).toBe(2);

		await messageRepo.markMessageShown(childId, m2.id, FAMILY);
		expect(await messageRepo.countUnshownMessages(childId, FAMILY)).toBe(1);
		expect((await messageRepo.findUnshownMessage(childId, FAMILY))?.body).toBe('a');
	});

	it('[MSG2b] #3581 ②: markMessageShown は非 uuid id で throw せず undefined (22P02 正規化)', async () => {
		// `/api/v1/messages/[messageId]/shown` POST (+server) が stale cookie 由来の旧数値 id を
		// 直達させる repo 入口。undefined = 「対象なし」(endpoint は notFound で graceful) に正規化する。
		for (const bad of ['3', 'not-a-uuid', '']) {
			await expect(messageRepo.markMessageShown(asChildId(bad), 'm-x', FAMILY)).resolves.toBe(
				undefined,
			);
		}
	});

	it('[MSG3] insertForRestore (sentAt/shownAt verbatim) + message_type CHECK', async () => {
		const childId = await newChild('伝言三郎');
		const restored = await messageRepo.insertForRestore(
			{
				childId,
				messageType: 'stamp',
				stampCode: 'good',
				body: null,
				icon: '⭐',
				sentAt: '2025-12-01T08:00:00+00:00',
				shownAt: '2025-12-02T09:00:00+00:00',
				bonusPoints: null,
				rewardCategory: null,
			},
			FAMILY,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(Date.parse(restored.sentAt)).toBe(Date.parse('2025-12-01T08:00:00+00:00'));
		expect(Date.parse(restored.shownAt ?? '')).toBe(Date.parse('2025-12-02T09:00:00+00:00'));
		expect(restored.stampCode).toBe('good');

		await expect(
			t.db.execute(sql`
				INSERT INTO parent_messages (family_id, child_id, message_type)
				VALUES (${FAMILY}, ${String(childId)}, 'bogus')
			`),
		).rejects.toThrow(); // parent_messages_message_type_ck
	});

	// ─────────────────── ISiblingCheerRepo ───────────────────

	it('[SC1] insertCheer (from/to + tenantId=family) + findUnshownCheers + §P9', async () => {
		const from = await newChild('応援元一郎');
		const to = await newChild('応援先一郎');
		const cheer = await cheerRepo.insertCheer(
			{ fromChildId: from, toChildId: to, stampCode: 'good' },
			FAMILY,
		);
		expect(cheer.id).toMatch(UUID_RE);
		expect(cheer.fromChildId).toBe(from);
		expect(cheer.toChildId).toBe(to);
		expect(cheer.tenantId).toBe(FAMILY); // family_id → tenantId マップ
		expect(cheer.shownAt).toBe(null);

		const unshown = await cheerRepo.findUnshownCheers(to, FAMILY);
		expect(unshown.map((c) => c.id)).toEqual([cheer.id]);
		expect(await cheerRepo.findUnshownCheers(to, OTHER_FAMILY)).toEqual([]);
		// from 宛には来ない
		expect(await cheerRepo.findUnshownCheers(from, FAMILY)).toEqual([]);
	});

	it('[SC2] markShown (一括、空 no-op) / countTodayCheersFrom (JST 当日境界)', async () => {
		const from = await newChild('応援元二郎');
		const to = await newChild('応援先二郎');
		const c1 = await cheerRepo.insertCheer(
			{ fromChildId: from, toChildId: to, stampCode: 's1' },
			FAMILY,
		);
		const c2 = await cheerRepo.insertCheer(
			{ fromChildId: from, toChildId: to, stampCode: 's2' },
			FAMILY,
		);
		await cheerRepo.markShown([], FAMILY); // no-op
		expect((await cheerRepo.findUnshownCheers(to, FAMILY)).length).toBe(2);
		await cheerRepo.markShown([c1.id, c2.id], FAMILY);
		expect(await cheerRepo.findUnshownCheers(to, FAMILY)).toEqual([]);

		// 当日送信 2 件 = カウント 2 (今 insert したものは JST 当日)
		expect(await cheerRepo.countTodayCheersFrom(from, FAMILY)).toBe(2);
		// 昨日以前の cheer は当日カウントに入らない (restore で過去 sentAt を差し込む)
		await cheerRepo.insertForRestore(
			{
				fromChildId: from,
				toChildId: to,
				stampCode: 'old',
				sentAt: '2020-01-01T00:00:00+09:00',
				shownAt: null,
			},
			FAMILY,
		);
		expect(await cheerRepo.countTodayCheersFrom(from, FAMILY)).toBe(2); // 過去分は含まない
		expect(await cheerRepo.countTodayCheersFrom(from, OTHER_FAMILY)).toBe(0);
	});

	it('[SC3] findAllByTenant + insertForRestore (sentAt/shownAt verbatim)', async () => {
		const family = '00000000-0000-4000-8000-0000000000d4';
		const from = await newChild('応援元三郎', family);
		const to = await newChild('応援先三郎', family);
		const restored = await cheerRepo.insertForRestore(
			{
				fromChildId: from,
				toChildId: to,
				stampCode: 'restore',
				sentAt: '2025-11-01T10:00:00+00:00',
				shownAt: '2025-11-02T10:00:00+00:00',
			},
			family,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(restored.id).toMatch(UUID_RE);
		expect(Date.parse(restored.sentAt)).toBe(Date.parse('2025-11-01T10:00:00+00:00'));
		expect(Date.parse(restored.shownAt ?? '')).toBe(Date.parse('2025-11-02T10:00:00+00:00'));

		const all = await cheerRepo.findAllByTenant(family);
		expect(all.length).toBe(1);
		expect(all[0]?.stampCode).toBe('restore');
		expect(await cheerRepo.findAllByTenant(OTHER_FAMILY)).not.toContainEqual(
			expect.objectContaining({ id: restored.id }),
		);
	});

	it('[SC4] #3566 ②: from/to のどちらかが family 外 child なら insert 拒否 (0 行、行は書かれない)', async () => {
		const family = '00000000-0000-4000-8000-0000000000d5';
		const from = await newChild('応援元四郎', family);
		const to = await newChild('応援先四郎', family);
		// 別 family に属する child (cross-family 混入の攻撃面)
		const alien = await newChild('他家の子', OTHER_FAMILY);

		// (a) 同一 family の from/to → 成功 (INSERT ... SELECT が 1 行返す)
		const ok = await cheerRepo.insertCheer(
			{ fromChildId: from, toChildId: to, stampCode: 'ok' },
			family,
		);
		expect(ok.id).toMatch(UUID_RE);
		expect(ok.fromChildId).toBe(from);
		expect(ok.toChildId).toBe(to);
		expect(ok.tenantId).toBe(family);

		const before = (await cheerRepo.findAllByTenant(family)).length;
		expect(before).toBe(1);

		// (b1) 送信先が family 外 child → 拒否 (SELECT 0 行 → throw)
		await expect(
			cheerRepo.insertCheer({ fromChildId: from, toChildId: alien, stampCode: 'x' }, family),
		).rejects.toThrow();

		// (b2) 送信元が family 外 child → 拒否
		await expect(
			cheerRepo.insertCheer({ fromChildId: alien, toChildId: to, stampCode: 'x' }, family),
		).rejects.toThrow();

		// (b3) どの family にも存在しない child id → 拒否
		const ghost = '00000000-0000-4000-8000-0000000009ff' as ChildId;
		await expect(
			cheerRepo.insertCheer({ fromChildId: from, toChildId: ghost, stampCode: 'x' }, family),
		).rejects.toThrow();

		// 拒否ケースでは 1 行も追加されていない (structural: 0 行挿入)
		expect((await cheerRepo.findAllByTenant(family)).length).toBe(before);
	});

	// ─────────────────── ILoginBonusRepo ───────────────────

	it('[LB1] insertLoginBonus 冪等 (自然複合 PK、id=child:date) + findTodayBonus + §P9', async () => {
		const childId = await newChild('ボーナス一郎');
		const input = {
			childId,
			loginDate: '2026-07-01',
			rank: 'daikichi',
			basePoints: 10,
			multiplier: 1.5,
			totalPoints: 15,
			consecutiveDays: 3,
		};
		const first = await loginBonusRepo.insertLoginBonus(input, FAMILY);
		expect(first.id).toBe(`${childId}:2026-07-01`); // 合成 id
		expect(first.totalPoints).toBe(15);
		expect(first.multiplier).toBe(1.5);
		// 同日再挿入は ON CONFLICT DO NOTHING で既存行を冪等に返す (1日1回)
		const second = await loginBonusRepo.insertLoginBonus({ ...input, totalPoints: 999 }, FAMILY);
		expect(second.id).toBe(first.id);
		expect(second.totalPoints).toBe(15); // 上書きされない
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM login_bonuses
				WHERE family_id = ${FAMILY} AND child_id = ${String(childId)} AND login_date = '2026-07-01'
			`),
		).toBe(1);

		const today = await loginBonusRepo.findTodayBonus(childId, '2026-07-01', FAMILY);
		expect(today?.id).toBe(first.id);
		expect(await loginBonusRepo.findTodayBonus(childId, '2026-07-01', OTHER_FAMILY)).toBe(
			undefined,
		);
		expect(await loginBonusRepo.findTodayBonus(childId, '2000-01-01', FAMILY)).toBe(undefined);
	});

	it('[LB2] findRecentBonuses (login_date 降順 limit) / findChildById (§P9)', async () => {
		const childId = await newChild('ボーナス二郎');
		for (const d of ['2026-06-01', '2026-06-03', '2026-06-02']) {
			await loginBonusRepo.insertLoginBonus(
				{
					childId,
					loginDate: d,
					rank: 'kichi',
					basePoints: 5,
					multiplier: 1,
					totalPoints: 5,
					consecutiveDays: 1,
				},
				FAMILY,
			);
		}
		const recent = await loginBonusRepo.findRecentBonuses(childId, FAMILY, 2);
		expect(recent.map((b) => b.loginDate)).toEqual(['2026-06-03', '2026-06-02']); // 降順 + limit

		const child = await loginBonusRepo.findChildById(childId, FAMILY);
		expect(child?.nickname).toBe('ボーナス二郎');
		expect(await loginBonusRepo.findChildById(childId, OTHER_FAMILY)).toBe(undefined);
	});

	it('[LB3] deleteLoginBonusesBeforeDate (strict <) / deleteByTenantId §P9', async () => {
		const childId = await newChild('ボーナス三郎');
		for (const d of ['2026-05-01', '2026-05-15', '2026-06-01']) {
			await loginBonusRepo.insertLoginBonus(
				{
					childId,
					loginDate: d,
					rank: 'kichi',
					basePoints: 5,
					multiplier: 1,
					totalPoints: 5,
					consecutiveDays: 1,
				},
				FAMILY,
			);
		}
		// cutoff 2026-05-15: 当日は残す (strict less than)
		const deleted = await loginBonusRepo.deleteLoginBonusesBeforeDate(
			childId,
			'2026-05-15',
			FAMILY,
		);
		expect(deleted).toBe(1); // 05-01 のみ
		const remain = await loginBonusRepo.findRecentBonuses(childId, FAMILY);
		expect(remain.map((b) => b.loginDate).sort()).toEqual(['2026-05-15', '2026-06-01']);

		// §P9 tenant 限定削除
		const otherChild = await newChild('他家三郎', OTHER_FAMILY);
		await loginBonusRepo.insertLoginBonus(
			{
				childId: otherChild,
				loginDate: '2026-06-01',
				rank: 'kichi',
				basePoints: 5,
				multiplier: 1,
				totalPoints: 5,
				consecutiveDays: 1,
			},
			OTHER_FAMILY,
		);
		await loginBonusRepo.deleteByTenantId(FAMILY);
		expect((await loginBonusRepo.findRecentBonuses(childId, FAMILY)).length).toBe(0);
		expect((await loginBonusRepo.findRecentBonuses(otherChild, OTHER_FAMILY)).length).toBe(1);
	});
});
