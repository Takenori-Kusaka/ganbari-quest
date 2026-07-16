// src/lib/server/db/dsql/stamp-card-repo.ts
// EPIC #3424 / PR-R6 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §3 / §11.2 / §P9
// follow-up 担保: #3562 ①②③ (PR #3547 Adversarial Reviewer 指摘)
//
// IStampCardRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **UUID surrogate PK (PO 決裁 2026-07-03、PR #3547)**: card_id は gen_random_uuid() 採番
//     (counter 不使用)。PK は (family_id, child_id, card_id) で week_start を含まない。
//   - **#3562 ① 可逆性設計**: 「1子1週1枚」は PK と独立した droppable UNIQUE
//     stamp_cards_week_uq (family_id, child_id, week_start) が担う。シーズン/イベントカード
//     復活時は **この UNIQUE を DROP するだけで PK 不変** (§P1 の PK 後変更不可に抵触しない)。
//     insertCard の冪等化もこの UNIQUE への ON CONFLICT に anchor しており、UNIQUE DROP 後は
//     ON CONFLICT 節を撤去して「常に新規カード」へ 1 箇所修正で移行できる。
//     テスト固定: dsql-stamp-mission-repos.test.ts [SC3]。
//   - **#3562 ② H7/H8 性能**: UUID surrogate 化で「今週のカード」lookup は PK covering から
//     外れ UNIQUE index 経由の 2 段 fetch になる。実測は PGlite では不可能 (planner / latency が
//     実 DSQL と別物) のため **cutover 後に実 DSQL で計測するタスク** であり、本 repo では
//     推測の数値を書かない。必要なら covering index 追加を計測後に判断する (#3562 ②)。
//   - **#3562 ③ tenant 境界 assertion**: DSQL は FK 非対応 + card_id が独立乱数のため、
//     stamp_entries の INSERT は「card_id が同一 family_id の stamp_cards に属する」ことを
//     INSERT ... SELECT ... FROM stamp_cards (単一文 = 同一 txn 内検証) で強制する。
//     所属しない card への挿入は 0 行 no-op になり cross-family / orphan entry を構造排除。
//   - **stamp master は in-memory SSOT** (stamp-master-defaults.ts、dynamodb backend と同判断):
//     stamp_masters は tenant 別カスタマイズなしのグローバル master (§11.2) で、DSQL schema に
//     表を持たない。findEnabledStampMasters / master join は getDefaultStampMasters() で解決する。
//   - entry の重複押印 (同 slot / 同 login_date) は ON CONFLICT DO NOTHING で silent skip
//     (sqlite parity: onConflictDoNothing)。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import type { IStampCardRepo } from '../interfaces/stamp-card-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { getDefaultStampMasters } from '../stamp-master-defaults';
import type { StampCard, StampEntryWithMaster, StampMaster } from '../types';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface CardRow {
	child_id: string;
	card_id: string;
	week_start: string;
	week_end: string;
	status: string;
	redeemed_points: number | null;
	redeemed_at: string | null;
	created_at: string;
	updated_at: string;
}

interface EntryRow {
	card_id: string;
	slot: number;
	stamp_master_id: string | null;
	omikuji_rank: string | null;
	login_date: string;
	earned_at: string;
}

const CARD_COLUMNS = sql.raw(
	`child_id, card_id, week_start, week_end, status, redeemed_points, redeemed_at,
	 created_at, updated_at`,
);
const ENTRY_COLUMNS = sql.raw(
	'card_id, slot, stamp_master_id, omikuji_rank, login_date, earned_at',
);

