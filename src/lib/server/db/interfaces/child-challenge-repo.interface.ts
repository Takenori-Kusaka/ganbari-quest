import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/interfaces/child-challenge-repo.interface.ts
// IChildChallengeRepo — per-child challenge instance CRUD (#2362 PR-7、ADR-0055、User §6)
//
// 旧 ISiblingChallengeRepo (family-wide + progress 別 table) を per-child instance に
// 飛ばした新 interface。並存維持 (旧 sibling_* は cleanup #2458)。
//
// 設計 SSOT:
//   - docs/design/data-model-resource-scope.md §4.7
//   - docs/design/marketplace-import-flow.md (challenge-set 取込フロー)

import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';

export interface IChildChallengeRepo {
	/** child 単位の全 challenge instance (status / 期間問わず) */
	findByChildId(childId: ChildId, tenantId: string): Promise<ChildChallenge[]>;

	/** child 単位のアクティブ challenge instance (status=active かつ today が start〜end の範囲内) */
	findActiveByChildId(childId: ChildId, today: string, tenantId: string): Promise<ChildChallenge[]>;

	/**
	 * #2488 (must-1 fix): 子供画面向け「active + 完成済だが未請求」instance を返す。
	 *
	 * status='active' に加え、status='completed' AND rewardClaimed=0 の instance も含める。
	 * markCompleted 直後に instance が消えて claim ボタンが render されない regression を防ぐため
	 * 子供画面 (home / history) は本関数経由でデータ取得すること。
	 */
	findActiveOrUnclaimedByChildId(
		childId: ChildId,
		today: string,
		tenantId: string,
	): Promise<ChildChallenge[]>;

	/** tenant 全体の全 challenge instance (admin 画面用) */
	findAllByTenant(tenantId: string): Promise<ChildChallenge[]>;

	/** id で 1 件取得 (tenant 越え防止のため tenantId 必須) */
	findById(id: string, tenantId: string): Promise<ChildChallenge | undefined>;

	/** 1 child に 1 instance insert */
	insert(input: InsertChildChallengeInput, tenantId: string): Promise<ChildChallenge>;

	/**
	 * #3329 backup restore 用: 進捗 / 完了 / 請求 / status / 日時を含む全フィールドを保全して復元する。
	 * 通常の insert は currentValue / completed / rewardClaimed / createdAt を初期化するため round-trip で
	 * 進捗・完了・請求状態が失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、
	 * childId は呼び出し側が import 後の child に解決済)。
	 *
	 * #3387/#3394 統一冪等契約: auto:weekly 行 (sourceTemplateId='auto:weekly') の
	 * (childId, startDate) が既存なら **null** を返す (重複 skip。SQLite=部分 unique index /
	 * DynamoDB=AUTO# 決定的 SK + attribute_not_exists / DSQL=weekly_auto_guard UNIQUE で機能等価)。
	 * その他の write 失敗は throw する (throttle silent loss 禁止、#3401)。
	 */
	insertForRestore(
		input: Omit<ChildChallenge, 'id'>,
		tenantId: string,
	): Promise<ChildChallenge | null>;

	/**
	 * #3245: アプリ週次自動生成 (sourceTemplateId='auto:weekly') の **atomic** get-or-create。
	 * (child_id, start_date) の一意性を DB レベル (SQLite=部分 unique index / DynamoDB=決定的キー +
	 * 条件付き書込) で担保し、concurrent 二重 INSERT (= ポイント二重付与) を不可能化する。
	 * 既存があればそれを、無ければ新規作成して返す (どちらが勝っても 1 行に収束)。
	 * input.sourceTemplateId は 'auto:weekly'、startDate を週キーとして扱う。
	 */
	getOrCreateWeeklyAuto(
		input: InsertChildChallengeInput,
		tenantId: string,
	): Promise<ChildChallenge>;

	/** bulk insert (兄弟一括追加 / preset 取込で複数 child に同時挿入) */
	insertBulk(
		inputs: readonly InsertChildChallengeInput[],
		tenantId: string,
	): Promise<ChildChallenge[]>;

	/** 進捗更新 (currentValue 増分、completed 判定は service 層) */
	updateProgress(id: string, currentValue: number, tenantId: string): Promise<void>;

