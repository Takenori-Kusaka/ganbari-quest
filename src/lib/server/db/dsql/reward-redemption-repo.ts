// src/lib/server/db/dsql/reward-redemption-repo.ts
// EPIC #3424 / PR-R8 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §11.3 / §P9
//
// IRewardRedemptionRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全メソッドが単文 (snapshot 参照 + insert の 2 文経路も
//     atomicity を要さない = sqlite parity) のため TransactionRunner は不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。JOIN も
//     family_id を結合キーに含める (special_rewards / children は複合 PK)。
//   - **§11.3 temporal 正規化**: requested_at / resolved_at / shown_to_child_at は entity=epoch秒
//     (number)、DSQL 格納=timestamptz。repo 境界で epoch↔ISO を変換する (epochToIso / isoToEpoch)。
//     旧 sqlite backend は epoch integer 直格納だが、DSQL は §11.3 で timestamptz に正規化済。
//   - **total_point 共更新は無し (§5 P7 対象外)**: sqlite backend の reward-redemption repo は
//     children.total_point を触らない。承認/却下はステータス遷移のみで、ポイント控除は service 層
//     (spendPointsAtomic 経由) が担う。本 repo に付与/控除経路は無い。
//   - **#2832 申請時点 snapshot**: reward_title/points/icon は insert 時に live reward を写像。
//     編集後も申請時点の値で表示・控除する。JOIN 表示は COALESCE(snapshot, live) で旧行 fallback。
//   - **#2845 課題① composite-key addressing**: mutation は (childId, redemptionId) の複合キーで
//     child 所有権を検証する (redemption_id は PK だが child_id も述語に加える)。

import { sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { normalizeRedemptionQuantity } from '$lib/domain/validation/special-reward';
import {
	type IRewardRedemptionRepo,
	REDEMPTION_DEDUP_WINDOW_SEC,
	type RedemptionRequestRow,
	type RedemptionRequestWithDetails,
} from '../interfaces/reward-redemption-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import { normalizeResolvedByParentId } from '../reward-redemption-normalize';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface RequestRow {
	redemption_id: string;
	child_id: string;
	reward_id: string;
	requested_at: string;
	quantity: number;
	status: string;
	parent_note: string | null;
	resolved_at: string | null;
	resolved_by_parent_id: string | null;
	shown_to_child_at: string | null;
	// #4632: 申請時点 snapshot (row 型に昇格)。SELECT で取らない経路では undefined になるため
	// optional にし、toRequestRow が null に正規化する。
	reward_title?: string | null;
	reward_points?: number | null;
	reward_icon?: string | null;
}

const REQUEST_COLUMNS = sql.raw(
	`redemption_id, child_id, reward_id, requested_at, quantity, status, parent_note,
	 resolved_at, resolved_by_parent_id, shown_to_child_at,
	 reward_title, reward_points, reward_icon`,
);

/**
 * #4683: 「参照先ごほうびが存在しない」ことを表す reward_id (nil UUID)。
 * `gen_random_uuid()` は nil UUID を返さないため、別のごほうびを指すことはない。
 */
const ORPHAN_REWARD_ID = '00000000-0000-0000-0000-000000000000';

/** epoch 秒 (entity) → timestamptz ISO 文字列 (DSQL 格納)。 */
function epochToIso(sec: number): string {
	return new Date(sec * 1000).toISOString();
}

/** timestamptz ISO 文字列 (DSQL) → epoch 秒 (entity)。null 保全。 */
function isoToEpoch(iso: string | null): number | null {
	return iso === null ? null : Math.floor(Date.parse(iso) / 1000);
}

