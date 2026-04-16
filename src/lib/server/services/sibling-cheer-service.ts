// src/lib/server/services/sibling-cheer-service.ts
// きょうだい間おうえんスタンプ

import { findAllChildren } from '$lib/server/db/child-repo';
import {
	countTodayCheersFrom,
	findUnshownCheers,
	insertCheer,
	markShown,
} from '$lib/server/db/sibling-cheer-repo';
import type { SiblingCheer } from '$lib/server/db/types';

/** 定型スタンプ6種（テキスト入力なし = 安全） */
export const CHEER_STAMPS = [
	{ code: 'ganbare', label: 'がんばって！', emoji: '💪' },
	{ code: 'sugoi', label: 'すごいね！', emoji: '⭐' },
	{ code: 'issho', label: 'いっしょにがんばろう！', emoji: '🤝' },
	{ code: 'omedeto', label: 'おめでとう！', emoji: '🎉' },
	{ code: 'nice', label: 'ナイス！', emoji: '👍' },
	{ code: 'fight', label: 'ファイト！', emoji: '🔥' },
] as const;

export type CheerStampCode = (typeof CHEER_STAMPS)[number]['code'];

const MAX_DAILY_CHEERS = 5;

export function getStampByCode(code: string) {
	return CHEER_STAMPS.find((s) => s.code === code) ?? null;
}

/** おうえんスタンプ送信 */
export async function sendCheer(
	fromChildId: number,
	toChildId: number,
	stampCode: string,
	tenantId: string,
): Promise<{ success: true; cheer: SiblingCheer } | { error: string }> {
	// 自分への送信禁止
	if (fromChildId === toChildId) {
		return { error: 'じぶんにはおくれないよ' };
	}

	// スタンプコード検証
	if (!getStampByCode(stampCode)) {
		return { error: 'スタンプがみつかりません' };
	}

	// 1日の送信上限チェック
	const todayCount = await countTodayCheersFrom(fromChildId, tenantId);
	if (todayCount >= MAX_DAILY_CHEERS) {
		return { error: `きょうはもう${MAX_DAILY_CHEERS}かいおくったよ！あしたまたおくろうね` };
	}

	const cheer = await insertCheer({ fromChildId, toChildId, stampCode }, tenantId);
	return { success: true, cheer };
}

/** 未表示のおうえんを取得 */
export async function getUnshownCheers(
	childId: number,
	tenantId: string,
): Promise<(SiblingCheer & { stampLabel: string; stampEmoji: string; fromName: string })[]> {
	const cheers = await findUnshownCheers(childId, tenantId);
	if (cheers.length === 0) return [];

	const children = await findAllChildren(tenantId);
	const childMap = new Map(children.map((c) => [c.id, c.nickname]));

	return cheers.map((c) => {
		const stamp = getStampByCode(c.stampCode);
		return {
			...c,
			stampLabel: stamp?.label ?? c.stampCode,
			stampEmoji: stamp?.emoji ?? '💌',
			fromName: childMap.get(c.fromChildId) ?? `#${c.fromChildId}`,
		};
	});
}

/** おうえんを既読にする */
export async function markCheersShown(cheerIds: number[], tenantId: string): Promise<void> {
	await markShown(cheerIds, tenantId);
}

/** きょうだい一覧（自分以外）を取得 — スタンプ送信先選択用 */
async function getSiblingList(
	childId: number,
	tenantId: string,
): Promise<{ id: number; nickname: string }[]> {
	const children = await findAllChildren(tenantId);
	return children.filter((c) => c.id !== childId).map((c) => ({ id: c.id, nickname: c.nickname }));
}
