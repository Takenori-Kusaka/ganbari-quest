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

	/** tenant 全体の全 challenge instance (admin 画面用) */
	findAllByTenant(tenantId: string): Promise<ChildChallenge[]>;

	/** id で 1 件取得 (tenant 越え防止のため tenantId 必須) */
	findById(id: number, tenantId: string): Promise<ChildChallenge | undefined>;

	/** 1 child に 1 instance insert */
	insert(input: InsertChildChallengeInput, tenantId: string): Promise<ChildChallenge>;

	/** bulk insert (兄弟一括追加 / preset 取込で複数 child に同時挿入) */
	insertBulk(
		inputs: readonly InsertChildChallengeInput[],
		tenantId: string,
	): Promise<ChildChallenge[]>;

	/** 進捗更新 (currentValue 増分、completed 判定は service 層) */
	updateProgress(id: number, currentValue: number, tenantId: string): Promise<void>;

	/** 完了マーク (currentValue >= targetValue 達成時) */
	markCompleted(id: number, tenantId: string): Promise<void>;

	/** ごほうび受取マーク */
	claimReward(id: number, tenantId: string): Promise<void>;

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
