import type { RewardCategory } from '$lib/domain/validation/special-reward';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { countActiveActivityLogs } from '$lib/server/db/activity-repo';
import { findChildById, insertPointEntry } from '$lib/server/db/point-repo';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import {
	findSpecialRewards,
	findUnshownReward,
	insertSpecialReward,
	markRewardShown as markRewardShownRepo,
} from '$lib/server/db/special-reward-repo';

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

// --- 特別報酬付与 ---

export async function grantSpecialReward(
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

	return {
		id: reward.id,
		childId: reward.childId,
		title: reward.title,
		description: reward.description,
		points: reward.points,
		icon: reward.icon,
		category: reward.category,
		grantedAt: reward.grantedAt,
	};
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
		return {
			id: r.id,
			childId: r.childId,
			title: r.title,
			description: r.description,
			points: r.points,
			icon: r.icon,
			category: r.category,
			grantedAt: r.grantedAt,
		};
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

// --- 報酬表示済みマーク ---

export async function markRewardShown(rewardId: number, tenantId: string): Promise<boolean> {
	const result = await markRewardShownRepo(rewardId, tenantId);
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

	return {
		id: reward.id,
		childId: reward.childId,
		title: reward.title,
		description: reward.description,
		points: reward.points,
		icon: reward.icon,
		category: reward.category,
		grantedAt: reward.grantedAt,
	};
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
