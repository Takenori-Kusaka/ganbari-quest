import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../client';
import { specialRewards } from '../schema';

/** 特別報酬を記録 */
export async function insertSpecialReward(
	input: {
		childId: number;
		grantedBy?: number | null;
		title: string;
		description?: string;
		points: number;
		icon?: string;
		category: string;
	},
	_tenantId: string,
) {
	return db.insert(specialRewards).values(input).returning().get();
}

/** 子供の特別報酬履歴を取得（降順） */
export async function findSpecialRewards(childId: number, _tenantId: string) {
	return db
		.select()
		.from(specialRewards)
		.where(eq(specialRewards.childId, childId))
		.orderBy(desc(specialRewards.grantedAt))
		.all();
}

/** 子供の未表示の特別報酬を1件取得 */
export async function findUnshownReward(childId: number, _tenantId: string) {
	return db
		.select()
		.from(specialRewards)
		.where(and(eq(specialRewards.childId, childId), isNull(specialRewards.shownAt)))
		.orderBy(desc(specialRewards.grantedAt))
		.limit(1)
		.get();
}

/** 特別報酬を表示済みにする */
export async function markRewardShown(rewardId: number, _tenantId: string) {
	return db
		.update(specialRewards)
		.set({ shownAt: new Date().toISOString() })
		.where(eq(specialRewards.id, rewardId))
		.returning()
		.get();
}

/** テナントの全特別報酬を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(specialRewards).run();
}
