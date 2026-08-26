import type { ChildId } from '$lib/domain/ids';

// src/lib/server/services/reward-redemption-service.ts
// ごほうびショップ交換申請サービス (#1337)

import { todayDateJST } from '$lib/domain/date-utils';
import { formatRewardWithQuantity } from '$lib/domain/labels';
import {
	isValidRedemptionQuantity,
	REDEMPTION_QUANTITY_MIN,
} from '$lib/domain/validation/special-reward';
import { selectTenantSlice } from '$lib/server/cron/tenant-slice';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import { REDEMPTION_EXPIRE_AFTER_SEC } from '$lib/server/db/interfaces/reward-redemption-repo.interface';
import { findChildById, getBalance, spendPointsAtomic } from '$lib/server/db/point-repo';
import {
	countRedemptionRequestsByTenant,
	expireOldRedemptions as expireOldRedemptionsRepo,
	findPendingRewardIdsByTenant,
	findRedemptionRequestById,
	findRedemptionRequestsByChild,
	findRedemptionRequestsByTenant,
	insertRedemptionRequest,
	updateRedemptionRequestStatus,
} from '$lib/server/db/reward-redemption-repo';
import { getSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards } from '$lib/server/db/special-reward-repo';
import { logger } from '$lib/server/logger';

/**
 * #3339: ごほうび交換の「即時交換（親承認スキップ）」が家庭設定で有効か。
 * settings KVS `reward_auto_approve`（既定 OFF = 現行の親承認フロー）。
 * sibling_ranking_enabled と同じ bool 規約（'true' のみ真）。
 */
export async function isRewardAutoApproveEnabled(tenantId: string): Promise<boolean> {
	return (await getSetting('reward_auto_approve', tenantId)) === 'true';
}

// ============================================================
// 型定義
// ============================================================

export type RedemptionStatus = 'pending_parent_approval' | 'approved' | 'rejected' | 'expired';

export interface RedemptionRequestResult {
	id: string;
	childId: ChildId;
	rewardId: string;
	/** #4407: 1 申請が表す個数 (単位量のごほうび。控除は 単価 × 個数)。 */
	quantity: number;
	status: RedemptionStatus;
	requestedAt: number;
	parentNote: string | null;
	resolvedAt: number | null;
	shownToChildAt: number | null;
	/**
	 * #3339: 即時交換（家庭設定 `reward_auto_approve` ON）で親承認をスキップして
	 * その場で approved 確定したか。`requestRedemption` のみ設定する（承認/却下経路では undefined）。
	 */
	instant?: boolean;
}

export interface RedemptionRequestWithDetails {
	id: string;
	childId: ChildId;
	childName: string;
	rewardId: string;
	rewardTitle: string;
	rewardIcon: string | null;
	/** ごほうび 1 個あたりの単価 (申請時点 snapshot)。 */
	rewardPoints: number;
	/** #4407: 申請個数。承認画面は「ゲーム時間 +30分 × 4」を 1 件として表示する。 */
	quantity: number;
	/** #4407: 実際に控除される合計 = rewardPoints × quantity。 */
	totalPoints: number;
	status: RedemptionStatus;
	requestedAt: number;
	parentNote: string | null;
	resolvedAt: number | null;
}

// ============================================================
// 申請作成
// ============================================================

export type RequestRedemptionError =
	| { error: 'INSUFFICIENT_POINTS' }
	| { error: 'ALREADY_PENDING' }
	// #4407 AC10: 即時交換 (auto-approve) 直後の dedup 窓に当たったケース。承認待ちは存在しないため
	// 「既に申請中です」は事実と違う。子供に「すこし待てば押せる」と伝えるために別コードで返す。
	| { error: 'RECENTLY_EXCHANGED' }
	| { error: 'INVALID_QUANTITY' }
	| { error: 'REWARD_NOT_FOUND' };

/**
 * ごほうび交換を申請する。
 *
 * #4407: `quantity` で「1 申請 = N 個」を表す。単位量のごほうび (「ゲーム時間 +30分」) を
 * 現実の消費 (2 時間 = 4 個) に対応させるための表現で、申請行を N 件に増やさない
 * (親の承認操作も 1 件のまま)。ポイント控除は `単価 × 個数` で行う (finalizeApproval)。
 * #3356 の dedup 契約 (同一 (child, reward) の pending 1 件 + 直近 approved 10 秒窓) は不変。
 */
