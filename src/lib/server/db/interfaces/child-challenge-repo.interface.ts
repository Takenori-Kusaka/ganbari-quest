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
	findByChildId(childId: number, tenantId: string): Promise<ChildChallenge[]>;

	/** child 単位のアクティブ challenge instance (status=active かつ today が start〜end の範囲内) */
	findActiveByChildId(childId: number, today: string, tenantId: string): Promise<ChildChallenge[]>;

	/**
	 * #2488 (must-1 fix): 子供画面向け「active + 完成済だが未請求」instance を返す。
	 *
	 * status='active' に加え、status='completed' AND rewardClaimed=0 の instance も含める。
	 * markCompleted 直後に instance が消えて claim ボタンが render されない regression を防ぐため
	 * 子供画面 (home / history) は本関数経由でデータ取得すること。
	 */
	findActiveOrUnclaimedByChildId(
		childId: number,
		today: string,
		tenantId: string,
	): Promise<ChildChallenge[]>;

	/** tenant 全体の全 challenge instance (admin 画面用) */
	findAllByTenant(tenantId: string): Promise<ChildChallenge[]>;

	/** id で 1 件取得 (tenant 越え防止のため tenantId 必須) */
	findById(id: number, tenantId: string): Promise<ChildChallenge | undefined>;

	/** 1 child に 1 instance insert */
	insert(input: InsertChildChallengeInput, tenantId: string): Promise<ChildChallenge>;

	/**
	 * #3329 backup restore 用: 進捗 / 完了 / 請求 / status / 日時を含む全フィールドを保全して復元する。
	 * 通常の insert は currentValue / completed / rewardClaimed / createdAt を初期化するため round-trip で
	 * 進捗・完了・請求状態が失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、
	 * childId は呼び出し側が import 後の child に解決済)。
	 */
	insertForRestore(input: Omit<ChildChallenge, 'id'>, tenantId: string): Promise<ChildChallenge>;

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
	updateProgress(id: number, currentValue: number, tenantId: string): Promise<void>;

	/** 完了マーク (currentValue >= targetValue 達成時) */
	markCompleted(id: number, tenantId: string): Promise<void>;

	/**
	 * ごほうび受取マーク (条件付き原子化、#3333)。
	 * `rewardClaimed=0 AND completed=1` の行のみを flip し、実際に flip した行数を返す。
	 * 並行 submit による TOCTOU 二重 claim → ポイント二重付与を防ぐため、service 層は
	 * 戻り行数 === 1 のときだけ insertPointLedger を実行する (claim-first)。
	 */
	claimReward(id: number, tenantId: string): Promise<number>;

	/** メタ更新 (status / 期間 / target / reward 変更) */
	update(id: number, input: UpdateChildChallengeInput, tenantId: string): Promise<void>;

	/** 1 instance 削除 (`delete` は予約語のため `deleteChallenge` を使用) */
	deleteChallenge(id: number, tenantId: string): Promise<void>;

	/**
	 * source child の challenge 全件を target child に複製。
	 * sourceTemplateId は維持し、新 child instance の進捗は currentValue=0 / completed=0 にリセット。
	 * 兄弟共通化 UX (#2362 PR-7、User §6) の cross-child copy で使用。
	 *
	 * @returns target child に作成された ChildChallenge 配列
	 */
	copyAcrossChildren(
		sourceChildId: number,
		targetChildId: number,
		tenantId: string,
	): Promise<ChildChallenge[]>;

	/** tenant 全体の child challenge を削除 (テナント削除時) */
	deleteByTenantId(tenantId: string): Promise<void>;
}
