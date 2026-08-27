// src/lib/server/db/sqlite/reward-redemption-repo.ts
// ごほうびショップ交換申請リポジトリ (#1337)

import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { normalizeRedemptionQuantity } from '$lib/domain/validation/special-reward';
import { db } from '../client';
import {
	REDEMPTION_DEDUP_WINDOW_SEC,
	type RedemptionRequestRow,
	type RedemptionRequestWithDetails,
} from '../interfaces/reward-redemption-repo.interface';
import { normalizeResolvedByParentId } from '../reward-redemption-normalize';
import { children, rewardRedemptionRequests, specialRewards } from '../schema';

type RequestRow = typeof rewardRedemptionRequests.$inferSelect;

const toRequestRow = (r: RequestRow): RedemptionRequestRow => ({
	id: String(r.id),
	childId: asChildId(r.childId),
	rewardId: String(r.rewardId),
	requestedAt: r.requestedAt,
	// #4407: DB 既定 1 + 既存行 backfill 済のため通常 null にならないが、
	// 未 migrate DB を読んだ場合の安全側として 1 に倒す (1 個扱い = 旧仕様)。
	quantity: r.quantity ?? 1,
	status: r.status,
	parentNote: r.parentNote,
	resolvedAt: r.resolvedAt,
	resolvedByParentId: r.resolvedByParentId,
	shownToChildAt: r.shownToChildAt,
});

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/**
 * #4683: 「参照先ごほうびが存在しない」ことを表す reward_id。
 * `special_rewards.id` は AUTOINCREMENT (1 始まり・再利用なし) のため 0 は永久に採番されない。
 */
const ORPHAN_REWARD_ID = 0;

// #2832: 申請時点 snapshot fallback。
// 新規行は insert 時に reward_* snapshot を保存し、編集後も「申請時点の内容 (名前/ポイント)」で
// 表示・控除する (DynamoDB 非正規化 item と等価の仕様)。snapshot 列導入前の旧行 (NULL) は
// live JOIN 値に fallback する。
// #3566 ①: JOIN は leftJoin のため reward 削除後は specialRewards.* が NULL になりうる。snapshot が
// 権威 (申請時点の約束) であり、reward 消失 + 旧行 (snapshot NULL) の稀ケースにも非 NULL 既定値
// (title='' / points=0) を返して WithDetails の型契約を満たす。
const snapshotTitle = sql<string>`COALESCE(${rewardRedemptionRequests.rewardTitle}, ${specialRewards.title}, '')`;
const snapshotIcon = sql<
	string | null
>`COALESCE(${rewardRedemptionRequests.rewardIcon}, ${specialRewards.icon})`;
const snapshotPoints = sql<number>`COALESCE(${rewardRedemptionRequests.rewardPoints}, ${specialRewards.points}, 0)`;

/**
 * 交換申請を作成 (#2832: 申請時点 snapshot を保存 / #3356 (1): server-side idempotency 内蔵)。
 *
 * better-sqlite3 の**同期トランザクション**内で「pending 既存 check + 直近 approved 窓 check →
 * insert」を 1 単位に閉じ込める。旧構成 (service 層の findPendingByChildAndReward check-then-act)
 * は並行 submit で両者が「pending 無し」を読んで二重申請 → 即時交換モードで二重減算を招いた。
 * txn 中は他リクエストが event loop に割り込めないため dedup 判定が原子化される
 * (spendPointsAtomic #3347 と同パターン)。
 */