/** row → StampCard entity (id = card_id uuid 文字列、sqlite の数値 id 文字列化と同 shape 契約)。 */
function toCard(row: CardRow): StampCard {
	return {
		id: row.card_id,
		childId: asChildId(row.child_id),
		weekStart: row.week_start,
		weekEnd: row.week_end,
		status: row.status,
		redeemedPoints: row.redeemed_points,
		redeemedAt: row.redeemed_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** DSQL 用 IStampCardRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlStampCardRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IStampCardRepo {
	// グローバル master SSOT (tenant 非依存 §11.2)。id → master の join 用 map。
	const masterById = new Map<string, StampMaster>(getDefaultStampMasters().map((m) => [m.id, m]));

	const findCard = async (tenantWhere: ReturnType<typeof sql>): Promise<StampCard | undefined> => {
		const result = await db.execute(
			sql`SELECT ${CARD_COLUMNS} FROM stamp_cards WHERE ${tenantWhere}`,
		);
		const row = result.rows[0] as unknown as CardRow | undefined;
		return row ? toCard(row) : undefined;
	};

	return {
		async findEnabledStampMasters(_tenantId) {
			// in-memory SSOT (dynamodb parity #2845 課題④: isEnabled=0 を除外する filter parity)。
			return getDefaultStampMasters().filter((m) => m.isEnabled === 1);
		},

		async findCardByChildAndWeek(childId, weekStart, tenantId) {
			// #3581 ②: stampCard / loginStamp action (child POST) の stampToday →
			// getOrCreateCurrentCard 経路が raw cookie id を最初に渡す repo 入口。route guard
			// (requireValidChildCookieFormat) が第 1 層だが、repo 層でも非 uuid を「その週のカードなし」
			// = undefined (not-found と同 shape) に正規化し、22P02 → 500 を fail-safe に断つ (二重防御)。
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('stamp-card-repo.findCardByChildAndWeek');
				return undefined;
			}
			return findCard(
				sql`family_id = ${tenantId} AND child_id = ${childId} AND week_start = ${weekStart}`,
			);
		},

		async insertCard(input, tenantId) {
			// findOrCreate 冪等化: week UNIQUE (stamp_cards_week_uq) への ON CONFLICT DO NOTHING。
			// 既存週の再要求 (並行 loginStamp 等) は挿入 0 行 → 既存 card を SELECT して返す
			// (どちらの経路でも「その週のカード」1 枚に収束、#2565 と同思想)。
			const inserted = await db.execute(sql`
				INSERT INTO stamp_cards (family_id, child_id, week_start, week_end, status)
				VALUES (${tenantId}, ${input.childId}, ${input.weekStart}, ${input.weekEnd},
					${input.status ?? 'collecting'})
				ON CONFLICT (family_id, child_id, week_start) DO NOTHING
				RETURNING ${CARD_COLUMNS}
			`);
			const row = inserted.rows[0] as unknown as CardRow | undefined;
			if (row) return toCard(row);
			const existing = await this.findCardByChildAndWeek(input.childId, input.weekStart, tenantId);
			if (!existing) throw new Error('Failed to create stamp card');
			return existing;
		},

		async findEntriesWithMasterByCardId(cardId, tenantId): Promise<StampEntryWithMaster[]> {
			// master join は in-memory SSOT で解決 (stamp_masters 表なし、dynamodb parity)。
			const result = await db.execute(sql`
				SELECT ${ENTRY_COLUMNS} FROM stamp_entries
				WHERE family_id = ${tenantId} AND card_id = ${cardId}
				ORDER BY slot
			`);
			return (result.rows as unknown as EntryRow[]).map((r) => {
				const master = r.stamp_master_id ? masterById.get(r.stamp_master_id) : undefined;
				return {
					slot: r.slot,
					stampMasterId: r.stamp_master_id,
					omikujiRank: r.omikuji_rank,
					loginDate: r.login_date,
					name: master?.name ?? null,
					emoji: master?.emoji ?? null,
					rarity: master?.rarity ?? null,
				};
			});
		},

		async insertEntry(input, tenantId) {
			// #3562 ③: card 所有検証を INSERT ... SELECT の単一文 (= 同一 txn) で強制。
			// card が同 family に属さない場合は SELECT 0 行 → 挿入なし (orphan / cross-family 排除)。
			// 重複 (同 slot PK / 同 login_date UNIQUE) は DO NOTHING で silent skip (sqlite parity)。
			await db.execute(sql`
				INSERT INTO stamp_entries (family_id, card_id, slot, stamp_master_id, omikuji_rank, login_date)
				SELECT c.family_id, c.card_id, ${input.slot}, ${input.stampMasterId},
					${input.omikujiRank}, ${input.loginDate}
				FROM stamp_cards c
				WHERE c.family_id = ${tenantId} AND c.card_id = ${input.cardId}
				ON CONFLICT DO NOTHING
			`);
		},

		async findCardsByChild(childId, tenantId) {
			// #3581 ②: 非 uuid の raw id は「カードなし」= 空配列 (not-found と同 shape) に正規化。
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('stamp-card-repo.findCardsByChild');
				return [];
			}
			const result = await db.execute(sql`
				SELECT ${CARD_COLUMNS} FROM stamp_cards
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY week_start
			`);
			return (result.rows as unknown as CardRow[]).map(toCard);
		},

		async findEntriesByCardId(cardId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${ENTRY_COLUMNS} FROM stamp_entries
				WHERE family_id = ${tenantId} AND card_id = ${cardId}
				ORDER BY slot
			`);
			return (result.rows as unknown as EntryRow[]).map((r) => ({
				stampMasterId: r.stamp_master_id,
				omikujiRank: r.omikuji_rank,
				slot: r.slot,
				loginDate: r.login_date,
				earnedAt: r.earned_at,
			}));
		},

		async insertCardForRestore(input, tenantId) {
			// #3329 backup restore: status / redeemed / 日時を verbatim 保全 (insertCard と違い
			// default に落とさない)。card_id は新規採番 (schema default gen_random_uuid())。
			// #3394 統一冪等契約: 同 (child, week_start) 既存 (stamp_cards_week_uq 衝突) は
			// DO NOTHING で skip し null を返す (sqlite onConflictDoNothing / dynamodb
			// attribute_not_exists と機能等価)。
			const result = await db.execute(sql`
				INSERT INTO stamp_cards
					(family_id, child_id, week_start, week_end, status, redeemed_points, redeemed_at,
					 created_at, updated_at)
				VALUES (${tenantId}, ${input.childId}, ${input.weekStart}, ${input.weekEnd},
					${input.status}, ${input.redeemedPoints}, ${input.redeemedAt},
					${input.createdAt}::timestamptz, ${input.updatedAt}::timestamptz)
				ON CONFLICT (family_id, child_id, week_start) DO NOTHING
				RETURNING ${CARD_COLUMNS}
			`);
			const row = result.rows[0] as unknown as CardRow | undefined;
			return row ? toCard(row) : null;
		},

		async insertEntryForRestore(input, tenantId) {
			// restore 経路も #3562 ③ の tenant 境界 (INSERT ... SELECT 所有検証) を通す。
			// earned_at は verbatim 保全。重複は DO NOTHING (sqlite parity)。
			// #3394 統一冪等契約: 実 insert 行有無を RETURNING で判定し boolean を返す
			// (重複 skip / card 非所有 (orphan) は false → import 側 skip 計上 = count 偽装防止)。
			const result = await db.execute(sql`
				INSERT INTO stamp_entries
					(family_id, card_id, slot, stamp_master_id, omikuji_rank, login_date, earned_at)
				SELECT c.family_id, c.card_id, ${input.slot}, ${input.stampMasterId},
					${input.omikujiRank}, ${input.loginDate}, ${input.earnedAt}::timestamptz
				FROM stamp_cards c
				WHERE c.family_id = ${tenantId} AND c.card_id = ${input.cardId}
				ON CONFLICT DO NOTHING
				RETURNING 1 AS inserted
			`);
			return result.rows.length > 0;
		},

		async updateCardStatus(childId, cardId, input, tenantId) {
			// #2845 課題①: (family, child, card) = PK 完全一致で cross-child access を構造排除。
			await db.execute(sql`
				UPDATE stamp_cards
				SET status = ${input.status}, redeemed_points = ${input.redeemedPoints},
					redeemed_at = ${input.redeemedAt}, updated_at = ${input.updatedAt}::timestamptz
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND card_id = ${cardId}
			`);
		},

		async updateCardStatusIfCollecting(childId, cardId, input, tenantId) {
			// status='collecting' の行のみ遷移 (冪等ガード)。affected 行数を返す (sqlite parity)。
			// #3625: 件数は CTE で DB 側 count 集約し idiom を統一する (affected は高々 1 行だが
			// dsql 全体の「mutation 件数は CTE count」規律に揃え、guard の false-positive を避ける)。
			const result = await db.execute(sql`
				WITH updated AS (
					UPDATE stamp_cards
					SET status = ${input.status}, redeemed_points = ${input.redeemedPoints},
						redeemed_at = ${input.redeemedAt}, updated_at = ${input.updatedAt}::timestamptz
					WHERE family_id = ${tenantId} AND child_id = ${childId} AND card_id = ${cardId}
						AND status = 'collecting'
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM updated
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async deleteByTenantId(tenantId) {
			// 2 表削除を単一 txn (fitness#7: work 内 await は tx.execute 直呼びのみ)。
			// sqlite (シングルテナント全行削除) と違い family 述語で tenant 限定 (§P9)。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`DELETE FROM stamp_entries WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM stamp_cards WHERE family_id = ${tenantId}`);
			});
		},
	};
}
