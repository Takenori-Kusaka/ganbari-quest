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
//   - **login_streaks は counter 縮約 (#3330 案 B)**: 子供ごと 1 行 (family, child) の counter。
//     当日冪等は claimToday の conditional write ([LB1]、race 詳細は dsql-login-streak-repo.test.ts)。
//
// ── Canon TDD test list ──
// ── ISpecialRewardRepo ──
//   [SR1] insert + findSpecialRewards (降順) + §P9
//   [SR2] findUnshownReward (shown_at NULL の最新) / markRewardShown (composite key、他 child no-op)
//   [SR2b] #3581 ②: markRewardShown は非 uuid child id で throw せず undefined (/shown +server の 22P02 fail-safe)
//   [SR2c] #3799: markRewardShown は非 uuid rewardId (URL param) でも throw せず undefined
//   [SR2d] #4435: markRewardShown は冪等 (再送で初回時刻を保つ) / 既読済み再送も行を返す
//   [SR3] updateSpecialReward (composite key、部分更新 / 空更新 = 現状返却 / 他 child no-op)
//   [SR4] deleteSpecialReward (解決済 redemption も同 txn cascade、他 child no-op) + hasPending は残す
//   [SR5] deleteByTenantId は §P9 tenant 限定 (他 tenant 無傷)
//   [SR6] #3566 ③: granted_by (polymorphic text 旧int/新uuid/null) を verbatim 保全 + tenant-scoped read (COPPA 追跡性)
// ── IRewardRedemptionRepo ──
//   [RR1] insertRedemptionRequest: pending 固定 + 申請時点 snapshot 保存 + §P9
//   [RR2] epoch↔timestamptz round-trip (requestedAt を秒精度で保全)
//   [RR3] findByTenant (JOIN child/reward、snapshot 優先 COALESCE) + countByTenant (limit なし)
//   [RR3b] #3566 ①: LEFT JOIN で snapshot 権威化 — live reward 削除後も申請が snapshot 値で残る
//   [RR4] updateRedemptionRequestStatus 遷移 (composite key、resolvedAt epoch 保全、他 child no-op)
//   [RR5] status CHECK 実効 (不正 status 直 INSERT 拒否)
//   [RR6] pending dedup (#3356 (1)) / approved 遷移後に pending が残らない
//         (#4435: findUnshownResultByChild / markRedemptionResultShown は到達不能経路として撤去)
//   [RR7] expireOldRedemptions (30 日超 pending → expired) / hasPendingByReward
//   [RR8] insertRedemptionForRestore (status/解決情報/snapshot verbatim)
// ── IMessageRepo ──
//   [MSG1] insertMessage (icon 既定 💌 は schema DEFAULT 経由) + findMessages 降順 + §P9
//   [MSG2] findUnshownMessage / countUnshownMessages / markMessageShown (composite、他 child no-op)
//   [MSG2b] #3581 ②: markMessageShown は非 uuid child id で throw せず undefined (/shown +server の 22P02 fail-safe)
//   [MSG2c] #3799: markMessageShown は非 uuid messageId (URL param) でも throw せず undefined
//   [MSG2d] #4435: markMessageShown は冪等 (再送で初回時刻を保つ) / 既読済み再送も行を返す
//   [MSG3] insertForRestore (sentAt/shownAt verbatim) + message_type CHECK 実効
// ── ISiblingCheerRepo ──
//   [SC1] insertCheer (from/to 2 参照、tenantId=family マップ) + findUnshownCheers + §P9
//   [SC2] markShown (複数 id 一括、空は no-op) / countTodayCheersFrom (JST 当日境界)
//   [SC2b] #4435: markShown は to_child_id 所有権 (別の子は既読にできない) + `shown_at IS NULL` 冪等
//   [SC3] findAllByTenant + insertForRestore (sentAt/shownAt verbatim)
//   [SC4] #3566 ②: from/to child ∈ family を INSERT ... SELECT JOIN children で構造強制
//         (cross-family child は 0 行 → throw、行は書かれない)
//   [SC5] #3566 ②: insertForRestore も同型 guard (dangling/cross-family backup 行を repo 入口で拒否)
// ── ILoginBonusRepo (#3330 counter 縮約) ──
//   [LB1] claimToday 当日冪等 (conditional write、同日 2 回目は undefined) + findStreak + §P9
//   [LB2] claimToday increment (前日連続 +1) / reset (途切れ 1) / findChildById (§P9)
//   [LB3] upsertStreak merge (新しい lastLoginDate 優先、同日は streak 大) / deleteByTenantId §P9

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

	it('[SR2c] #3799: markRewardShown は非 uuid rewardId (URL param) でも throw せず undefined', async () => {
		// cookie childId が有効 uuid でも、URL param `[rewardId]` が非 uuid だと
		// `reward_id = <非uuid>` で 22P02 → 500 になる。undefined (endpoint 404) に正規化する。
		const childId = await newChild('報酬二郎c');
		await seedReward(childId, 'ある報酬', 10);
		for (const bad of ['3', 'not-a-uuid', '']) {
			await expect(rewardRepo.markRewardShown(childId, bad, FAMILY)).resolves.toBe(undefined);
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
				{ childId, rewardId: reward.id, requestedAt: Math.floor(Date.now() / 1000), quantity: 1 },
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

	it('[SR6] #3566 ③: granted_by (polymorphic text) 付与主体を verbatim 保全 + tenant-scoped read (COPPA 追跡性)', async () => {
		// granted_by は polymorphic text (旧 int 由来の数値文字列 / 新 uuid / null 混在)。
		// 付与主体の監査証跡 (誰がごほうびを付与したか) を repo が coerce せず verbatim 保全し、
		// かつ read が §P9 tenant-scoped であることを担保する (cross-tenant で付与者が漏れない)。
		const childId = await newChild('付与六郎');
		const legacyIntGrantor = '42'; // 旧 integer granted_by 由来の数値文字列
		const uuidGrantor = '00000000-0000-4000-8000-0000000000ab'; // 新 uuid 由来
		await rewardRepo.insertSpecialReward(
			{ childId, title: '旧付与', points: 10, category: 'privilege', grantedBy: legacyIntGrantor },
			FAMILY,
		);
		await new Promise((r) => setTimeout(r, 5));
		await rewardRepo.insertSpecialReward(
			{ childId, title: '新付与', points: 20, category: 'privilege', grantedBy: uuidGrantor },
			FAMILY,
		);
		await new Promise((r) => setTimeout(r, 5));
		await rewardRepo.insertSpecialReward(
			{ childId, title: '付与者なし', points: 30, category: 'privilege' },
			FAMILY,
		);

		const list = await rewardRepo.findSpecialRewards(childId, FAMILY);
		const byTitle = Object.fromEntries(list.map((r) => [r.title, r.grantedBy]));
		// polymorphic の両形式 + null が coerce されず verbatim で返る (監査で付与主体を追跡可能)
		expect(byTitle.旧付与).toBe(legacyIntGrantor);
		expect(byTitle.新付与).toBe(uuidGrantor);
		expect(byTitle.付与者なし).toBe(null);

		// §P9: cross-tenant read は付与主体 (granted_by) を一切露出しない
		expect(await rewardRepo.findSpecialRewards(childId, OTHER_FAMILY)).toEqual([]);
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
				{ childId, rewardId: reward.id, requestedAt: at, quantity: 1 },
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

	// #4407: 個数 (quantity) の backend 並行実装整合 (sqlite ⇄ dsql/PGlite)。
	// tests/CLAUDE.md §スキーマ変更 PR — 新カラムの既定値 / 明示値ハンドリングを両実装で一致させる。
	it('[RR1b] #4407 quantity: 明示 N が保全され、未指定行 (DEFAULT) は 1 として読める', async () => {
		const childId = await newChild('個数一郎');
		const reward = await seedReward(childId, '個数報酬', 30);
		const at = Math.floor(Date.now() / 1000);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: at, quantity: 4 },
				FAMILY,
			),
		);
		expect(req.quantity).toBe(4);
		const byChild = await redemptionRepo.findRedemptionRequestsByChild(childId, FAMILY);
		expect(byChild[0]?.quantity).toBe(4);
		const details = await redemptionRepo.findRedemptionRequestsByTenant(FAMILY, { childId });
		expect(details[0]?.quantity).toBe(4);

		// quantity 列を指定せず直 INSERT した行 (= 列追加前からある既存行と同じ形) は DEFAULT 1
		await t.db.execute(sql`
			INSERT INTO reward_redemption_requests (family_id, child_id, reward_id, requested_at, status)
			VALUES (${FAMILY}::uuid, ${childId}::uuid, ${reward.id}::uuid, to_timestamp(${at + 1}), 'approved')
		`);
		const all = await redemptionRepo.findRedemptionRequestsByChild(childId, FAMILY);
		expect(all).toHaveLength(2);
		expect(all.every((r) => r.quantity >= 1)).toBe(true);
		expect(all.find((r) => r.status === 'approved')?.quantity).toBe(1);
	});

	// #4407: repo 入口の値域収束 (service validator を通らない経路の最終防壁)。
	// DSQL は ALTER TABLE ADD CONSTRAINT 非対応で後付け CHECK を置けないため、application 側の
	// normalizeRedemptionQuantity を全 backend の insert が通ることを behavior で表明する。
	// 0 / 負値が永続化されると承認時の 単価 × 個数 が 0 / 負 = 「減算のつもりが付与」になる。
	it('[RR1c] #4407 値域外 quantity は repo 入口で 1 に収束する (0 / 負 / 上限超過 / 小数)', async () => {
		const childId = await newChild('値域一郎');
		const reward = await seedReward(childId, '値域報酬', 30);
		const at = Math.floor(Date.now() / 1000);
		for (const [i, bad] of [0, -3, 1000, 2.5].entries()) {
			const req = mustRow(
				await redemptionRepo.insertRedemptionRequest(
					{ childId, rewardId: reward.id, requestedAt: at + i * 100, quantity: bad },
					FAMILY,
				),
			);
			expect(req.quantity, `quantity=${bad} は 1 に収束する`).toBe(1);
			// dedup 窓を跨ぐため申請ごとに解決済みへ倒す
			await redemptionRepo.updateRedemptionRequestStatus(
				childId,
				req.id,
				{ status: 'rejected', resolvedAt: at - 3600 },
				FAMILY,
			);
		}
		// restore 経路も同じ防壁を通る
		const restored = await redemptionRepo.insertRedemptionForRestore(
			{
				childId,
				rewardId: reward.id,
				requestedAt: at,
				quantity: -1,
				status: 'approved',
				parentNote: null,
				resolvedAt: at,
				resolvedByParentId: null,
				shownToChildAt: null,
				rewardTitle: '値域報酬',
				rewardPoints: 30,
				rewardIcon: null,
			},
			FAMILY,
		);
		expect(restored?.quantity).toBe(1);
	});

	it('[RR2] epoch↔timestamptz round-trip: requestedAt を秒精度で保全', async () => {
		const childId = await newChild('時刻二郎');
		const reward = await seedReward(childId, '時刻報酬', 10);
		const at = 1_781_000_000; // 固定 epoch 秒
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: at, quantity: 1 },
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
					{
						childId,
						rewardId: reward.id,
						requestedAt: Math.floor(Date.now() / 1000) + i,
						quantity: 1,
					},
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

	it('[RR3b] #3566 ①: 申請一覧は snapshot を権威とする — live reward 削除後も申請が snapshot 値で残る', async () => {
		// 元 reward が削除・改名された後も「申請時点の約束 (title/points/icon)」を守る。
		// INNER JOIN special_rewards だと reward 消失で申請行が一覧から脱落し顧客期待報酬が消える。
		// snapshot 権威 = LEFT JOIN で、reward 不在でも rr.reward_* snapshot を返す。
		const family = '00000000-0000-4000-8000-0000000000d6';
		const childId = await newChild('約束六郎', family);
		const reward = await rewardRepo.insertSpecialReward(
			{ childId, title: 'ゲーム機', points: 500, icon: '🎮', category: 'physical' },
			family,
		);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: Math.floor(Date.now() / 1000), quantity: 1 },
				family,
			),
		);
		// 承認済みにする (子供のショップ / 履歴が結果を読む状態にする)
		await redemptionRepo.updateRedemptionRequestStatus(
			childId,
			req.id,
			{ status: 'approved', resolvedAt: Math.floor(Date.now() / 1000) },
			family,
		);

		// live reward を物理削除 (backup restore で reward 未再取込 / 将来の削除経路を模した orphan)。
		await t.db.execute(sql`
			DELETE FROM special_rewards
			WHERE family_id = ${family} AND child_id = ${childId} AND reward_id = ${reward.id}
		`);

		// 親向け申請一覧: reward 消失後も snapshot 値で 1 件残る (顧客期待報酬を消さない)。
		const details = await redemptionRepo.findRedemptionRequestsByTenant(family);
		expect(details).toHaveLength(1);
		expect(details[0]?.rewardTitle).toBe('ゲーム機');
		expect(details[0]?.rewardPoints).toBe(500);
		expect(details[0]?.rewardIcon).toBe('🎮');

		// child 側 (ショップのバッジ / 履歴が読む経路) からも申請が消えない。
		// #4435: 旧 findUnshownResultByChild は到達不能経路として撤去したため、実際に
		// 子供画面が使う findRedemptionRequestsByChild で同じ不変条件を固定する。
		const forChild = await redemptionRepo.findRedemptionRequestsByChild(childId, family);
		expect(forChild).toHaveLength(1);
		expect(forChild[0]?.status).toBe('approved');
	});

	it('[RR4] updateRedemptionRequestStatus: 遷移 + resolvedAt epoch 保全 + composite no-op', async () => {
		const childId = await newChild('遷移四郎');
		const stranger = await newChild('他人四2郎');
		const reward = await seedReward(childId, '遷移報酬', 10);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: Math.floor(Date.now() / 1000), quantity: 1 },
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

	it('[RR6] pending dedup / approved 遷移で pending が残らない', async () => {
		const childId = await newChild('通知六郎');
		const reward = await seedReward(childId, '通知報酬', 10);
		const at = Math.floor(Date.now() / 1000);
		const req = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: at, quantity: 1 },
				FAMILY,
			),
		);
		// #3356 (1): pending 既存中の再申請は repo 原子境界で DUPLICATE_REQUEST
		// (旧 findPendingByChildAndReward の check-then-act を repo に内蔵)
		const dup = await redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward.id, requestedAt: at + 1, quantity: 1 },
			FAMILY,
		);
		expect(dup).toEqual({ error: 'DUPLICATE_REQUEST' });

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
		// 申請時点 snapshot は解決後も残る (#2832 / #3566 ①)
		const all = await redemptionRepo.findRedemptionRequestsByTenant(FAMILY, { childId });
		expect(all.find((r) => r.id === req.id)?.rewardTitle).toBe('通知報酬');
	});

	it('[RR9] #3356 (1) dedup: 直近 approved 窓内の再申請は DUPLICATE / 窓外は許可 / fire→settle 並行申請は 1 件のみ成立', async () => {
		const family = '00000000-0000-4000-8000-0000000000d9';
		const childId = await newChild('連打九郎', family);
		const reward = await seedReward(childId, '連打報酬', 10, family);
		const now = Math.floor(Date.now() / 1000);

		// 1 回目 → 即時 approved (即時交換の流れを再現)
		const first = mustRow(
			await redemptionRepo.insertRedemptionRequest(
				{ childId, rewardId: reward.id, requestedAt: now, quantity: 1 },
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
			{ childId, rewardId: reward.id, requestedAt: now + 2, quantity: 1 },
			family,
		);
		expect(withinWindow).toEqual({ error: 'DUPLICATE_REQUEST' });

		// 窓外 (意図的な連続購入) は許可
		const afterWindow = await redemptionRepo.insertRedemptionRequest(
			{
				childId,
				rewardId: reward.id,
				requestedAt: now + REDEMPTION_DEDUP_WINDOW_SEC + 5,
				quantity: 1,
			},
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
			{ childId, rewardId: reward2.id, requestedAt: now + 100, quantity: 1 },
			family,
		);
		const fireB = redemptionRepo.insertRedemptionRequest(
			{ childId, rewardId: reward2.id, requestedAt: now + 100, quantity: 1 },
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
				{ childId, rewardId: reward.id, requestedAt: old, quantity: 1 },
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
				// #4407: 個数も verbatim 保全する (backup round-trip で 1 個に潰れない)
				quantity: 3,
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
		expect(restored.quantity).toBe(3); // #4407: 個数 verbatim
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

	it('[MSG2c] #3799: markMessageShown は非 uuid messageId (URL param) でも throw せず undefined', async () => {
		// cookie childId が有効 uuid でも、URL param `[messageId]` が非 uuid だと
		// `msg_id = <非uuid>` で 22P02 → 500 になる。undefined (endpoint notFound) に正規化する。
		const childId = await newChild('伝言二郎c');
		await messageRepo.insertMessage({ childId, messageType: 'text', body: 'ある' }, FAMILY);
		for (const bad of ['3', 'not-a-uuid', '']) {
			await expect(messageRepo.markMessageShown(childId, bad, FAMILY)).resolves.toBe(undefined);
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
		await cheerRepo.markShown(to, [], FAMILY); // no-op
		expect((await cheerRepo.findUnshownCheers(to, FAMILY)).length).toBe(2);
		await cheerRepo.markShown(to, [c1.id, c2.id], FAMILY);
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

	it('[SC2b] #4435 markShown は to_child_id 所有権 + shown_at IS NULL 冪等', async () => {
		const family = '00000000-0000-4000-8000-0000000000e1';
		const ani = await newChild('あに', family);
		const otouto = await newChild('おとうと', family);
		const cheer = await cheerRepo.insertCheer(
			{ fromChildId: ani, toChildId: otouto, stampCode: 'ganbare' },
			family,
		);

		// 兄が弟宛のおうえん id を送っても既読にならない (弟は必ず見られる)
		await cheerRepo.markShown(ani, [cheer.id], family);
		expect((await cheerRepo.findUnshownCheers(otouto, family)).length).toBe(1);

		// 受け取る子が既読にする → 初回時刻を過去へ固定 → 再送しても上書きされない
		await cheerRepo.markShown(otouto, [cheer.id], family);
		await t.db.execute(sql`
			UPDATE sibling_cheers SET shown_at = '2025-01-02T03:04:05Z'::timestamptz
			WHERE family_id = ${family} AND cheer_id = ${cheer.id}
		`);
		await cheerRepo.markShown(otouto, [cheer.id], family);
		const rows = await cheerRepo.findAllByTenant(family);
		expect(Date.parse(rows[0]?.shownAt ?? '')).toBe(Date.parse('2025-01-02T03:04:05Z'));
	});

	it('[SR2d][MSG2d] #4435 markRewardShown / markMessageShown は冪等 (初回時刻を保つ)', async () => {
		const family = '00000000-0000-4000-8000-0000000000e2';
		const childId = await newChild('冪等子', family);
		const other = await newChild('別の子', family);
		const reward = await seedReward(childId, '冪等報酬', 5, family);
		const msg = await messageRepo.insertMessage(
			{ childId, body: 'おつかれさま', messageType: 'text' },
			family,
		);

		await rewardRepo.markRewardShown(childId, reward.id, family);
		await messageRepo.markMessageShown(childId, msg.id, family);
		await t.db.execute(sql`
			UPDATE special_rewards SET shown_at = '2025-01-02T03:04:05Z'::timestamptz
			WHERE family_id = ${family} AND reward_id = ${reward.id}
		`);
		await t.db.execute(sql`
			UPDATE parent_messages SET shown_at = '2025-01-02T03:04:05Z'::timestamptz
			WHERE family_id = ${family} AND msg_id = ${msg.id}
		`);

		// 再送しても初回時刻は動かず、かつ「見つからない」ではなく行が返る (endpoint の 404 と区別)
		const reRew = await rewardRepo.markRewardShown(childId, reward.id, family);
		const reMsg = await messageRepo.markMessageShown(childId, msg.id, family);
		expect(Date.parse(reRew?.shownAt ?? '')).toBe(Date.parse('2025-01-02T03:04:05Z'));
		expect(Date.parse(reMsg?.shownAt ?? '')).toBe(Date.parse('2025-01-02T03:04:05Z'));

		// 別の子からの mark は既読済みでも undefined のまま (所有権)
		expect(await rewardRepo.markRewardShown(other, reward.id, family)).toBe(undefined);
		expect(await messageRepo.markMessageShown(other, msg.id, family)).toBe(undefined);
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

	it('[SC5] #3566 ②: insertForRestore も from/to child ∈ family を構造強制 (dangling backup 拒否)', async () => {
		// restore 経路は untrusted backup 由来。insertCheer の [SC4] guard と同型に、
		// INSERT ... SELECT JOIN children で from/to child ∈ family を強制する (VALUES 直書きだと
		// dangling / cross-family 行が入る #3566 ② の gap を repo 入口で塞ぐ)。
		const family = '00000000-0000-4000-8000-0000000000d6';
		const from = await newChild('復元元五郎', family);
		const to = await newChild('復元先五郎', family);
		const alien = await newChild('他家の復元子', OTHER_FAMILY);
		const ghost = '00000000-0000-4000-8000-00000000faff' as ChildId;

		const before = (await cheerRepo.findAllByTenant(family)).length;

		// (a) 同一 family の from/to → 成功 (sentAt/shownAt verbatim も保全)
		const ok = await cheerRepo.insertForRestore(
			{
				fromChildId: from,
				toChildId: to,
				stampCode: 'restore-ok',
				sentAt: '2025-10-01T09:00:00+00:00',
				shownAt: '2025-10-02T09:00:00+00:00',
			},
			family,
		);
		if (!ok) throw new Error('insertForRestore returned null for fresh in-family row');
		expect(ok.fromChildId).toBe(from);
		expect(ok.toChildId).toBe(to);
		expect(Date.parse(ok.sentAt)).toBe(Date.parse('2025-10-01T09:00:00+00:00'));
		expect(Date.parse(ok.shownAt ?? '')).toBe(Date.parse('2025-10-02T09:00:00+00:00'));

		const seeded = (await cheerRepo.findAllByTenant(family)).length;
		expect(seeded).toBe(before + 1);

		// (b1) 送信先が family 外 child → 拒否 (SELECT 0 行 → throw、行は書かれない)
		await expect(
			cheerRepo.insertForRestore(
				{ fromChildId: from, toChildId: alien, stampCode: 'x', sentAt: ok.sentAt, shownAt: null },
				family,
			),
		).rejects.toThrow();

		// (b2) 送信元が family 外 child → 拒否
		await expect(
			cheerRepo.insertForRestore(
				{ fromChildId: alien, toChildId: to, stampCode: 'x', sentAt: ok.sentAt, shownAt: null },
				family,
			),
		).rejects.toThrow();

		// (b3) どの family にも存在しない dangling child id → 拒否
		await expect(
			cheerRepo.insertForRestore(
				{ fromChildId: from, toChildId: ghost, stampCode: 'x', sentAt: ok.sentAt, shownAt: null },
				family,
			),
		).rejects.toThrow();

		// 拒否ケースでは 1 行も追加されていない (structural: guard を外すと dangling 行が入り fail する)
		expect((await cheerRepo.findAllByTenant(family)).length).toBe(seeded);
	});

	// ─────────────────── ILoginBonusRepo (#3330 counter 縮約) ───────────────────

	it('[LB1] claimToday 当日冪等 (conditional write) + findStreak + §P9', async () => {
		const childId = await newChild('ボーナス一郎');
		// 初回 claim → streak 1
		const first = await loginBonusRepo.claimToday(childId, '2026-07-01', '2026-06-30', FAMILY);
		expect(first).toEqual({ currentStreak: 1 });
		// 同日 2 回目 → conditional write が 0 行で claim 敗北 (undefined)
		const second = await loginBonusRepo.claimToday(childId, '2026-07-01', '2026-06-30', FAMILY);
		expect(second).toBe(undefined);
		// counter は 1 行のまま
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM login_streaks
				WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
			`),
		).toBe(1);

		const streak = await loginBonusRepo.findStreak(childId, FAMILY);
		expect(streak?.lastLoginDate).toBe('2026-07-01');
		expect(streak?.currentStreak).toBe(1);
		expect(streak?.updatedAt).toBeTruthy();
		// §P9: 他 family からは見えない
		expect(await loginBonusRepo.findStreak(childId, OTHER_FAMILY)).toBe(undefined);
	});

	it('[LB2] claimToday increment (前日連続) / reset (途切れ) / findChildById (§P9)', async () => {
		const childId = await newChild('ボーナス二郎');
		expect(await loginBonusRepo.claimToday(childId, '2026-06-01', '2026-05-31', FAMILY)).toEqual({
			currentStreak: 1,
		});
		// 翌日 claim (yesterday=06-01 一致) → increment
		expect(await loginBonusRepo.claimToday(childId, '2026-06-02', '2026-06-01', FAMILY)).toEqual({
			currentStreak: 2,
		});
		// 1 日空けて claim (yesterday=06-03 ≠ lastLoginDate=06-02) → reset
		expect(await loginBonusRepo.claimToday(childId, '2026-06-04', '2026-06-03', FAMILY)).toEqual({
			currentStreak: 1,
		});
		const streak = await loginBonusRepo.findStreak(childId, FAMILY);
		expect(streak?.lastLoginDate).toBe('2026-06-04');
		expect(streak?.currentStreak).toBe(1);

		const child = await loginBonusRepo.findChildById(childId, FAMILY);
		expect(child?.nickname).toBe('ボーナス二郎');
		expect(await loginBonusRepo.findChildById(childId, OTHER_FAMILY)).toBe(undefined);
	});

	it('[LB3] upsertStreak merge (新 lastLoginDate 優先 / 同日は streak 大) + deleteByTenantId §P9', async () => {
		const childId = await newChild('ボーナス三郎');
		// 新規 upsert
		expect(
			await loginBonusRepo.upsertStreak(
				{ childId, lastLoginDate: '2026-05-10', currentStreak: 3 },
				FAMILY,
			),
		).toBe(true);
		// 古い lastLoginDate は skip (merge import の劣化防止)
		expect(
			await loginBonusRepo.upsertStreak(
				{ childId, lastLoginDate: '2026-05-01', currentStreak: 9 },
				FAMILY,
			),
		).toBe(false);
		// 同日で streak が大きい方は採用
		expect(
			await loginBonusRepo.upsertStreak(
				{ childId, lastLoginDate: '2026-05-10', currentStreak: 5 },
				FAMILY,
			),
		).toBe(true);
		// より新しい lastLoginDate は採用
		expect(
			await loginBonusRepo.upsertStreak(
				{ childId, lastLoginDate: '2026-05-11', currentStreak: 6 },
				FAMILY,
			),
		).toBe(true);
		const streak = await loginBonusRepo.findStreak(childId, FAMILY);
		expect(streak?.lastLoginDate).toBe('2026-05-11');
		expect(streak?.currentStreak).toBe(6);

		// §P9 tenant 限定削除
		const otherChild = await newChild('他家三郎', OTHER_FAMILY);
		await loginBonusRepo.upsertStreak(
			{ childId: otherChild, lastLoginDate: '2026-06-01', currentStreak: 1 },
			OTHER_FAMILY,
		);
		await loginBonusRepo.deleteByTenantId(FAMILY);
		expect(await loginBonusRepo.findStreak(childId, FAMILY)).toBe(undefined);
		expect((await loginBonusRepo.findStreak(otherChild, OTHER_FAMILY))?.currentStreak).toBe(1);
	});
});
