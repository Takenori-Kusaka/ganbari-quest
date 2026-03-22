import type { RewardCategory } from '$lib/domain/validation/special-reward';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { findChildById, insertPointEntry } from '$lib/server/db/point-repo';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import {
	findSpecialRewards,
	findUnshownReward,
	insertSpecialReward,
	markRewardShown as markRewardShownRepo,
} from '$lib/server/db/special-reward-repo';

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
): Promise<SpecialRewardResult | { error: 'NOT_FOUND'; target: string }> {
	const child = await findChildById(data.childId);
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	const reward = await insertSpecialReward({
		childId: data.childId,
		grantedBy: data.grantedBy ?? null,
		title: data.title,
		description: data.description,
		points: data.points,
		icon: data.icon,
		category: data.category,
	});

	await insertPointEntry({
		childId: data.childId,
		amount: data.points,
		type: 'special_reward',
		description: data.title,
		referenceId: reward.id,
	});

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

export async function getChildSpecialRewards(childId: number): Promise<{
	rewards: SpecialRewardResult[];
	totalPoints: number;
}> {
	const rows = await findSpecialRewards(childId);

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

export async function getUnshownReward(childId: number): Promise<SpecialRewardResult | null> {
	const row = await findUnshownReward(childId);
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

export async function markRewardShown(rewardId: number): Promise<boolean> {
	const result = await markRewardShownRepo(rewardId);
	return !!result;
}

// --- テンプレート管理 ---

export async function getRewardTemplates(): Promise<RewardTemplate[]> {
	const json = await getSetting(TEMPLATES_KEY);
	if (!json) return [];

	const parsed = rewardTemplatesArraySchema.safeParse(JSON.parse(json));
	if (!parsed.success) return [];

	return parsed.data;
}

export async function saveRewardTemplates(templates: RewardTemplate[]): Promise<void> {
	await setSetting(TEMPLATES_KEY, JSON.stringify(templates));
}