export async function requestRedemption(
	childId: ChildId,
	rewardId: string,
	tenantId: string,
	quantity: number = REDEMPTION_QUANTITY_MIN,
): Promise<RedemptionRequestResult | RequestRedemptionError> {
	// #4407: 値域外 (0 / 負 / 小数 / 上限超過 / NaN) は減算前に弾く。値域 SSOT は domain 層
	// (REDEMPTION_QUANTITY_MIN/MAX)。0 個で amount=0 の台帳行を作らないための一次防御でもある。
	if (!isValidRedemptionQuantity(quantity)) return { error: 'INVALID_QUANTITY' };

	// 報酬の存在確認（子供に紐付くか）
	const rewards = await findSpecialRewards(childId, tenantId);
	const reward = rewards.find((r) => r.id === rewardId);
	if (!reward) return { error: 'REWARD_NOT_FOUND' };

	// ポイント残高確認
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'REWARD_NOT_FOUND' };

	// #4407: 合計 = 単価 × 個数。実際の控除は spendPointsAtomic が原子的に再確認する (#3347) が、
	// 明らかに足りない申請をここで弾いて pending 行を作らない。
	const totalPoints = reward.points * quantity;
	const balance = await getBalance(childId, tenantId);
	if (balance < totalPoints) return { error: 'INSUFFICIENT_POINTS' };

	// 申請作成 (#3356 (1): 重複判定は repo の原子境界に内蔵。旧 findPendingByChildAndReward の
	// check-then-act は並行 submit で両者が「pending 無し」を読み二重申請 → 即時交換モードで
	// 二重減算を招く TOCTOU だった。repo は (a) pending 既存 (b) 直近 approved 窓 (連打/再送/多タブ)
	// のいずれかで DUPLICATE_REQUEST を返す)
	const now = Math.floor(Date.now() / 1000);
	const row = await insertRedemptionRequest(
		{ childId, rewardId, requestedAt: now, quantity },
		tenantId,
	);
	if ('error' in row) return await classifyDuplicate(childId, rewardId, tenantId);

	// #3339: 家庭設定で即時交換が有効なら、その場で承認確定（減算 + approved）し親承認をスキップする。
	// 既存の親承認と同一の finalizeApproval を共有するため減算・監査・status 更新の挙動は一致する
	// （resolvedByParentId=null = システム自動承認）。OFF（既定）なら従来どおり pending を返す。
	if (await isRewardAutoApproveEnabled(tenantId)) {
		const finalized = await finalizeApproval({
			childId,
			requestId: row.id,
			rewardPoints: reward.points,
			quantity: row.quantity,
			rewardTitle: reward.title,
			parentUserId: null,
			tenantId,
		});
		if ('error' in finalized) {
			// #3347: 即時交換で減算に失敗した場合（並行交換による残高不足等）、直前に作成した
			// pending 行が「親の承認待ち」として残ると、子供がエラーを受け取った交換が保護者画面に
			// 幻の承認待ちとして出続けてしまう。expired に倒して回収する（getUnshownResult は
			// approved/rejected のみ surface するため子供側にも露出しない）。
			await updateRedemptionRequestStatus(
				childId,
				row.id,
				{ status: 'expired', resolvedAt: now },
				tenantId,
			);
			// 残高は上で確認済だが、並行交換で不足した場合は INSUFFICIENT_POINTS を返す。
			// REQUEST_NOT_FOUND（直前 insert の取り違え）は理論上発生しないが安全側で REWARD_NOT_FOUND に倒す。
			return finalized.error === 'INSUFFICIENT_POINTS'
				? { error: 'INSUFFICIENT_POINTS' }
				: { error: 'REWARD_NOT_FOUND' };
		}
		return { ...finalized, instant: true };
	}

	return {
		id: row.id,
		childId: row.childId,
		rewardId: row.rewardId,
		quantity: row.quantity,
		status: row.status as RedemptionStatus,
		requestedAt: row.requestedAt,
		parentNote: row.parentNote,
		resolvedAt: row.resolvedAt,
		shownToChildAt: row.shownToChildAt,
		instant: false,
	};
}

