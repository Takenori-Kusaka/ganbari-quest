// src/lib/server/services/avatar-service.ts
// きせかえアバター サービス層

import type { AvatarCategory } from '$lib/domain/validation/avatar';
import {
	findAllAvatarItems,
	findAvatarItemById,
	findOwnedItems,
	getActiveAvatarIds,
	insertChildAvatarItem,
	isItemOwned,
	setActiveAvatar,
} from '$lib/server/db/avatar-repo';
import { getBalance, insertPointEntry } from '$lib/server/db/point-repo';
import { getChildStatus } from '$lib/server/services/status-service';

// --- 型定義 ---

export interface AvatarItemWithStatus {
	id: number;
	code: string;
	name: string;
	description: string | null;
	category: string;
	icon: string;
	cssValue: string;
	price: number;
	unlockType: string;
	unlockCondition: string | null;
	rarity: string;
	sortOrder: number;
	owned: boolean;
	equipped: boolean;
	canPurchase: boolean;
	locked: boolean;
	lockReason: string | null;
}

export interface AvatarConfig {
	bgCss: string;
	frameCss: string;
	effectClass: string;
}

// --- ショップ一覧 ---

/** 全アイテム（所持状態・装備状態・購入可否付き） */
export async function getShopItems(
	childId: number,
	tenantId: string,
): Promise<AvatarItemWithStatus[]> {
	const allItems = await findAllAvatarItems(tenantId);
	const owned = await findOwnedItems(childId, tenantId);
	const ownedSet = new Set(owned.map((o) => o.avatarItemId));
	const activeIds = await getActiveAvatarIds(childId, tenantId);
	const balance = await getBalance(childId, tenantId);

	// レベル取得（ロック判定用）
	const statusResult = await getChildStatus(childId, tenantId);
	const level = 'error' in statusResult ? 1 : statusResult.level;

	return allItems.map((item) => {
		const isOwned = ownedSet.has(item.id);
		const isEquipped =
			(item.category === 'background' && activeIds.bgId === item.id) ||
			(item.category === 'frame' && activeIds.frameId === item.id) ||
			(item.category === 'effect' && activeIds.effectId === item.id);

		const { locked, lockReason } = checkLockStatus(item, level);
		const canPurchase = !isOwned && !locked && item.price > 0 && balance >= item.price;

		return {
			id: item.id,
			code: item.code,
			name: item.name,
			description: item.description,
			category: item.category,
			icon: item.icon,
			cssValue: item.cssValue,
			price: item.price,
			unlockType: item.unlockType,
			unlockCondition: item.unlockCondition,
			rarity: item.rarity,
			sortOrder: item.sortOrder,
			owned: isOwned,
			equipped: isEquipped,
			canPurchase,
			locked,
			lockReason,
		};
	});
}

// --- 購入 ---

export async function purchaseItem(
	childId: number,
	itemId: number,
	tenantId: string,
): Promise<{ success: true } | { error: string }> {
	const item = await findAvatarItemById(itemId, tenantId);
	if (!item) return { error: 'NOT_FOUND' };
	if (await isItemOwned(childId, itemId, tenantId)) return { error: 'ALREADY_OWNED' };

	// ロックチェック
	const statusResult = await getChildStatus(childId, tenantId);
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const { locked } = checkLockStatus(item, level);
	if (locked) return { error: 'LOCKED' };

	// ポイントチェック
	if (item.price > 0) {
		const balance = await getBalance(childId, tenantId);
		if (balance < item.price) return { error: 'INSUFFICIENT_POINTS' };

		// ポイント消費
		await insertPointEntry(
			{
				childId,
				amount: -item.price,
				type: 'avatar_purchase',
				description: `きせかえ「${item.name}」を購入`,
			},
			tenantId,
		);
	}

	await insertChildAvatarItem(childId, itemId, tenantId);
	return { success: true };
}

// --- 装備 ---

export async function equipItem(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
	tenantId: string,
): Promise<{ success: true } | { error: string }> {
	if (itemId !== null) {
		if (!(await isItemOwned(childId, itemId, tenantId))) {
			return { error: 'NOT_OWNED' };
		}
		const item = await findAvatarItemById(itemId, tenantId);
		if (!item || item.category !== category) {
			return { error: 'CATEGORY_MISMATCH' };
		}
	}
	await setActiveAvatar(childId, category, itemId, tenantId);
	return { success: true };
}

// --- アバター設定取得 ---

/** 装備中アイテムのCSS値を返す */
export async function getAvatarConfig(childId: number, tenantId: string): Promise<AvatarConfig> {
	const activeIds = await getActiveAvatarIds(childId, tenantId);

	let bgCss = '#ffffff';
	let frameCss = '2px solid #bdbdbd';
	let effectClass = '';

	if (activeIds.bgId) {
		const item = await findAvatarItemById(activeIds.bgId, tenantId);
		if (item) bgCss = item.cssValue;
	}
	if (activeIds.frameId) {
		const item = await findAvatarItemById(activeIds.frameId, tenantId);
		if (item) frameCss = item.cssValue;
	}
	if (activeIds.effectId) {
		const item = await findAvatarItemById(activeIds.effectId, tenantId);
		if (item?.cssValue) effectClass = `avatar-effect-${item.cssValue}`;
	}

	return { bgCss, frameCss, effectClass };
}

// --- レベル/実績によるアイテム自動解放 ---

export async function checkAndUnlockItems(childId: number, tenantId: string): Promise<string[]> {
	const allItems = await findAllAvatarItems(tenantId);
	const statusResult = await getChildStatus(childId, tenantId);
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const newlyUnlocked: string[] = [];

	for (const item of allItems) {
		if (item.unlockType === 'free' && !(await isItemOwned(childId, item.id, tenantId))) {
			// 無料アイテムは自動付与
			await insertChildAvatarItem(childId, item.id, tenantId);
			continue;
		}
		if (item.unlockType !== 'level') continue;
		if (await isItemOwned(childId, item.id, tenantId)) continue;

		const condition = item.unlockCondition ? JSON.parse(item.unlockCondition) : null;
		if (condition?.level && level >= condition.level) {
			await insertChildAvatarItem(childId, item.id, tenantId);
			newlyUnlocked.push(item.name);
		}
	}

	return newlyUnlocked;
}

// --- 内部ヘルパー ---

function checkLockStatus(
	item: { unlockType: string; unlockCondition: string | null },
	currentLevel: number,
): { locked: boolean; lockReason: string | null } {
	if (item.unlockType === 'free' || item.unlockType === 'purchase') {
		return { locked: false, lockReason: null };
	}
	if (item.unlockType === 'level') {
		const condition = item.unlockCondition ? JSON.parse(item.unlockCondition) : null;
		if (condition?.level && currentLevel < condition.level) {
			return { locked: true, lockReason: `レベル${condition.level}で解放` };
		}
		return { locked: false, lockReason: null };
	}
	return { locked: true, lockReason: '特別な条件で解放' };
}
