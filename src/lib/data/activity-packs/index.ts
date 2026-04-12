// Activity pack data loader — ビルド時バンドルで Lambda 環境でも動作する
// (#0287: readFile → import に変更)

import type { ActivityPack, ActivityPackIndex } from '$lib/domain/activity-pack';

import babyBoy from './baby-boy.json';
import babyFirst from './baby-first.json';
import babyGirl from './baby-girl.json';
import elementaryBoy from './elementary-boy.json';
import elementaryChallenge from './elementary-challenge.json';
import elementaryGirl from './elementary-girl.json';
import indexData from './index.json';
import juniorBoy from './junior-boy.json';
import juniorGirl from './junior-girl.json';
import juniorHighChallenge from './junior-high-challenge.json';
import kinderBoy from './kinder-boy.json';
import kinderGirl from './kinder-girl.json';
import kinderStarter from './kinder-starter.json';
import otetsudaiMaster from './otetsudai-master.json';
import seniorBoy from './senior-boy.json';
import seniorGirl from './senior-girl.json';
import seniorHighChallenge from './senior-high-challenge.json';

export const activityPackIndex: ActivityPackIndex = indexData as ActivityPackIndex;

const packMap: Record<string, ActivityPack> = {
	'baby-first': babyFirst as unknown as ActivityPack,
	'baby-boy': babyBoy as unknown as ActivityPack,
	'baby-girl': babyGirl as unknown as ActivityPack,
	'kinder-starter': kinderStarter as unknown as ActivityPack,
	'kinder-boy': kinderBoy as unknown as ActivityPack,
	'kinder-girl': kinderGirl as unknown as ActivityPack,
	'elementary-challenge': elementaryChallenge as unknown as ActivityPack,
	'elementary-boy': elementaryBoy as unknown as ActivityPack,
	'elementary-girl': elementaryGirl as unknown as ActivityPack,
	'otetsudai-master': otetsudaiMaster as unknown as ActivityPack,
	'junior-high-challenge': juniorHighChallenge as unknown as ActivityPack,
	'junior-boy': juniorBoy as unknown as ActivityPack,
	'junior-girl': juniorGirl as unknown as ActivityPack,
	'senior-high-challenge': seniorHighChallenge as unknown as ActivityPack,
	'senior-boy': seniorBoy as unknown as ActivityPack,
	'senior-girl': seniorGirl as unknown as ActivityPack,
};

export function getActivityPack(packId: string): ActivityPack | null {
	return packMap[packId] ?? null;
}

export function getActivityPackIds(): string[] {
	return Object.keys(packMap);
}
