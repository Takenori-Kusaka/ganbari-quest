import { todayDateJST, toJSTDateString } from '$lib/domain/date-utils';
import { DEMO_CHILDREN } from '$lib/server/demo/demo-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = todayDateJST();
	const weekEnd = toJSTDateString(new Date(Date.now() + 6 * 86400000));

	// biome-ignore lint/style/noNonNullAssertion: demo data — indices are guaranteed
	const child1 = DEMO_CHILDREN[1]!; // たろう (5歳)
	// biome-ignore lint/style/noNonNullAssertion: demo data — indices are guaranteed
	const child2 = DEMO_CHILDREN[2]!; // さくら (8歳)

	const challenges = [
		{
			id: 1,
			title: 'みんなで今週3回うんどう！',
			description: '家族みんなでうんどうしよう',
			challengeType: 'cooperative',
			periodType: 'weekly',
			startDate: today,
			endDate: weekEnd,
			targetConfig: '{"metric":"count","baseTarget":3,"categoryId":1}',
			rewardConfig: '{"points":100,"message":"みんなすごい！チームワークばっちり！"}',
			status: 'active',
			isActive: 1,
			createdAt: today,
			updatedAt: today,
			progress: [
				{
					id: 1,
					challengeId: 1,
					childId: child1.id,
					currentValue: 2,
					targetValue: 3,
					completed: 0,
					completedAt: null,
					rewardClaimed: 0,
					rewardClaimedAt: null,
					progressJson: null,
					updatedAt: today,
				},
				{
					id: 2,
					challengeId: 1,
					childId: child2.id,
					currentValue: 3,
					targetValue: 3,
					completed: 1,
					completedAt: today,
					rewardClaimed: 0,
					rewardClaimedAt: null,
					progressJson: null,
					updatedAt: today,
				},
			],
			allCompleted: false,
		},
		{
			id: 2,
			title: 'あわせて20かい記録しよう！',
			description: 'みんなの合計記録が20回に到達しよう',
			challengeType: 'cooperative',
			periodType: 'monthly',
			startDate: today,
			endDate: weekEnd,
			targetConfig: '{"metric":"count","baseTarget":10}',
			rewardConfig: '{"points":200,"message":"かぞくのチカラ！"}',
			status: 'completed',
			isActive: 1,
			createdAt: today,
			updatedAt: today,
			progress: [
				{
					id: 3,
					challengeId: 2,
					childId: child1.id,
					currentValue: 10,
					targetValue: 10,
					completed: 1,
					completedAt: today,
					rewardClaimed: 1,
					rewardClaimedAt: today,
					progressJson: null,
					updatedAt: today,
				},
				{
					id: 4,
					challengeId: 2,
					childId: child2.id,
					currentValue: 10,
					targetValue: 10,
					completed: 1,
					completedAt: today,
					rewardClaimed: 0,
					rewardClaimedAt: null,
					progressJson: null,
					updatedAt: today,
				},
			],
			allCompleted: true,
		},
	];

	const children = [
		{ id: child1.id, nickname: child1.nickname, age: child1.age },
		{ id: child2.id, nickname: child2.nickname, age: child2.age },
	];

	return { challenges, children };
};
