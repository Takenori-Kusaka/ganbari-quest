import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
	const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

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
					childId: 1,
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
					childId: 2,
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
			title: 'べんきょう10かいチャレンジ',
			description: 'みんなの合計が10回になったらクリア',
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
					childId: 1,
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
					childId: 2,
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
		{ id: 1, nickname: 'ゆいちゃん', age: 5 },
		{ id: 2, nickname: 'けんくん', age: 8 },
	];

	return { challenges, children };
};
