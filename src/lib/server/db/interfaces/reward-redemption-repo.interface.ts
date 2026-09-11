import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/interfaces/reward-redemption-repo.interface.ts

export interface RedemptionRequestRow {
	id: string;
	childId: ChildId;
	rewardId: string;
	requestedAt: number;
	/**
	 * #4407: 1 申請が表す個数 (単位量のごほうび = 「ゲーム時間 +30分」等の N 個買い)。
	 * 値域は `REDEMPTION_QUANTITY_MIN/MAX` (domain 層 SSOT)。DB 既定 1、旧行も backfill 済のため
	 * 常に 1 以上。ポイント控除は `rewardPoints × quantity` で行う (service 層 finalizeApproval)。
	 *
	 * **書込境界の不変条件**: 全 backend の insert 実装は `normalizeRedemptionQuantity` を通して
	 * 永続化する。service 層の validator を通らない経路 (restore / 将来の別 backend) が 0 / 負値を
	 * 書けると、承認時の `rewardPoints × quantity` が 0 や負になり「減算のつもりが付与」になるため、
	 * repo 入口でも値域へ収束させる (DSQL は `ALTER TABLE ADD CONSTRAINT` 非対応で後付け CHECK を
	 * 置けないため、防壁を application 側の単一 helper に寄せる)。
	 */
	quantity: number;
	status: string;
	parentNote: string | null;
	resolvedAt: number | null;
	resolvedByParentId: string | null;
	shownToChildAt: number | null;
	/**
	 * #2832 申請時点 snapshot (#4632 で row 型へ昇格)。
	 *
	 * 子供の「記録 > 交換」は「いつ・何を・いくらで交換したか」を出す画面なのに、row 型が
	 * snapshot を落としていたため title / icon / points を渡せず、日付をタイトル代わりに出して
	 * アイコンを 🎁 固定にしていた (何を交換したか判別不能)。
	 * 値は「snapshot 優先 / 旧行は live reward に fallback」で解決済 (repo 側 COALESCE)。
	 * reward が削除済で旧行 (snapshot NULL) の場合のみ null になる。
	 */
	rewardTitle: string | null;
	rewardIcon: string | null;
	rewardPoints: number | null;
}

export interface RedemptionRequestWithDetails extends RedemptionRequestRow {
	childName: string;
	rewardTitle: string;
	rewardIcon: string | null;
	rewardPoints: number;
}

/**
 * #3356 (1): 直近 approved 交換の重複排除窓 (秒)。同一 (child, reward) の approved 申請が
 * resolvedAt からこの窓内に存在する場合、新規申請を DUPLICATE_REQUEST で弾く。
 * 即時交換 (reward_auto_approve) の連打 / 再送 / 多タブによる「1 回のつもりが 2 回課金」を
 * server 側で遮断する idempotency 窓。意図的な連続購入は窓経過後に可能。
 */
export const REDEMPTION_DEDUP_WINDOW_SEC = 10;

/**
 * #4682: 承認待ち申請が自動失効するまでの経過秒 (30 日)。
 *
 * `expireOldRedemptions` の実更新条件 (`requestedAt < now - この値`) と、cron の dry-run が数える
 * 件数 (`countRedemptionRequestsByTenant` の `requestedBeforeEpoch`) が**同一の値**を見るための SSOT。
 * backend ごとに 30 を書くと「dry-run の報告件数と実際に失効する件数が食い違う」= 本番投入前の
 * 観測が運用判断を誤らせる (実測: dry-run 側に期間条件が無く、承認待ち**全件**を失効予定として
 * 報告していた)。
 */
export const REDEMPTION_EXPIRE_AFTER_SEC = 30 * 24 * 60 * 60;