/**
 * #4407 AC10: repo の `DUPLICATE_REQUEST` を、子供に見せる文言が正しくなるよう 2 つに分ける。
 *
 * repo の dedup 契約は (a) 同一 (child, reward) の pending 既存 / (b) 直近 approved 10 秒窓 の
 * 2 経路を同一エラーに畳んでいる。旧実装はこれを一律「既に申請中です」と表示していたため、
 * 即時交換 ON の家庭 (pending が存在しない) で **事実と違う文言**が出ていた (#4407 追加報告)。
 *
 * 本判定は「弾かれた後」に走る読み取りのみで、dedup の原子境界には一切関与しない
 * (二重課金防止を弱めない)。pending が実在すれば ALREADY_PENDING、無ければ dedup 窓由来と判断する。
 */
async function classifyDuplicate(
	childId: ChildId,
	rewardId: string,
	tenantId: string,
): Promise<{ error: 'ALREADY_PENDING' } | { error: 'RECENTLY_EXCHANGED' }> {
	const requests = await findRedemptionRequestsByChild(childId, tenantId);
	const hasPending = requests.some(
		(r) => r.rewardId === rewardId && r.status === 'pending_parent_approval',
	);
	return hasPending ? { error: 'ALREADY_PENDING' } : { error: 'RECENTLY_EXCHANGED' };
}

// ============================================================
// 申請一覧取得（子供向け）
// ============================================================

export async function getRedemptionRequestsForChild(childId: ChildId, tenantId: string) {
	return findRedemptionRequestsByChild(childId, tenantId);
}

// ============================================================
// 申請一覧取得（親向け）
// ============================================================

export async function getRedemptionRequestsForParent(
	tenantId: string,
	opts?: {
		status?: string;
		statuses?: readonly string[];
		childId?: ChildId;
		limit?: number;
		order?: 'asc' | 'desc';
	},
) {
	const rows = await findRedemptionRequestsByTenant(tenantId, opts);
	return rows.map((r) => ({
		id: r.id,
		childId: r.childId,
		childName: r.childName,
		rewardId: r.rewardId,
		rewardTitle: r.rewardTitle,
		rewardIcon: r.rewardIcon,
		rewardPoints: r.rewardPoints,
		// #4407 AC4: 「ゲーム時間 +30分 × 4」を 1 件として承認できるよう個数と合計を渡す。
		quantity: r.quantity,
		totalPoints: r.rewardPoints * r.quantity,
		status: r.status as RedemptionStatus,
		requestedAt: r.requestedAt,
		parentNote: r.parentNote,
		resolvedAt: r.resolvedAt,
	}));
}

/**
 * #3144: テナント内の「親の承認待ち」ごほうび交換申請の件数を返す。
 * admin ホームの承認待ちバナー（発見性導線）で使う。
 * countRedemptionRequestsByTenant は limit を掛けず COUNT するため 50 件以上でも飽和しない
 * (findRedemptionRequestsByTenant の limit(50) 流用だと 51+ 件で過少カウントになる)。
 */
export async function countPendingRedemptionsForParent(tenantId: string): Promise<number> {
	return countRedemptionRequestsByTenant(tenantId, {
		status: 'pending_parent_approval',
	});
}

/**
 * #4682: 承認待ち申請が存在するごほうびの id 集合 (DISTINCT、limit なし)。
 *
 * ごほうび管理画面の「申請時点の内容で処理」note と削除前の処理待ちバッジで使う。
 * 表示用一覧 (`getRedemptionRequestsForParent`、既定 limit 50) を map して導くと、
 * 申請が 51 件以上になった時点で種別が静かに抜け落ち、親が「処理待ちがある」ことに
 * 気づかないままごほうびを編集 / 削除してしまう。
 */
export async function getPendingRewardIdsForParent(tenantId: string): Promise<string[]> {
	return findPendingRewardIdsByTenant(tenantId);
}

// ============================================================
// 承認
// ============================================================

export type ApproveError =
	| { error: 'INVALID_STATUS' }
	| { error: 'INSUFFICIENT_POINTS' }
	| { error: 'REQUEST_NOT_FOUND' };

