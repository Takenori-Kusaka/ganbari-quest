// Activity pack data loader — ビルド時バンドルで Lambda 環境でも動作する
// (#0287: readFile → import に変更)

import type { ActivityPack, ActivityPackIndex } from '$lib/domain/activity-pack';

import babyFirst from './baby-first.json';
import elementaryChallenge from './elementary-challenge.json';
import indexData from './index.json';
import kinderStarter from './kinder-starter.json';
import otetsudaiMaster from './otetsudai-master.json';

export const activityPackIndex: ActivityPackIndex = indexData as ActivityPackIndex;

const packMap: Record<string, ActivityPack> = {
	'baby-first': babyFirst as unknown as ActivityPack,
	'kinder-starter': kinderStarter as unknown as ActivityPack,
	'elementary-challenge': elementaryChallenge as unknown as ActivityPack,
	'otetsudai-master': otetsudaiMaster as unknown as ActivityPack,
};

export function getActivityPack(packId: string): ActivityPack | null {
	return packMap[packId] ?? null;
}

export function getActivityPackIds(): string[] {
	return Object.keys(packMap);
}
