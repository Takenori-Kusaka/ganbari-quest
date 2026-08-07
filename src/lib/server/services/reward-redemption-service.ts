import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/reward-redemption-service.ts
// ごほうびショップ交換申請サービス (#1337)

import { formatRewardWithQuantity } from '$lib/domain/labels';
import {
	isValidRedemptionQuantity,
	REDEMPTION_QUANTITY_MIN,
} from '$lib/domain/validation/special-reward';
import { findChildById, getBalance, spendPointsAtomic } from '$lib/server/db/point-repo';
import {
	countRedemptionRequestsByTenant,
	expireOldRedemptions as expireOldRedemptionsRepo,
	findRedemptionRequestsByChild,
	findRedemptionRequestsByTenant,
	insertRedemptionRequest,
	updateRedemptionRequestStatus,
} from '$lib/server/db/reward-redemption-repo';
import { getSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards } from '$lib/server/db/special-reward-repo';

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
	opts?: { status?: string; childId?: ChildId; limit?: number },
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
	// 申請取得（テナント内か確認のため全件から検索）
	// children + specialRewards 結合で取得
	const allPending = await findRedemptionRequestsByTenant(tenantId);
	const req = allPending.find((r) => r.id === requestId);
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
	const allRequests = await findRedemptionRequestsByTenant(tenantId);
	const req = allRequests.find((r) => r.id === requestId);
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

// #4435: getUnshownRedemptionResult / markRedemptionShown は撤去した。
// 交換申請の承認・却下は子供のごほうびショップ (`latestRequestStatus` バッジ) と履歴画面が
// 常時表示しており、`shown_to_child_at` を使う「一度だけ出す」全画面通知は production から
// 呼ばれない到達不能経路のまま残っていた (#4432 実測)。子供ホームのオーバーレイを増やすのは
// ADR-0012 (anti-engagement) にも反するため、繋がずに撤去した。