/**
 * 申請を「承認 (approved)」に確定する共通処理（#3339 で抽出）。
 * ポイント減算（残高 >= コストのときのみ原子的に台帳挿入）→ status='approved' 更新を行う。
 * 親承認（{@link approveRedemption}）と即時交換（{@link requestRedemption} の auto-approve 経路）で共有する。
 *
 * #3347（TOCTOU 二重減算根治）: 旧実装は `getBalance`（残高読込）→ 非負確認 →
 * `insertPointEntry`（挿入）を await を跨いで行っていたため、即時交換の並行 / 二重 submit で
 * 両方が同じ残高を読んで二重減算・残高マイナスを起こし得た（#3336 と同型）。残高確認と減算を
 * `spendPointsAtomic`（backend の原子境界）に閉じ込め、2 回目は減算後残高を読み INSUFFICIENT に
 * 倒すことで構造的に防ぐ。
 *
 * @param parentUserId 承認した保護者の認証 userId。即時交換（システム自動承認）では null。
 */
async function finalizeApproval(args: {
	childId: ChildId;
	requestId: string;
	/** ごほうび 1 個あたりの単価。 */
	rewardPoints: number;
	/** #4407: 申請個数。実際の控除額は rewardPoints × quantity。 */
	quantity: number;
	rewardTitle: string;
	parentUserId: string | null;
	tenantId: string;
}): Promise<RedemptionRequestResult | { error: 'INSUFFICIENT_POINTS' | 'REQUEST_NOT_FOUND' }> {
	const { childId, requestId, rewardPoints, quantity, rewardTitle, parentUserId, tenantId } = args;

	// #4407 AC3: 承認時の残高再確認も「単価 × 個数」で行う。1 個分しか引かない / N 倍に引きすぎる の
	// どちらも顧客の信頼を直接壊すため、控除額の算出はこの 1 箇所に閉じる。
	const totalPoints = rewardPoints * quantity;

	// #3347: 残高再読込 → 非負確認 → 減算を原子境界で実行（TOCTOU 二重減算・残高マイナス防止）。
	const spend = await spendPointsAtomic(
		childId,
		totalPoints,
		{
			type: 'reward_redemption',
			// #4407: 個数が残るようにする (履歴を見た親が「残高が理由なく動いた」と読めないように)。
			// 個数 1 なら従来どおりごほうび名のみ。
			description: formatRewardWithQuantity(rewardTitle, quantity),
			referenceId: requestId,
		},
		tenantId,
	);
	if ('error' in spend) return { error: 'INSUFFICIENT_POINTS' };

	// ステータス更新 (#2845 課題①: childId で所有権検証付き composite key 更新)
	const now = Math.floor(Date.now() / 1000);
	const updated = await updateRedemptionRequestStatus(
		childId,
		requestId,
		{
			status: 'approved',
			resolvedAt: now,
			resolvedByParentId: parentUserId,
		},
		tenantId,
	);

	if (!updated) return { error: 'REQUEST_NOT_FOUND' };

	return {
		id: updated.id,
		childId: updated.childId,
		rewardId: updated.rewardId,
		quantity: updated.quantity,
		status: updated.status as RedemptionStatus,
		requestedAt: updated.requestedAt,
		parentNote: updated.parentNote,
		resolvedAt: updated.resolvedAt,
		shownToChildAt: updated.shownToChildAt,
	};
}

export async function approveRedemption(
	requestId: string,
	// #3320: 承認した保護者の認証 userId (cognito sub 等)。監査証跡として記録する。
	// local 実行モード等で identity userId が無い場合は null (= 解決者不明)。
	parentUserId: string | null,
	tenantId: string,
): Promise<RedemptionRequestResult | ApproveError> {
	// #4682 F1: id 直引き (tenant 検査込み)。旧実装は一覧 (limit 50) から find していたため、
	// 申請総数が 50 件を超えると古い承認待ちが window から落ち「申請が見つかりません」になった。
	const req = await findRedemptionRequestById(requestId, tenantId);
	if (!req) return { error: 'REQUEST_NOT_FOUND' };

	if (req.status !== 'pending_parent_approval') return { error: 'INVALID_STATUS' };

	return finalizeApproval({
		childId: req.childId,
		requestId,
		rewardPoints: req.rewardPoints,
		// #4407: 申請行が持つ個数で控除する (承認画面の表示値ではなく DB の値を権威にする)。
		quantity: req.quantity,
		rewardTitle: req.rewardTitle,
		parentUserId,
		tenantId,
	});
}

// ============================================================
// 却下
// ============================================================

export type RejectError = { error: 'INVALID_STATUS' } | { error: 'REQUEST_NOT_FOUND' };

