import type { ArchivedReason } from '$lib/domain/archive-types';
import type { Child, InsertChildInput, UpdateChildInput } from '../types';

/**
 * #3184 item2 / #3475: resetChildProgressData が**実際に削除した各 entity の件数**。dev-only switch
 * reset の診断用。全 field が「実削除件数」で意味統一されている。pointBalance は DynamoDB のみ存在する
 * 派生集計 (SK=BALANCE) の実削除行数 (存在すれば 1、なければ 0)。SQLite は POINT# 行集計で BALANCE 行を
 * 持たないため常に 0。
 */
export interface ChildProgressResetCounts {
	activityLogs: number;
	pointLedger: number;
	loginBonuses: number;
	childAchievements: number;
	pointBalance: number;
}

export interface IChildRepo {
	findAllChildren(tenantId: string): Promise<Child[]>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
	findChildByUserId(userId: string, tenantId: string): Promise<Child | undefined>;
	insertChild(input: InsertChildInput, tenantId: string): Promise<Child>;
	updateChild(id: number, input: UpdateChildInput, tenantId: string): Promise<Child | undefined>;
	deleteChild(id: number, tenantId: string): Promise<void>;

	/**
	 * #3152: 子供 1 人分の進捗データ (activity_logs / point_ledger / login_bonuses /
	 * child_achievements + DynamoDB は派生集計 BALANCE) を全削除する。child 行自体は残す
	 * (dev-only デバッグ用途、原 switch debug-reset と同一 scope の忠実保持)。
	 *
	 * #3184 item1 (scope 契約): 本 reset は上記 entity allowlist のみを削除し、同一 child PK 配下の
	 * ステータスバー (STATUS# / STATHIST#) / バトル (BATTLE# / enemyCollection.defeatCount) /
	 * childChallenge.currentValue / 評価 (EVAL#) / ごほうび (REWARD#) は**意図的に survive させる**。
	 * これは「ポイント残高は 0 だがステータス/図鑑/チャレンジは満タン」という一見矛盾した状態を生むが、
	 * dev-only の進捗リセット (= 記録系のみ初期化) の定義であり仕様。両 backend (sqlite / dynamodb) で
	 * 同一 allowlist を使い、返り値 {@link ChildProgressResetCounts} の key 集合が cross-backend で一致する
	 * ことを `tests/unit/db/dynamodb-child-repo-reset.test.ts` の契約テストで機械固定する。
	 */
	resetChildProgressData(id: number, tenantId: string): Promise<ChildProgressResetCounts>;

	// #783: archive / restore
	// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
	archiveChildren(ids: number[], reason: ArchivedReason, tenantId: string): Promise<void>;
	restoreArchivedChildren(reason: ArchivedReason, tenantId: string): Promise<void>;
	findArchivedChildren(tenantId: string): Promise<Child[]>;
}
