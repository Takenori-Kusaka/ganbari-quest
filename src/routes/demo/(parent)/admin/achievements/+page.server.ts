import { todayDateJST, toJSTDateString } from '$lib/domain/date-utils';
import { DEMO_CHILDREN } from '$lib/server/demo/demo-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = todayDateJST();
	const weekAgo = toJSTDateString(new Date(Date.now() - 7 * 86400000));
	const twoWeeksAgo = toJSTDateString(new Date(Date.now() - 14 * 86400000));

	// biome-ignore lint/style/noNonNullAssertion: demo data — indices are guaranteed
	const child1 = DEMO_CHILDREN[1]!; // たろう (5歳)
	// biome-ignore lint/style/noNonNullAssertion: demo data — indices are guaranteed
	const child2 = DEMO_CHILDREN[2]!; // さくら (8歳)

	const challenges = [
		{
			id: 101,
			title: 'みんなで今週5かいうんどう！',
			description: '家族みんなでうんどう週間チャレンジ',
			challengeType: 'cooperative',
			periodType: 'weekly',
			startDate: weekAgo,
			endDate: today,
			targetConfig: '{"metric":"count","baseTarget":5,"categoryId":1}',
			rewardConfig: '{"points":150,"message":"チームワークばっちり！"}',
			status: 'completed',
			isActive: 0,
			createdAt: weekAgo,
			updatedAt: today,
			progress: [
				{
					id: 101,
					challengeId: 101,
					childId: child1.id,
					currentValue: 5,
					targetValue: 5,
					completed: 1,
					completedAt: today,
					rewardClaimed: 1,
					rewardClaimedAt: today,
					progressJson: null,
					updatedAt: today,
				},
				{
					id: 102,
					challengeId: 101,
					childId: child2.id,
					currentValue: 5,
					targetValue: 5,
					completed: 1,
					completedAt: today,
					rewardClaimed: 1,
					rewardClaimedAt: today,
					progressJson: null,
					updatedAt: today,
				},
			],
			allCompleted: true,
		},
		{
			id: 102,
			title: 'べんきょう5かいチャレンジ',
			description: 'みんなでべんきょう5回をめざそう',
			challengeType: 'cooperative',
			periodType: 'monthly',
			startDate: twoWeeksAgo,
			endDate: weekAgo,
			targetConfig: '{"metric":"count","baseTarget":5,"categoryId":2}',
			rewardConfig: '{"points":200,"message":"がんばったね！"}',
			status: 'completed',
			isActive: 0,
			createdAt: twoWeeksAgo,
			updatedAt: weekAgo,
			progress: [
				{
					id: 103,
					challengeId: 102,
					childId: child1.id,
					currentValue: 5,
					targetValue: 5,
					completed: 1,
					completedAt: weekAgo,
					rewardClaimed: 1,
					rewardClaimedAt: weekAgo,
					progressJson: null,
					updatedAt: weekAgo,
				},
				{
					id: 104,
					challengeId: 102,
					childId: child2.id,
					currentValue: 5,
					targetValue: 5,
					completed: 1,
					completedAt: weekAgo,
					rewardClaimed: 0,
					rewardClaimedAt: null,
					progressJson: null,
					updatedAt: weekAgo,
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