export async function rejectRedemption(
	requestId: string,
	parentNote: string | null,
	tenantId: string,
	// #3320: 却下した保護者の認証 userId。承認と対称に監査証跡として記録する (null = 解決者不明)。
	parentUserId: string | null = null,
): Promise<RedemptionRequestResult | RejectError> {
	// #4682 F1: 承認と同じく id 直引き (一覧 limit に依存しない)。
	const req = await findRedemptionRequestById(requestId, tenantId);
	if (!req) return { error: 'REQUEST_NOT_FOUND' };

	if (req.status !== 'pending_parent_approval') return { error: 'INVALID_STATUS' };

	const now = Math.floor(Date.now() / 1000);
	// #2845 課題①: req.childId で所有権検証付き composite key 更新
	const updated = await updateRedemptionRequestStatus(
		req.childId,
		requestId,
		{
			status: 'rejected',
			parentNote: parentNote ? parentNote.slice(0, 100) : null,
			resolvedAt: now,
			resolvedByParentId: parentUserId,
		},
		tenantId,
	);

	if (!updated) return { error: 'REQUEST_NOT_FOUND' };

	return {
		id: updated.id,
		childId: updated.childId,
		rewardId: updated.rewardId,
		quantity: updated.quantity,
		status: updated.status as RedemptionStatus,
		requestedAt: updated.requestedAt,
		parentNote: updated.parentNote,
		resolvedAt: updated.resolvedAt,
		shownToChildAt: updated.shownToChildAt,
	};
}

// ============================================================
// 期限切れ処理（cron 用）
// ============================================================

export async function expireOldRedemptions(tenantId: string): Promise<number> {
	return expireOldRedemptionsRepo(tenantId);
}

/**
 * #4682 F3: 1 回の実行で走査するテナント数の上限 (13-AWS設計書 §3.3 self-limiting)。
 *
 * 上限を超えた分は **翌日以降のスライスで必ず順番が回る** (`selectTenantSlice` の日次ローテーション)。
 * `tenants.slice(0, limit)` にすると 201 番目以降が永久に処理されないまま
 * 「次回に持ち越し」と log に書く嘘になるため、先頭固定の切り出しはしない。
 */
export const EXPIRE_REDEMPTIONS_TENANT_LIMIT = 200;

export interface ExpireRedemptionsResult {
	/** 期限切れに移した申請の件数 (dryRun のときは 0)。 */
	expiredCount: number;
	/** 存在するテナント総数。 */
	tenantsTotal: number;
	/** 今回処理したテナント数。 */
	tenantsProcessed: number;
	/**
	 * 今回処理しなかったテナント数 = 今日の担当外 (ローテーション、正常) + 予算超過での打ち切り。
	 * 内訳は下の 2 つで区別する (age-recalc と同じ規約、#4345)。
	 */
	tenantsRemaining: number;
	/** 今日の担当スライス外 (翌日以降に必ず順番が回る、正常)。 */
	tenantsSkippedByRotation: number;
	/** 担当スライス内で時間予算により打ち切った数 (異常。warn の対象)。 */
	tenantsSkippedByBudget: number;
	/** 何番目のスライスを処理したか (0 始まり)。 */
	sliceIndex: number;
	/** スライスの総数 (= 全テナントを一巡するのにかかる日数)。 */
	sliceCount: number;
	/** 時間予算超過で打ち切ったか。 */
	budgetExceeded: boolean;
	/** テナント単位で失敗した件数 (1 件の失敗で全体を止めない)。 */
	failures: number;
	/** 実際には更新せず対象件数だけ数えたか (#4682: 本番投入前の観測手段)。 */
	dryRun: boolean;
}

/**
 * #4682 F3: **全テナント**の 30 日超 pending を expired に移す (cron 用)。
 *
 * 旧実装は endpoint が `expireOldRedemptions('default')` を直に呼んでおり、
 * (a) `default` 以外のテナントが 1 件も処理されない (b) そもそも registry に載っておらず
 * どの runtime でもスケジュールされていない、の二重の理由で**一度も動いていなかった**。
 * 結果、子供のごほうびが「うけとりまち」のまま無期限に残り、履歴の「きげんぎれ」は
 * 到達不能なラベルになっていた。
 *
 * self-limiting (13-AWS設計書 §3.3): テナント数に比例するため件数上限 + 時間予算で打ち切り、
 * 残りは次回実行へ持ち越して件数を必ず報告する (silent 持ち越し禁止)。expire は冪等
 * (同じ行を 2 回 expired にしても結果は同じ) なので、持ち越しでデータは壊れない。
 */
