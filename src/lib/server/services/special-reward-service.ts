import type { RewardCategory } from '$lib/domain/validation/special-reward';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { countActiveActivityLogs } from '$lib/server/db/activity-repo';
import { findChildById, insertPointEntry } from '$lib/server/db/point-repo';
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

/** 固定間隔: N回の活動記録ごとに特別報酬を自動付与 */
export const SPECIAL_REWARD_INTERVAL = 5;

/** 自動付与報酬のポイント */
const AUTO_REWARD_POINTS = 50;

/** 自動付与報酬のカテゴリ（自動付与を識別するマーカー） */
const AUTO_REWARD_CATEGORY = 'auto_milestone';

// --- 型定義 ---

export interface SpecialRewardResult {
	id: number;
	childId: number;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
}

/** 特別報酬の進捗情報（UI表示用） */
export interface SpecialRewardProgress {
	/** 累計活動記録数 */
	totalRecords: number;
	/** 次の報酬までの間隔 */
	interval: number;
	/** 次の報酬まであと何回 */
	remaining: number;
}

export interface RewardTemplate {
	title: string;
	points: number;
	icon?: string;
	category: RewardCategory;
}

interface GrantInput {
	childId: number;
	grantedBy?: number | null;
	title: string;
	description?: string;
	points: number;
	icon?: string;
	category: string;
}

const TEMPLATES_KEY = 'reward_templates';

// --- DB行 → SpecialRewardResult マッピング ---

/** DB の報酬レコードを SpecialRewardResult にマッピング */
function toRewardResult(row: {
	id: number;
	childId: number;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
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
	};
}

// --- ごほうび追加 (#2268: grantSpecialReward → addReward リネーム) ---
// 旧名 `grantSpecialReward` は「P 付与」を示唆していたが、実態は special_rewards INSERT
// (子供 shop に並べる商品の追加) + points 加算。命名訂正のため `addReward` に rename。
// 旧名は後方互換 alias で維持（#2268 影響範囲拡散防止、別 Issue で削除予定）。

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
		},
		tenantId,
	);

	await insertPointEntry(
		{
			childId: data.childId,
			amount: data.points,
			type: 'special_reward',
			description: data.title,
			referenceId: reward.id,
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
}

/**
 * #2832 AC2 (案 b): reward 編集。pending redemption が存在しても編集を許容する。
 * 申請済みの交換は申請時点 snapshot (redemption insert 時に保存した reward title/points)
 * で表示・控除されるため、編集は処理待ちの申請に波及しない (UI 側で note 明示)。
 */
export async function updateReward(
	rewardId: number,
	childId: number,
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
	rewardId: number,
	childId: number,
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
	childId: number,
	tenantId: string,
): Promise<{
	rewards: SpecialRewardResult[];
	totalPoints: number;
}> {
	const rows = await findSpecialRewards(childId, tenantId);

	let totalPoints = 0;
	const rewards: SpecialRewardResult[] = rows.map((r) => {
		totalPoints += r.points;
		return toRewardResult(r);
	});

	return { rewards, totalPoints };
}

// --- 未表示報酬取得 ---

export async function getUnshownReward(
	childId: number,
	tenantId: string,
): Promise<SpecialRewardResult | null> {
	const row = await findUnshownReward(childId, tenantId);
	if (!row) return null;
	return toRewardResult(row);
}

// --- 報酬表示済みマーク ---

/** #2845 課題①: childId 所有権検証付き (composite key)。不一致なら false。 */
export async function markRewardShown(
	childId: number,
	rewardId: number,
	tenantId: string,
): Promise<boolean> {
	const result = await markRewardShownRepo(childId, rewardId, tenantId);
	return !!result;
}

// --- テンプレート管理 ---

export async function getRewardTemplates(tenantId: string): Promise<RewardTemplate[]> {
	const json = await getSetting(TEMPLATES_KEY, tenantId);
	if (!json) return [];

	const parsed = rewardTemplatesArraySchema.safeParse(JSON.parse(json));
	if (!parsed.success) return [];

	return parsed.data;
}

export async function saveRewardTemplates(
	templates: RewardTemplate[],
	tenantId: string,
): Promise<void> {
	await setSetting(TEMPLATES_KEY, JSON.stringify(templates), tenantId);
}

// --- 固定間隔報酬（予告型） ---

/**
 * 活動記録後に呼ばれ、累計記録数がINTERVALの倍数に到達していたら自動付与する。
 * 変動比率（スロットマシン的ランダム）ではなく、子供が「あとN回」と予測できる固定間隔。
 */
export async function checkAndGrantFixedIntervalReward(
	childId: number,
	tenantId: string,
): Promise<SpecialRewardResult | null> {
	const totalRecords = await countActiveActivityLogs(childId, tenantId);

	// INTERVAL の倍数でなければ報酬なし
	if (totalRecords === 0 || totalRecords % SPECIAL_REWARD_INTERVAL !== 0) {
		return null;
	}

	const child = await findChildById(childId, tenantId);
	if (!child) return null;

	const title = `${totalRecords}かいきろく達成！`;

	const reward = await insertSpecialReward(
		{
			childId,
			grantedBy: null,
			title,
			description: `${totalRecords}回の活動記録達成のごほうび`,
			points: AUTO_REWARD_POINTS,
			icon: '🎁',
			category: AUTO_REWARD_CATEGORY,
		},
		tenantId,
	);

	await insertPointEntry(
		{
			childId,
			amount: AUTO_REWARD_POINTS,
			type: 'special_reward',
			description: title,
			referenceId: reward.id,
		},
		tenantId,
	);

	return toRewardResult(reward);
}

/**
 * 子供の特別報酬進捗を取得する（UI表示用: 「あとN回でとくべつごほうび！」）
 */
export async function getSpecialRewardProgress(
	childId: number,
	tenantId: string,
): Promise<SpecialRewardProgress> {
	const totalRecords = await countActiveActivityLogs(childId, tenantId);
	const remaining = SPECIAL_REWARD_INTERVAL - (totalRecords % SPECIAL_REWARD_INTERVAL);

	return {
		totalRecords,
		interval: SPECIAL_REWARD_INTERVAL,
		// ちょうど倍数の場合は remaining = INTERVAL ではなく 0 を返す
		// ただし recordActivity → checkAndGrant の後に呼ばれるため、通常は 1-4 が返る
		remaining: remaining === SPECIAL_REWARD_INTERVAL ? 0 : remaining,
	};
}
