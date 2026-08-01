import * as v from 'valibot';
import type { ChildId } from '$lib/domain/ids';
import type { RewardCategory } from '$lib/domain/validation/special-reward';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { findChildById } from '$lib/server/db/point-repo';
import { hasPendingByReward } from '$lib/server/db/reward-redemption-repo';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import {
	deleteSpecialReward,
	findSpecialRewards,
	findUnshownReward,
	insertSpecialReward,
	markRewardShown as markRewardShownRepo,
	updateSpecialReward,
} from '$lib/server/db/special-reward-repo';
import { logger } from '$lib/server/logger';

// --- 定数 ---

/**
 * #4172: 旧「固定間隔自動ごほうび」機構が棚に書き込んでいた行のカテゴリ。
 *
 * 活動 5 回ごとに `${n}かいきろく達成！` を `special_rewards` (= ごほうびショップの棚) へ
 * 自動 INSERT し 50pt も発行していた機構は撤去した。ただし**既存家庭の棚には過去分が残っている**ため、
 * 物理削除 (履歴破壊) はせず、本カテゴリを陳列対象から除外する形で棚を掃除する。
 *
 * 除外は `getChildSpecialRewards` の 1 箇所に集約する (repo は sqlite / dsql / demo の 3 実装が
 * あり、そこに置くと 3 箇所へ分散するため)。export / backup は `findSpecialRewards` を直接呼ぶので
 * 過去行を含み、履歴としての保全は維持される。
 */
const AUTO_MILESTONE_CATEGORY = 'auto_milestone';

// --- 型定義 ---

export interface SpecialRewardResult {
	id: string;
	childId: ChildId;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
	// #3147: ショップ陳列系統 (physical/money/privilege)。null は旧行/未指定で表示側 fallback
	shopCategory: string | null;
}

export interface RewardTemplate {
	title: string;
	points: number;
	icon?: string;
	category: RewardCategory;
}

interface GrantInput {
	childId: ChildId;
	grantedBy?: string | null;
	title: string;
	description?: string;
	points: number;
	icon?: string;
	category: string;
	// #3147: ショップ陳列系統 (physical/money/privilege)。省略時は表示側 deriveShopCategory に委ねる
	shopCategory?: string | null;
}

const TEMPLATES_KEY = 'reward_templates';

// --- DB行 → SpecialRewardResult マッピング ---

/** DB の報酬レコードを SpecialRewardResult にマッピング */
function toRewardResult(row: {
	id: string;
	childId: ChildId;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
	shopCategory?: string | null;
}): SpecialRewardResult {
	return {
		id: row.id,
		childId: row.childId,
		title: row.title,
		description: row.description,
		points: row.points,
		icon: row.icon,
		category: row.category,
		grantedAt: row.grantedAt,
		// #3147: 列値をそのまま伝播 (undefined/null は表示側 deriveShopCategory に fallback)
		shopCategory: row.shopCategory ?? null,
	};
}

// --- ごほうび追加 (#2268: grantSpecialReward → addReward リネーム) ---
// 旧名 `grantSpecialReward` は「P 付与」を示唆していたが、実態は special_rewards INSERT
// (子供 shop に並べる商品の追加)。命名訂正のため `addReward` に rename。
// 旧名は後方互換 alias で維持（#2268 影響範囲拡散防止、別 Issue で削除予定）。
//
// #4172: **棚に商品を置くことと、子供にポイントを渡すことは別の行為**。
// 本関数は長らく INSERT 直後に同額を `insertPointEntry` していたため、親が「ゲーム 30 分 = 500pt」を
// 陳列するたび子供の残高が 500pt 増えていた (ごほうびが自分の代金を自分で払う = 「活動して貯める」経済の崩壊)。
// #2268 は rename のみで挙動を据え置き、marketplace 取込 (`reward-set-import-service`) だけが
// 「大量の点数を一気に与えるのは設計上望ましくない」と加算を外していた。本 Issue で 3 経路を
// 「陳列はするが通貨は発行しない」に揃える。回帰は `tests/unit/services/reward-shop-currency.test.ts` が固定する。

export async function addReward(
	data: GrantInput,
	tenantId: string,
): Promise<SpecialRewardResult | { error: 'NOT_FOUND'; target: string }> {
	const child = await findChildById(data.childId, tenantId);
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	const reward = await insertSpecialReward(
		{
			childId: data.childId,
			grantedBy: data.grantedBy ?? null,
			title: data.title,
			description: data.description,
			points: data.points,
			icon: data.icon,
			category: data.category,
			shopCategory: data.shopCategory ?? null,
		},
		tenantId,
	);

	return toRewardResult(reward);
}

/**
 * @deprecated #2268: `addReward` に rename 済。本 alias は後方互換のため一時的に維持。
 * 新規コードでは `addReward` を使うこと。
 */
export const grantSpecialReward = addReward;

// --- ごほうび編集 / 削除 (#2832) ---

export interface UpdateRewardInput {
	title: string;
	points: number;
	icon?: string;
	category?: string;
	// #3154: ショップ陳列系統 (physical/money/privilege)。null = 自動振り分け (deriveShopCategory fallback)。
	// undefined を渡すと既存値を保全 (update は present field のみ set)。
	shopCategory?: string | null;
}