export async function insertRedemptionRequest(
	input: {
		childId: ChildId;
		rewardId: string;
		requestedAt: number;
		quantity: number;
	},
	_tenantId: string,
): Promise<RedemptionRequestRow | { error: 'DUPLICATE_REQUEST' }> {
	return db.transaction((tx) => {
		// dedup (a): 同一 (child, reward) の pending が既存なら弾く
		const pending = tx
			.select({ id: rewardRedemptionRequests.id })
			.from(rewardRedemptionRequests)
			.where(
				and(
					eq(rewardRedemptionRequests.childId, Number(input.childId)),
					eq(rewardRedemptionRequests.rewardId, Number(input.rewardId)),
					eq(rewardRedemptionRequests.status, 'pending_parent_approval'),
				),
			)
			.limit(1)
			.get();
		if (pending) return { error: 'DUPLICATE_REQUEST' as const };

		// dedup (b): 直近 REDEMPTION_DEDUP_WINDOW_SEC 秒以内に approved (即時交換含む) が
		// あれば連打/再送/多タブとみなして弾く (#3356 (1))
		const windowStart = input.requestedAt - REDEMPTION_DEDUP_WINDOW_SEC;
		const recentApproved = tx
			.select({ id: rewardRedemptionRequests.id })
			.from(rewardRedemptionRequests)
			.where(
				and(
					eq(rewardRedemptionRequests.childId, Number(input.childId)),
					eq(rewardRedemptionRequests.rewardId, Number(input.rewardId)),
					eq(rewardRedemptionRequests.status, 'approved'),
					gte(rewardRedemptionRequests.resolvedAt, windowStart),
				),
			)
			.limit(1)
			.get();
		if (recentApproved) return { error: 'DUPLICATE_REQUEST' as const };

		const reward = tx
			.select({
				title: specialRewards.title,
				points: specialRewards.points,
				icon: specialRewards.icon,
			})
			.from(specialRewards)
			.where(eq(specialRewards.id, Number(input.rewardId)))
			.get();

		return toRequestRow(
			tx
				.insert(rewardRedemptionRequests)
				.values({
					childId: Number(input.childId),
					rewardId: Number(input.rewardId),
					requestedAt: input.requestedAt,
					quantity: normalizeRedemptionQuantity(input.quantity),
					status: 'pending_parent_approval',
					rewardTitle: reward?.title ?? null,
					rewardPoints: reward?.points ?? null,
					rewardIcon: reward?.icon ?? null,
				})
				.returning()
				.get(),
		);
	});
}

/**
 * #3329 backup restore 用: 申請時点の全フィールドを保全して復元する。
 * insertRedemptionRequest と異なり status / 解決情報 / snapshot を引数の値のまま書き戻す
 * (live reward 参照しない)。FK rewardId は呼び出し側が import 後の reward に解決済。
 */
export async function insertRedemptionForRestore(
	input: {
		childId: ChildId;
		rewardId: string | null;
		requestedAt: number;
		quantity: number;
		status: string;
		parentNote: string | null;
		resolvedAt: number | null;
		resolvedByParentId: string | null;
		shownToChildAt: number | null;
		rewardTitle: string | null;
		rewardPoints: number | null;
		rewardIcon: string | null;
	},
	_tenantId: string,
): Promise<RedemptionRequestRow> {
	return toRequestRow(
		db
			.insert(rewardRedemptionRequests)
			.values({
				childId: Number(input.childId),
				// #4683: null (取込先に該当ごほうびが無い) は 0 で書く。AUTOINCREMENT は 0 を採番
				// しないため、別のごほうびを指してしまうことはない。表示は snapshot 列が担う。
				rewardId: input.rewardId === null ? ORPHAN_REWARD_ID : Number(input.rewardId),
				requestedAt: input.requestedAt,
				quantity: normalizeRedemptionQuantity(input.quantity),
				status: input.status,
				parentNote: input.parentNote,
				resolvedAt: input.resolvedAt,
				// #3464: legacy `0`/`'0'` を物理 null 化して書き戻す (read 正規化と SSOT 共有、
				// 「書込 0 / read null」の物理値ドリフト防止)。
				resolvedByParentId: normalizeResolvedByParentId(input.resolvedByParentId),
				shownToChildAt: input.shownToChildAt,
				rewardTitle: input.rewardTitle,
				rewardPoints: input.rewardPoints,
				rewardIcon: input.rewardIcon,
			})
			.returning()
			.get(),
	);
}