export interface IRewardRedemptionRepo {
	/**
	 * 交換申請を作成する (#3356 (1) server-side idempotency 内蔵)。
	 *
	 * dedup 契約 — 以下のいずれかに該当する場合は行を作らず `{ error: 'DUPLICATE_REQUEST' }`:
	 *   (a) 同一 (childId, rewardId) の `pending_parent_approval` 申請が既存
	 *       (旧 findPendingByChildAndReward の check-then-act TOCTOU を repo 原子境界へ移設)
	 *   (b) 同一 (childId, rewardId) の `approved` 申請が resolvedAt >= now - REDEMPTION_DEDUP_WINDOW_SEC
	 *       に存在 (即時交換の連打で pending が瞬時に approved 化した直後の再送を遮断)
	 *
	 * 原子性: SQLite=同期 txn / DSQL・PGlite=children 行 FOR UPDATE で per-child 直列化
	 * (spendPointsAtomic と同パターン) / DynamoDB=pending marker item への条件付き Put を
	 * 申請 Put と同一 TransactWriteItems 化 ((b) は pre-read best-effort)。
	 */
	insertRedemptionRequest(
		input: { childId: ChildId; rewardId: string; requestedAt: number; quantity: number },
		tenantId: string,
	): Promise<RedemptionRequestRow | { error: 'DUPLICATE_REQUEST' }>;