export async function expireOldRedemptionsForAllTenants(options?: {
	tenantLimit?: number;
	budget?: TimeBudget;
	/** JST 暦日 (テスト注入用)。スライス選択の決定性を保つため実行日から導く。 */
	today?: string;
	/** true なら status を書き換えず「対象になる件数」だけ数える (#4682)。 */
	dryRun?: boolean;
}): Promise<ExpireRedemptionsResult> {
	const tenantLimit = options?.tenantLimit ?? EXPIRE_REDEMPTIONS_TENANT_LIMIT;
	const budget = options?.budget ?? createTimeBudget();
	const today = options?.today ?? todayDateJST();
	const dryRun = options?.dryRun ?? false;

	// #4682: dry-run は「実際に失効する件数」を報告しなければ観測の意味がない。
	// 実処理 (expireOldRedemptions) と同一の経過秒 (REDEMPTION_EXPIRE_AFTER_SEC) から cutoff を
	// 導き、count にも同じ期間条件を渡す (cutoff の無い COUNT は承認待ち全件を「失効予定」と
	// 過大報告し、運用判断を誤らせる)。
	const expireCutoffEpoch = Math.floor(Date.now() / 1000) - REDEMPTION_EXPIRE_AFTER_SEC;

	const tenants = await getRepos().auth.listAllTenants();
	// #4682: 先頭固定 (`slice(0, limit)`) にすると上限超過分が永久に処理されない。
	// 実行日から決まるスライスを選び、ceil(total / limit) 日で全テナントを重複なく周回する。
	const { slice, sliceIndex, sliceCount } = selectTenantSlice(tenants, tenantLimit, today);

	let expiredCount = 0;
	let tenantsProcessed = 0;
	let failures = 0;
	let budgetExceeded = false;

	for (const tenant of slice) {
		if (budget.exceeded()) {
			budgetExceeded = true;
			break;
		}
		tenantsProcessed++;
		try {
			expiredCount += dryRun
				? await countRedemptionRequestsByTenant(tenant.tenantId, {
						status: 'pending_parent_approval',
						requestedBeforeEpoch: expireCutoffEpoch,
					})
				: await expireOldRedemptionsRepo(tenant.tenantId);
		} catch (err) {
			failures++;
			logger.error('[expire-redemptions] tenant failed', {
				context: { tenantId: tenant.tenantId },
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// #4345 と同じ規約: 「今日の担当外 (正常)」と「担当内での打ち切り (異常)」を分けて数える。
	const tenantsSkippedByRotation = tenants.length - slice.length;
	const tenantsSkippedByBudget = slice.length - tenantsProcessed;
	const tenantsRemaining = tenantsSkippedByRotation + tenantsSkippedByBudget;

	if (tenantsSkippedByBudget > 0) {
		// silent 打ち切り禁止 (ADR-0006 整合)。ローテーションによる担当外は異常ではないので warn しない。
		logger.warn('[expire-redemptions] budget cutoff — carried over to next run', {
			context: {
				skippedByBudget: tenantsSkippedByBudget,
				skippedByRotation: tenantsSkippedByRotation,
				processed: tenantsProcessed,
				total: tenants.length,
				sliceIndex,
				sliceCount,
			},
		});
	}

	return {
		expiredCount,
		tenantsTotal: tenants.length,
		tenantsProcessed,
		tenantsRemaining,
		tenantsSkippedByRotation,
		tenantsSkippedByBudget,
		sliceIndex,
		sliceCount,
		budgetExceeded,
		failures,
		dryRun,
	};
}

// #4435: getUnshownRedemptionResult / markRedemptionShown は撤去した。
// 交換申請の承認・却下は子供のごほうびショップ (`latestRequestStatus` バッジ) と履歴画面が
// 常時表示しており、`shown_to_child_at` を使う「一度だけ出す」全画面通知は production から
// 呼ばれない到達不能経路のまま残っていた (#4432 実測)。子供ホームのオーバーレイを増やすのは
// ADR-0012 (anti-engagement) にも反するため、繋がずに撤去した。
