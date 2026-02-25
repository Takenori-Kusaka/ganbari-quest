import { db } from '$lib/server/db';
import { specialRewards } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

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
