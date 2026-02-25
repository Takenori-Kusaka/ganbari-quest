import type { RewardCategory } from '$lib/domain/validation/special-reward';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { findChildById, insertPointEntry } from '$lib/server/db/point-repo';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';

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

export function grantSpecialReward(
	data: GrantInput,
): SpecialRewardResult | { error: 'NOT_FOUND'; target: string } {
	const child = findChildById(data.childId);
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	const reward = insertSpecialReward({
		childId: data.childId,
		grantedBy: data.grantedBy ?? null,
		title: data.title,
		description: data.description,
		points: data.points,
		icon: data.icon,
		category: data.category,
	});

	insertPointEntry({
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

export function getChildSpecialRewards(childId: number): {
	rewards: SpecialRewardResult[];
	totalPoints: number;
} {
	const rows = findSpecialRewards(childId);

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

// --- テンプレート管理 ---

export function getRewardTemplates(): RewardTemplate[] {
	const json = getSetting(TEMPLATES_KEY);
	if (!json) return [];

	const parsed = rewardTemplatesArraySchema.safeParse(JSON.parse(json));
	if (!parsed.success) return [];

	return parsed.data;
}

export function saveRewardTemplates(templates: RewardTemplate[]): void {
	setSetting(TEMPLATES_KEY, JSON.stringify(templates));
}
