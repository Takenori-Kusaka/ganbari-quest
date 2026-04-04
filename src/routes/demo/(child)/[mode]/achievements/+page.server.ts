import { todayDateJST, toJSTDateString } from '$lib/domain/date-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = todayDateJST();
	const weekAgo = toJSTDateString(new Date(Date.now() - 7 * 86400000));

	const challenges = [
		{
			id: 101,
			title: 'みんなで今週5かいうんどう！',
			description: '家族みんなでうんどう週間チャレンジ',
			challengeType: 'cooperative',
			periodType: 'weekly',
			startDate: weekAgo,
			endDate: today,
			status: 'completed',
			targetValue: 5,
			currentValue: 5,
			completed: true,
			rewardPoints: 150,
			rewardMessage: 'チームワークばっちり！',
		},
	];

	return { challenges };
};