/**
 * #2832 AC2 (案 b): reward 編集。pending redemption が存在しても編集を許容する。
 * 申請済みの交換は申請時点 snapshot (redemption insert 時に保存した reward title/points)
 * で表示・控除されるため、編集は処理待ちの申請に波及しない (UI 側で note 明示)。
 */
export async function updateReward(
	rewardId: string,
	childId: ChildId,
	data: UpdateRewardInput,
	tenantId: string,
): Promise<SpecialRewardResult | { error: 'NOT_FOUND'; target: string }> {
	// 所有権検証: 指定 child に紐付く reward であること (IDOR 防御、requestRedemption と同型)
	const rewards = await findSpecialRewards(childId, tenantId);
	const existing = rewards.find((r) => r.id === rewardId);
	if (!existing) return { error: 'NOT_FOUND', target: 'reward' };

	const updated = await updateSpecialReward(
		childId,
		rewardId,
		{
			title: data.title,
			points: data.points,
			icon: data.icon,
			category: data.category,
			// #3154: 編集時も陳列系統を変更可能にする (undefined なら既存値保全)。
			shopCategory: data.shopCategory,
		},
		tenantId,
	);
	if (!updated) return { error: 'NOT_FOUND', target: 'reward' };
	return toRewardResult(updated);
}

export type DeleteRewardResult =
	| { deleted: true }
	| { error: 'NOT_FOUND'; target: string }
	| { error: 'PENDING_REDEMPTION' };

/**
 * #2832 AC1: reward 削除。pending redemption が存在する場合は削除を拒否する
 * (`hasPendingByReward` ガード配線)。親は申請を承認/却下してから削除する。
 * 削除時は当該 reward の解決済交換申請履歴行も削除される (repo 層、FK 整合)。
 */
export async function deleteReward(
	rewardId: string,
	childId: ChildId,
	tenantId: string,
): Promise<DeleteRewardResult> {
	// 所有権検証: 指定 child に紐付く reward であること (IDOR 防御)
	const rewards = await findSpecialRewards(childId, tenantId);
	const existing = rewards.find((r) => r.id === rewardId);
	if (!existing) return { error: 'NOT_FOUND', target: 'reward' };

	// AC1: pending redemption ガード — 処理待ち申請があれば削除拒否
	if (await hasPendingByReward(rewardId, tenantId)) {
		return { error: 'PENDING_REDEMPTION' };
	}

	const deleted = await deleteSpecialReward(childId, rewardId, tenantId);
	if (!deleted) return { error: 'NOT_FOUND', target: 'reward' };

	// destructive 操作の audit log (irreversible 削除の証跡)
	logger.info('[special-reward-service] reward deleted', {
		context: { rewardId, childId, title: existing.title, points: existing.points },
	});
	return { deleted: true };
}

// --- 履歴取得 ---

export async function getChildSpecialRewards(
	childId: ChildId,
	tenantId: string,
): Promise<{
	rewards: SpecialRewardResult[];
	totalPoints: number;
}> {
	const rows = await findSpecialRewards(childId, tenantId);

	let totalPoints = 0;
	const rewards: SpecialRewardResult[] = rows
		// #4172 AC4: 旧自動生成行 (`${n}かいきろく達成！`) を棚から除外する。物理削除はしない
		// (履歴を壊すため)。本 filter が陳列除外の単一地点で、子供ショップ / 親の管理画面 /
		// 交換申請一覧のいずれも本関数を経由するため 3 backend 共通で同一挙動になる。
		.filter((r) => r.category !== AUTO_MILESTONE_CATEGORY)
		.map((r) => {
			totalPoints += r.points;
			return toRewardResult(r);
		});

	return { rewards, totalPoints };
}

// --- 未表示報酬取得 ---

export async function getUnshownReward(
	childId: ChildId,
	tenantId: string,
): Promise<SpecialRewardResult | null> {
	const row = await findUnshownReward(childId, tenantId);
	if (!row) return null;
	return toRewardResult(row);
}

// --- 報酬表示済みマーク ---

/** #2845 課題①: childId 所有権検証付き (composite key)。不一致なら false。 */
export async function markRewardShown(
	childId: ChildId,
	rewardId: string,
	tenantId: string,
): Promise<boolean> {
	const result = await markRewardShownRepo(childId, rewardId, tenantId);
	return !!result;
}

// --- テンプレート管理 ---

export async function getRewardTemplates(tenantId: string): Promise<RewardTemplate[]> {
	const json = await getSetting(TEMPLATES_KEY, tenantId);
	if (!json) return [];

	const parsed = v.safeParse(rewardTemplatesArraySchema, JSON.parse(json));
	if (!parsed.success) return [];

	return parsed.output;
}

export async function saveRewardTemplates(
	templates: RewardTemplate[],
	tenantId: string,
): Promise<void> {
	await setSetting(TEMPLATES_KEY, JSON.stringify(templates), tenantId);
}

// --- 固定間隔自動ごほうび (#4172 で撤去) ---

/**
 * 旧「固定間隔自動ごほうび」機構の間隔 (活動 N 回ごと)。**機構は #4172 で撤去済**。
 * 契約テストが「N 回記録しても棚が増えない」を組み立てるための発火条件として参照する。
 */
export const SPECIAL_REWARD_INTERVAL = 5;