	/**
	 * #3329 backup restore 用: 申請時点の全フィールド (status / 解決情報 / snapshot) を保全して
	 * 復元する。通常の insertRedemptionRequest は status を pending 固定 + live reward を引くため
	 * round-trip で承認済/却下/snapshot が失われる。本メソッドは export された値をそのまま書き戻す。
	 * id は新規採番 (元 id は保全しない、FK は呼び出し側が解決済の rewardId を渡す)。
	 *
	 * #3394 統一冪等契約: 永続化しなかった場合 (demo no-op stub) は **null** を返し、
	 * import カウント (rewardRedemptionsImported) を偽装しない (#2263 count 偽装 class)。
	 */
	insertRedemptionForRestore(
		input: {
			childId: ChildId;
			/**
			 * 取込先で解決した reward の id。
			 *
			 * #4683: **null = 取込先に該当ごほうびが無い** (元テナントで削除済 / backup に reward が
			 * 含まれない)。この場合も履歴行は復元する — ポイント台帳の控除は復元されるため、
			 * 履歴だけ落とすと「使途の分からない減算」が残る。各 backend は「絶対に採番されない id」
			 * (sqlite=0 / pg=nil UUID) を書き、表示は snapshot 列が担う。
			 */
			rewardId: string | null;
			requestedAt: number;
			/** #4407: 旧 backup (v1.8.0 以前) には無いため、呼び出し側が 1 に正規化して渡す。 */
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
		tenantId: string,
	): Promise<RedemptionRequestRow | null>;

	findRedemptionRequestsByChild(
		childId: ChildId,
		tenantId: string,
	): Promise<RedemptionRequestRow[]>;

	/**
	 * #4682 F1: **1 件を id で直接引く**（tenant 検査込み、limit の影響を受けない）。
	 *
	 * 承認 / 却下は「一覧の中に対象があるか」ではなく「その id の申請が存在するか」を知りたい。
	 * 旧実装は `findRedemptionRequestsByTenant(tenantId)`（一覧用 limit 50、requestedAt desc）から
	 * `find` していたため、申請総数が 50 件を超えると古い承認待ちが window から落ち、親が承認 /
	 * 却下しようとすると「申請が見つかりません」になり子供側は「うけとりまち」で固定していた。
	 * **一覧の limit を存在確認に流用しない**（同 class の再発を型で断つ）。
	 */
	findRedemptionRequestById(
		id: string,
		tenantId: string,
	): Promise<RedemptionRequestWithDetails | undefined>;

	/**
	 * 親の一覧表示用。`limit` は**表示件数**であり、存在確認 / 件数集計には使わないこと
	 * (#3144 は count を `countRedemptionRequestsByTenant`、#4682 は単件取得を
	 * `findRedemptionRequestById` に分離した)。
	 *
	 * #4682 F4: `statuses` は複数状態の OR 取得 (承認履歴 = approved か rejected の直近 N 件)。
	 * 一覧を取ってから client 側で filter すると、window が pending で埋まったときに履歴が
	 * 0 件表示になる (実測: 承認待ち 30 件で履歴が消える)。`status` と併用しない。
	 */
	findRedemptionRequestsByTenant(
		tenantId: string,
		opts?: {
			status?: string;
			statuses?: readonly string[];
			childId?: ChildId;
			limit?: number;
			/**
			 * #4682 F1: `requestedAt` の並び。既定 `'desc'` (新しい順、履歴向け)。
			 * **承認待ちキューは `'asc'` (古い順)** で取る — desc + limit だと「一番長く待っている
			 * 申請」が window の外に落ち、親が画面から永久に処理できなくなる (実測: pending 61 件で
			 * 最古 11 件が不可視)。
			 */
			order?: 'asc' | 'desc';
		},
	): Promise<RedemptionRequestWithDetails[]>;

	/**
	 * #3144: テナント内の交換申請の正確な件数を返す (COUNT、limit なし)。
	 * findRedemptionRequestsByTenant は admin 一覧表示用に limit(50) を持つため件数算出に
	 * 流用すると 50 で飽和する。本メソッドは limit を掛けず正確な件数を返す。
	 *
	 * #4682: `requestedBeforeEpoch` は「申請日時がこの epoch 秒より前」の期間条件 (境界は排他)。
	 * 失効 cron の dry-run が `expireOldRedemptions` と**同じ母集団**を数えるために使う
	 * (`REDEMPTION_EXPIRE_AFTER_SEC` から導く)。省略時は期間で絞らない。
	 */
	countRedemptionRequestsByTenant(
		tenantId: string,
		opts?: {
			status?: string;
			statuses?: readonly string[];
			childId?: ChildId;
			requestedBeforeEpoch?: number;
		},
	): Promise<number>;

	/**
	 * #4682: 承認待ち申請が存在する reward id の集合 (DISTINCT、limit なし)。
	 *
	 * 一覧 (`findRedemptionRequestsByTenant`、表示用 limit つき) を map して種別抽出すると、
	 * 申請が limit を超えた時点で「処理待ちのごほうび」が静かに抜け落ち、編集 dialog の
	 * 「申請時点の内容で処理」note と削除前の処理待ちバッジが出なくなる。
	 * 種別抽出は表示用一覧から導かず、専用の DISTINCT クエリで取る。
	 */
	findPendingRewardIdsByTenant(tenantId: string): Promise<string[]>;

	/**
	 * #2845 課題①: full composite-key addressing。childId + id の複合キーで対象を直接
	 * 特定し、repo 入口で child 所有権を構造的に検証する。不一致なら undefined。
	 */
	/**
	 * 申請の状態を更新する。
	 *
	 * #4722: `options.expectedStatus` を渡すと **その状態のときだけ**更新する条件付き UPDATE になり、
	 * 一致しなければ 0 行 = `undefined` を返す。同一申請を 2 人の保護者 (or 連打) が同時承認したとき、
	 * 勝者を DB 側で 1 つに確定させ、敗者を「状態が違う」として綺麗に落とすために使う
	 * (旧実装は無条件 UPDATE のため両者が承認へ進み、2 件目が台帳の冪等 UNIQUE 違反で 500 になっていた)。
	 */
	updateRedemptionRequestStatus(
		childId: ChildId,
		id: string,
		updates: {
			status: string;
			parentNote?: string | null;
			resolvedAt?: number | null;
			resolvedByParentId?: string | null;
		},
		tenantId: string,
		options?: { expectedStatus?: string },
	): Promise<RedemptionRequestRow | undefined>;

	// findPendingByChildAndReward は #3356 (1) で撤去 (check-then-act TOCTOU の温床)。
	// pending 重複判定は insertRedemptionRequest の dedup 契約 (repo 原子境界) に内蔵済。

	// #4435: findUnshownResultByChild / markRedemptionResultShown は撤去。
	// 交換申請の承認・却下は子供のごほうびショップのバッジ (`latestRequestStatus`) と
	// 履歴画面が常時表示しており、`shown_to_child_at` を使う一度きりの全画面通知は
	// production から呼ばれない到達不能経路のまま残っていた (#4432 実測)。
	// 列自体はバックアップ往復 (export/import) の忠実性のため保持する — 撤去の終了条件は
	// src/lib/server/db/schema.ts の shownToChildAt 定義コメントを参照。

	expireOldRedemptions(tenantId: string): Promise<number>;

	hasPendingByReward(rewardId: string, tenantId: string): Promise<boolean>;

	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