/** 子供の交換申請一覧を取得（最新順） */
export async function findRedemptionRequestsByChild(
	childId: ChildId,
	_tenantId: string,
): Promise<RedemptionRequestRow[]> {
	return db
		.select()
		.from(rewardRedemptionRequests)
		.where(eq(rewardRedemptionRequests.childId, Number(childId)))
		.orderBy(desc(rewardRedemptionRequests.requestedAt))
		.all()
		.map(toRequestRow);
}

/** WithDetails 行の共通 select 定義 (単件取得 / 一覧で共有する)。 */
const withDetailsSelection = {
	id: rewardRedemptionRequests.id,
	childId: rewardRedemptionRequests.childId,
	rewardId: rewardRedemptionRequests.rewardId,
	requestedAt: rewardRedemptionRequests.requestedAt,
	quantity: rewardRedemptionRequests.quantity,
	status: rewardRedemptionRequests.status,
	parentNote: rewardRedemptionRequests.parentNote,
	resolvedAt: rewardRedemptionRequests.resolvedAt,
	resolvedByParentId: rewardRedemptionRequests.resolvedByParentId,
	shownToChildAt: rewardRedemptionRequests.shownToChildAt,
	childName: children.nickname,
	// #2832: 申請時点 snapshot 優先 (旧行は live JOIN 値に fallback)
	rewardTitle: snapshotTitle,
	rewardIcon: snapshotIcon,
	rewardPoints: snapshotPoints,
};

type WithDetailsRow = {
	id: number;
	childId: number;
	rewardId: number;
} & Omit<RedemptionRequestWithDetails, 'id' | 'childId' | 'rewardId'>;

const toWithDetails = (r: WithDetailsRow): RedemptionRequestWithDetails => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
	rewardId: String(r.rewardId),
});

/**
 * #4682 F1: id で 1 件取得 (limit 非依存)。承認 / 却下の存在確認に使う。
 * SQLite はシングルテナントのため tenant 述語は不要 (id が主キー)。
 */
export async function findRedemptionRequestById(
	id: string,
	_tenantId: string,
): Promise<RedemptionRequestWithDetails | undefined> {
	const row = await db
		.select(withDetailsSelection)
		.from(rewardRedemptionRequests)
		.innerJoin(children, eq(rewardRedemptionRequests.childId, children.id))
		.leftJoin(specialRewards, eq(rewardRedemptionRequests.rewardId, specialRewards.id))
		.where(eq(rewardRedemptionRequests.id, Number(id)))
		.get();
	return row ? toWithDetails(row as WithDetailsRow) : undefined;
}