/** row → RedemptionRequestRow (§11.3: timestamptz → epoch 秒)。 */
function toRequestRow(row: RequestRow): RedemptionRequestRow {
	return {
		id: String(row.redemption_id),
		childId: asChildId(row.child_id),
		rewardId: String(row.reward_id),
		// requested_at は NOT NULL のため isoToEpoch は non-null (契約上 number)。
		requestedAt: isoToEpoch(row.requested_at) as number,
		// #4407: NOT NULL DEFAULT 1 + 既存行 backfill 済のため通常 null にならない。
		// 未 migrate cluster を読んだ場合の安全側として 1 (旧仕様 = 1 個) に倒す。
		quantity: Number(row.quantity ?? 1),
		status: row.status,
		parentNote: row.parent_note,
		resolvedAt: isoToEpoch(row.resolved_at),
		resolvedByParentId: row.resolved_by_parent_id,
		shownToChildAt: isoToEpoch(row.shown_to_child_at),
		// #4632: 申請時点 snapshot を row 型でも返す (子供の交換履歴が「何を交換したか」を出せるように)。
		rewardTitle: row.reward_title ?? null,
		rewardPoints: row.reward_points ?? null,
		rewardIcon: row.reward_icon ?? null,
	};
}

// #2832 snapshot fallback: 申請時点 snapshot を優先し、旧行 (NULL) は live JOIN 値に fallback。
// #3566 ①: JOIN は LEFT JOIN のため reward 削除後は sr.* が NULL になりうる。snapshot が権威
// (申請時点の約束を守る) であり、reward 消失 + 旧行 (snapshot NULL) の稀ケースにも非 NULL の
// 既定値 (title='' / points=0) を返して RedemptionRequestWithDetails の型契約 (非 null) を満たす。
const SNAPSHOT_TITLE = sql`COALESCE(rr.reward_title, sr.title, '')`;
const SNAPSHOT_ICON = sql`COALESCE(rr.reward_icon, sr.icon)`;
const SNAPSHOT_POINTS = sql`COALESCE(rr.reward_points, sr.points, 0)`;

/**
 * DSQL 用 IRewardRedemptionRepo を生成する (db/runner は注入、fitness#8)。
 * runner は insertRedemptionRequest (#3356 (1): per-child 直列化 dedup txn) でのみ使用する。
 */
export function createDsqlRewardRedemptionRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IRewardRedemptionRepo {
	/** status / statuses / childId filter を組み立てる (findByTenant / countByTenant 共有)。 */
	const tenantConditions = (
		tenantId: string,
		opts?: { status?: string; statuses?: readonly string[]; childId?: ChildId },
	): ReturnType<typeof sql> => {
		let where = sql`rr.family_id = ${tenantId}`;
		if (opts?.status) where = sql`${where} AND rr.status = ${opts.status}`;
		// #4682 F4: 複数状態の OR (承認履歴 = approved / rejected)。空配列は「該当なし」。
		if (opts?.statuses) {
			const list = opts.statuses.length === 0 ? [sql`NULL`] : opts.statuses.map((v) => sql`${v}`);
			where = sql`${where} AND rr.status IN (${sql.join(list, sql`, `)})`;
		}
		if (opts?.childId) where = sql`${where} AND rr.child_id = ${opts.childId}`;
		return where;
	};

	/** WithDetails 行 → entity。単件取得 / 一覧で共有する。 */
	const toWithDetails = (
		r: RequestRow & {
			child_name: string;
			reward_title: string;
			reward_icon: string | null;
			reward_points: number;
		},
	): RedemptionRequestWithDetails => ({
		...toRequestRow(r),
		childName: r.child_name,
		rewardTitle: r.reward_title,
		rewardIcon: r.reward_icon,
		rewardPoints: r.reward_points,
	});

	/** WithDetails の SELECT 句 (単件 / 一覧で同一投影を保つ)。 */
	const WITH_DETAILS_SELECT = sql`
		rr.redemption_id, rr.child_id, rr.reward_id, rr.requested_at, rr.status,
		rr.quantity, rr.parent_note, rr.resolved_at, rr.resolved_by_parent_id, rr.shown_to_child_at,
		c.nickname AS child_name,
		${SNAPSHOT_TITLE} AS reward_title, ${SNAPSHOT_ICON} AS reward_icon,
		${SNAPSHOT_POINTS} AS reward_points
	`;

	/** WithDetails の FROM / JOIN 句 (§P9: JOIN も family_id を結合キーに含める)。 */
	const WITH_DETAILS_FROM = sql`
		FROM reward_redemption_requests rr
		JOIN children c ON c.family_id = rr.family_id AND c.child_id = rr.child_id
		LEFT JOIN special_rewards sr
			ON sr.family_id = rr.family_id AND sr.child_id = rr.child_id AND sr.reward_id = rr.reward_id
	`;

	return {
		async findRedemptionRequestById(id, tenantId) {
			// #4682 F1: id 直引き (一覧 limit 非依存)。§P9 family 述語込み。
			// 非 uuid の id は 22P02 になるため呼び出し側 (form field) に到達させず undefined に倒す。
			if (!isUuidFormat(String(id))) {
				warnInvalidUuidId('reward-redemption-repo.findRedemptionRequestById');
				return undefined;
			}
			const result = await db.execute(sql`
				SELECT ${WITH_DETAILS_SELECT}
				${WITH_DETAILS_FROM}
				WHERE rr.family_id = ${tenantId} AND rr.redemption_id = ${id}
			`);
			const row = result.rows[0] as
				| (RequestRow & {
						child_name: string;
						reward_title: string;
						reward_icon: string | null;
						reward_points: number;
				  })
				| undefined;
			return row ? toWithDetails(row) : undefined;
		},

		async insertRedemptionRequest(input, tenantId) {
			// #3356 (1): server-side idempotency。children 行を FOR UPDATE で write-intent 化して
			// 同一 child の並行申請を直列化 (spendPointsAtomic §6.6 と同パターン。並行 txn は
			// 一方が 40001 → runner が retry → dedup 判定が commit 済状態を見る) したうえで、
			// (a) pending 既存 / (b) 直近 approved 窓 の dedup check → insert を単一 txn で行う。
			// 旧 check-then-act (service 層 findPendingByChildAndReward) の TOCTOU を根治。
			// fitness#7 準拠: txn work 内の await は全て tx.execute 直呼び。
			const windowStartIso = epochToIso(input.requestedAt - REDEMPTION_DEDUP_WINDOW_SEC);
			return runner.runInTransaction(async (tx) => {
				await tx.execute(sql`
					SELECT child_id FROM children
					WHERE family_id = ${tenantId} AND child_id = ${input.childId}
					FOR UPDATE
				`);
				const dup = await tx.execute(sql`
					SELECT redemption_id FROM reward_redemption_requests
					WHERE family_id = ${tenantId} AND child_id = ${input.childId}
						AND reward_id = ${input.rewardId}
						AND (status = 'pending_parent_approval'
							OR (status = 'approved' AND resolved_at >= ${windowStartIso}::timestamptz))
					LIMIT 1
				`);
				if (dup.rows.length > 0) return { error: 'DUPLICATE_REQUEST' as const };

				// #2832: 申請時点 snapshot を live reward から写像 (reward per-child のため 3 軸で参照)。
				// reward 不在でも申請行は作る (snapshot は null) = sqlite parity。
				const rewardResult = await tx.execute(sql`
					SELECT title, points, icon FROM special_rewards
					WHERE family_id = ${tenantId} AND child_id = ${input.childId} AND reward_id = ${input.rewardId}
				`);
				const reward = rewardResult.rows[0] as
					| { title: string; points: number; icon: string | null }
					| undefined;
				const result = await tx.execute(sql`
					INSERT INTO reward_redemption_requests
						(family_id, child_id, reward_id, requested_at, quantity, status,
						 reward_title, reward_points, reward_icon)
					VALUES (${tenantId}, ${input.childId}, ${input.rewardId}, ${epochToIso(input.requestedAt)},
						${normalizeRedemptionQuantity(input.quantity)}, 'pending_parent_approval', ${reward?.title ?? null}, ${reward?.points ?? null},
						${reward?.icon ?? null})
					RETURNING ${REQUEST_COLUMNS}
				`);
				return toRequestRow(result.rows[0] as unknown as RequestRow);
			});
		},

		async insertRedemptionForRestore(input, tenantId) {
			// #3329: status / 解決情報 / snapshot を verbatim 書き戻す (live reward 参照しない)。
			// #4683: rewardId=null (取込先に該当ごほうびが無い) は nil UUID で書く。
			// gen_random_uuid() は nil UUID を返さないため、別のごほうびを指すことはない。
			const rewardId = input.rewardId ?? ORPHAN_REWARD_ID;
			const result = await db.execute(sql`
				INSERT INTO reward_redemption_requests
					(family_id, child_id, reward_id, requested_at, quantity, status, parent_note,
					 resolved_at, resolved_by_parent_id, shown_to_child_at,
					 reward_title, reward_points, reward_icon)
				VALUES (${tenantId}, ${input.childId}, ${rewardId}, ${epochToIso(input.requestedAt)},
					${normalizeRedemptionQuantity(input.quantity)}, ${input.status}, ${input.parentNote},
					${input.resolvedAt === null ? null : epochToIso(input.resolvedAt)},
					${normalizeResolvedByParentId(input.resolvedByParentId)},
					${input.shownToChildAt === null ? null : epochToIso(input.shownToChildAt)},
					${input.rewardTitle}, ${input.rewardPoints}, ${input.rewardIcon})
				RETURNING ${REQUEST_COLUMNS}
			`);
			return toRequestRow(result.rows[0] as unknown as RequestRow);
		},

		async findRedemptionRequestsByChild(childId, tenantId) {
			// #4632: snapshot 3 列は「申請時点 snapshot 優先 / 旧行 (NULL) は live reward に fallback」。
			// LEFT JOIN なので reward 削除後も行は脱落しない (#3566 / #4683)。
			const result = await db.execute(sql`
				SELECT rr.redemption_id, rr.child_id, rr.reward_id, rr.requested_at, rr.quantity,
					rr.status, rr.parent_note, rr.resolved_at, rr.resolved_by_parent_id, rr.shown_to_child_at,
					COALESCE(rr.reward_title, sr.title) AS reward_title,
					COALESCE(rr.reward_points, sr.points) AS reward_points,
					COALESCE(rr.reward_icon, sr.icon) AS reward_icon
				FROM reward_redemption_requests rr
				LEFT JOIN special_rewards sr
					ON sr.family_id = rr.family_id AND sr.child_id = rr.child_id AND sr.reward_id = rr.reward_id
				WHERE rr.family_id = ${tenantId} AND rr.child_id = ${childId}
				ORDER BY rr.requested_at DESC, rr.redemption_id DESC
			`);
			return (result.rows as unknown as RequestRow[]).map(toRequestRow);
		},

		async findRedemptionRequestsByTenant(tenantId, opts) {
			// #4682 F1: 承認待ちキューは古い順 (asc)。desc + limit だと最古が window の外に落ちる。
			const order =
				opts?.order === 'asc'
					? sql`ORDER BY rr.requested_at ASC, rr.redemption_id ASC`
					: sql`ORDER BY rr.requested_at DESC, rr.redemption_id DESC`;
			const result = await db.execute(sql`
				SELECT ${WITH_DETAILS_SELECT}
				${WITH_DETAILS_FROM}
				WHERE ${tenantConditions(tenantId, opts)}
				${order}
				LIMIT ${opts?.limit ?? 50}
			`);
			return (
				result.rows as unknown as (RequestRow & {
					child_name: string;
					reward_title: string;
					reward_icon: string | null;
					reward_points: number;
				})[]
			).map(toWithDetails);
		},

		async countRedemptionRequestsByTenant(tenantId, opts) {
			// #3144: limit を掛けず正確な件数を返す (JOIN 不要、rr 単独 filter)。
			const result = await db.execute(sql`
				SELECT COUNT(*) AS count FROM reward_redemption_requests rr
				WHERE ${tenantConditions(tenantId, opts)}
			`);
			const row = result.rows[0] as { count: number } | undefined;
			return Number(row?.count ?? 0);
		},

		async updateRedemptionRequestStatus(childId, id, updates, tenantId, options) {
			// #2845 課題①: (childId, redemptionId) 複合キーで child 所有権を検証。
			const sets: ReturnType<typeof sql>[] = [sql`status = ${updates.status}`];
			if (updates.parentNote !== undefined) sets.push(sql`parent_note = ${updates.parentNote}`);
			if (updates.resolvedAt !== undefined)
				sets.push(
					sql`resolved_at = ${updates.resolvedAt === null ? null : epochToIso(updates.resolvedAt)}`,
				);
			if (updates.resolvedByParentId !== undefined)
				sets.push(sql`resolved_by_parent_id = ${updates.resolvedByParentId}`);
			// #4722: expectedStatus 指定時は条件付き UPDATE (0 行 = 既に別の承認が確定済)。
			// ⚠️ tenant 述語 (`family_id = ${tenantId}`) は **template 内にインラインで書く**。
			// 配列に積んで `sql.join` で組み立てると、tenant 述語 fitness
			// (tests/unit/architecture/dsql-tenant-predicate-fitness.test.ts、ADR-0063 §3.4) の
			// 静的走査から述語が見えなくなり「family_id 欠如」を誤検出する = 防御線を実質無効化する。
			const statusCondition =
				options?.expectedStatus !== undefined
					? sql` AND status = ${options.expectedStatus}`
					: sql``;
			const result = await db.execute(sql`
				UPDATE reward_redemption_requests SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND redemption_id = ${id} AND child_id = ${childId}${statusCondition}
				RETURNING ${REQUEST_COLUMNS}
			`);
			const row = result.rows[0] as unknown as RequestRow | undefined;
			return row ? toRequestRow(row) : undefined;
		},

		// findPendingByChildAndReward は #3356 (1) で撤去。pending 重複判定は
		// insertRedemptionRequest の dedup txn に内蔵済 (check-then-act TOCTOU 根治)。

		// #4435: findUnshownResultByChild / markRedemptionResultShown は撤去 (到達不能経路)。
		// 交換申請の承認・却下は子供のごほうびショップのバッジと履歴画面が常時表示しており、
		// `shown_to_child_at` を使う一度きりの通知は production から呼ばれていなかった (#4432 実測)。
		// 列はバックアップ往復のため保持する (終了条件は schema.ts の定義コメント)。

		async expireOldRedemptions(tenantId) {
			// 30 日超 pending → expired。timestamptz 比較で now() - interval を使う (§11.3)。
			// #3625: affected 件数は CTE で DB 側 count 集約し、更新全行を client に materialize しない
			// (tenant 全体走査で大量 pending を expire しうる)。
			const result = await db.execute(sql`
				WITH updated AS (
					UPDATE reward_redemption_requests SET status = 'expired'
					WHERE family_id = ${tenantId} AND status = 'pending_parent_approval'
						AND requested_at < now() - interval '30 days'
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM updated
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async hasPendingByReward(rewardId, tenantId) {
			const result = await db.execute(sql`
				SELECT 1 FROM reward_redemption_requests
				WHERE family_id = ${tenantId} AND reward_id = ${rewardId}
					AND status = 'pending_parent_approval'
				LIMIT 1
			`);
			return result.rows.length > 0;
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM reward_redemption_requests WHERE family_id = ${tenantId}`);
		},
	};
}