	/** 完了マーク (currentValue >= targetValue 達成時) */
	markCompleted(id: string, tenantId: string): Promise<void>;

	/**
	 * #4686: とりけし時の対称巻き戻し。completed=1 かつ **reward_claimed=0** の instance だけを
	 * completed=0 / status='active' / completed_at=NULL に戻す (受取済みは触らない = 受取済ポイント
	 * との整合を保つ)。currentValue の減算は updateProgress で service 層が行う。
	 */
	revertCompletion(id: string, tenantId: string): Promise<void>;

	/**
	 * #4410: 達成祝福 (SiblingCelebration) を「見せた」ことを記録する。
	 *
	 * 「一度見せたら次から出さない」媒体 A (行に timestamp 列)。満たすべき条件は
	 * `docs/design/parallel-implementations.md` §13 が SSOT で、`sibling_cheers.markShown` /
	 * `parent_messages.markMessageShown` も同じ条件を満たす (#4435 で揃えた。それ以前は
	 * 「同型」と書かれていながら冪等性も所有権の掛け方も食い違っていた)。
	 * 祝福の停止条件はこの列のみが持ち、`rewardClaimed` (ごほうび受取) とは独立させる (#4410 AC3)。
	 * 既に記録済の行は上書きしない (冪等 — 最初に見せた時刻を保つ)。
	 */
	markCelebrationShown(id: string, tenantId: string): Promise<void>;

	/**
	 * ごほうび受取マーク + ポイント付与の**単一原子プリミティブ** (#3284 / #3342、#3333 の後継)。
	 *
	 * `rewardClaimed=0 AND completed=1` の行のみを flip し、flip できた場合に限り同一
	 * トランザクション境界内で point ledger へ付与エントリを書く (type='child_challenge' /
	 * referenceId=id は本メソッドが内部で設定する = 冪等キー SSOT)。戻り値は flip 行数
	 * (1 = flip + 付与成功 / 0 = 既請求 or 未完了)。
	 *
	 * 原子性契約 (両成功 or 両 rollback):
	 *   - SQLite: better-sqlite3 同期 transaction (flip → 行数 gate → ledger insert)
	 *   - DynamoDB: TransactWriteItems (条件付き flip + ledger Put + 冪等 marker Put)
	 *   - DSQL/PGlite: runner txn (条件付き UPDATE RETURNING → ledger INSERT + total_point 共更新)
	 *   - demo: stateless guard semantics (ADR-0048、fixture 非 mutate)
	 *
	 * 旧 `claimReward` (flip のみ) は ledger insert が txn 外に残る half-primitive だったため
	 * 撤去 (#3342 lost-award edge: flip 成功後の ledger throw で恒久受取不能)。
	 * ledger 側は (childId, type, referenceId) 冪等 UNIQUE (#3284) が defense-in-depth で挟む。
	 *
	 * @throws DynamoDB backend で challenge が tenant 内に見つからない場合 (#3342 (3):
	 *         not-found を「既請求 (0)」と混同させない。service 層は事前 findById で
	 *         not-found を user error に落とすため、ここでの throw は並行削除等の異常系)。
	 */
	claimRewardAndGrantPoints(
		id: string,
		ledger: { childId: ChildId; amount: number; description: string },
		tenantId: string,
	): Promise<number>;

	/** メタ更新 (status / 期間 / target / reward 変更) */
	update(id: string, input: UpdateChildChallengeInput, tenantId: string): Promise<void>;

	/** 1 instance 削除 (`delete` は予約語のため `deleteChallenge` を使用) */
	deleteChallenge(id: string, tenantId: string): Promise<void>;

	/**
	 * source child の challenge 全件を target child に複製。
	 * sourceTemplateId は維持し、新 child instance の進捗は currentValue=0 / completed=0 にリセット。
	 * 兄弟共通化 UX (#2362 PR-7、User §6) の cross-child copy で使用。
	 *
	 * @returns target child に作成された ChildChallenge 配列
	 */
	copyAcrossChildren(
		sourceChildId: ChildId,
		targetChildId: ChildId,
		tenantId: string,
	): Promise<ChildChallenge[]>;

	/** tenant 全体の child challenge を削除 (テナント削除時) */
	deleteByTenantId(tenantId: string): Promise<void>;
}