/** 親がご家族の見守り画面で見る申請一覧（子供名・報酬名を含む） */
export async function findRedemptionRequestsByTenant(
	_tenantId: string,
	opts?: {
		status?: string;
		statuses?: readonly string[];
		childId?: ChildId;
		limit?: number;
		order?: 'asc' | 'desc';
	},
): Promise<RedemptionRequestWithDetails[]> {
	const conditions = [];
	if (opts?.status) {
		conditions.push(eq(rewardRedemptionRequests.status, opts.status));
	}
	// #4682 F4: 複数状態の OR (承認履歴 = approved / rejected)。空配列は「該当なし」。
	if (opts?.statuses) {
		conditions.push(inArray(rewardRedemptionRequests.status, [...opts.statuses]));
	}
	if (opts?.childId) {
		conditions.push(eq(rewardRedemptionRequests.childId, Number(opts.childId)));
	}

	const rows = await db
		.select(withDetailsSelection)
		.from(rewardRedemptionRequests)
		.innerJoin(children, eq(rewardRedemptionRequests.childId, children.id))
		// #3566 ①: leftJoin で snapshot を権威化。reward が改名/削除されても申請行は一覧から
		// 脱落せず snapshot (申請時点の約束) を返す。INNER だと reward 消失で申請が消え顧客期待報酬が失われる。
		.leftJoin(specialRewards, eq(rewardRedemptionRequests.rewardId, specialRewards.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		// #4682 F1: 承認待ちキューは古い順 (asc)。desc + limit だと最古が window の外に落ちる。
		.orderBy(
			opts?.order === 'asc'
				? asc(rewardRedemptionRequests.requestedAt)
				: desc(rewardRedemptionRequests.requestedAt),
		)
		.limit(opts?.limit ?? 50)
		.all();

	return rows.map((r) => toWithDetails(r as WithDetailsRow));
}

/**
 * #3144: テナント内の交換申請の正確な件数を返す (COUNT、limit なし)。
 * findRedemptionRequestsByTenant の WHERE 条件 (status / childId) と同一の filter を適用するが、
 * admin 一覧用の limit(50) を掛けず COUNT(*) で件数を返すため 50 件以上でも飽和しない。
 */
export async function countRedemptionRequestsByTenant(
	_tenantId: string,
	opts?: { status?: string; statuses?: readonly string[]; childId?: ChildId },
) {
	const conditions = [];
	if (opts?.status) {
		conditions.push(eq(rewardRedemptionRequests.status, opts.status));
	}
	if (opts?.statuses) {
		conditions.push(inArray(rewardRedemptionRequests.status, [...opts.statuses]));
	}
	if (opts?.childId) {
		conditions.push(eq(rewardRedemptionRequests.childId, Number(opts.childId)));
	}

	const row = db
		.select({ count: sql<number>`COUNT(*)` })
		.from(rewardRedemptionRequests)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.get();

	return row?.count ?? 0;
}

/**
 * 申請状態を更新。
 * #2845 課題①: childId 所有権検証付き (composite key)。不一致なら更新せず undefined。
 */
export async function updateRedemptionRequestStatus(
	childId: ChildId,
	id: string,
	updates: {
		status: string;
		parentNote?: string | null;
		resolvedAt?: number | null;
		resolvedByParentId?: string | null;
	},
	_tenantId: string,
): Promise<RedemptionRequestRow | undefined> {
	const row = db
		.update(rewardRedemptionRequests)
		.set(updates)
		.where(
			and(
				eq(rewardRedemptionRequests.id, Number(id)),
				eq(rewardRedemptionRequests.childId, Number(childId)),
			),
		)
		.returning()
		.get();
	return row ? toRequestRow(row) : undefined;
}

/** 子供の特定報酬に対して pending 申請が存在するか確認 */
// findPendingByChildAndReward は #3356 (1) で撤去。pending 重複判定は
// insertRedemptionRequest の同期 txn 内 dedup に内蔵済 (check-then-act TOCTOU 根治)。

// #4435: findUnshownResultByChild / markRedemptionResultShown は撤去 (到達不能経路)。
// 交換申請の承認・却下は子供のごほうびショップのバッジと履歴画面が常時表示しており、
// `shown_to_child_at` を使う一度きりの通知は production から呼ばれていなかった (#4432 実測)。
// 列はバックアップ往復のため保持する (終了条件は schema.ts の定義コメント)。

/** 30日以上 pending の申請を expired に移行 */
export async function expireOldRedemptions(_tenantId: string) {
	const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SECONDS;
	const result = db
		.update(rewardRedemptionRequests)
		.set({ status: 'expired' })
		.where(
			and(
				eq(rewardRedemptionRequests.status, 'pending_parent_approval'),
				lt(rewardRedemptionRequests.requestedAt, cutoff),
			),
		)
		.returning()
		.all();
	return result.length;
}

/** 特定の reward_id に pending 申請が存在するか確認（削除前チェック用） */
export async function hasPendingByReward(rewardId: string, _tenantId: string) {
	const row = db
		.select({ id: rewardRedemptionRequests.id })
		.from(rewardRedemptionRequests)
		.where(
			and(
				eq(rewardRedemptionRequests.rewardId, Number(rewardId)),
				eq(rewardRedemptionRequests.status, 'pending_parent_approval'),
			),
		)
		.limit(1)
		.get();
	return !!row;
}

/** テナントの全申請を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(rewardRedemptionRequests).run();
}
