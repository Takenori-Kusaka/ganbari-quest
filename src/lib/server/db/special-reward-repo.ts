import { db } from '$lib/server/db';
import { specialRewards } from '$lib/server/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';

/** 特別報酬を記録 */
export function insertSpecialReward(input: {
	childId: number;
	grantedBy?: number | null;
	title: string;
	description?: string;
	points: number;
	icon?: string;
	category: string;
}) {
	return db.insert(specialRewards).values(input).returning().get();
}

/** 子供の特別報酬履歴を取得（降順） */
export function findSpecialRewards(childId: number) {
	return db
		.select()
		.from(specialRewards)
		.where(eq(specialRewards.childId, childId))
		.orderBy(desc(specialRewards.grantedAt))
		.all();
}

/** 子供の未表示の特別報酬を1件取得 */
export function findUnshownReward(childId: number) {
	return db
		.select()
		.from(specialRewards)
		.where(and(eq(specialRewards.childId, childId), isNull(specialRewards.shownAt)))
		.orderBy(desc(specialRewards.grantedAt))
		.limit(1)
		.get();
}

/** 特別報酬を表示済みにする */
export function markRewardShown(rewardId: number) {
	return db
		.update(specialRewards)
		.set({ shownAt: new Date().toISOString() })
		.where(eq(specialRewards.id, rewardId))
		.returning()
		.get();
}
