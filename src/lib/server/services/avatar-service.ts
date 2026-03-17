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
export function getShopItems(childId: number): AvatarItemWithStatus[] {
	const allItems = findAllAvatarItems();
	const owned = findOwnedItems(childId);
	const ownedSet = new Set(owned.map((o) => o.avatarItemId));
	const activeIds = getActiveAvatarIds(childId);
	const balance = getBalance(childId);

	// レベル取得（ロック判定用）
	const statusResult = getChildStatus(childId);
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

export function purchaseItem(
	childId: number,
	itemId: number,
): { success: true } | { error: string } {
	const item = findAvatarItemById(itemId);
	if (!item) return { error: 'NOT_FOUND' };
	if (isItemOwned(childId, itemId)) return { error: 'ALREADY_OWNED' };

	// ロックチェック
	const statusResult = getChildStatus(childId);
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const { locked } = checkLockStatus(item, level);
	if (locked) return { error: 'LOCKED' };

	// ポイントチェック
	if (item.price > 0) {
		const balance = getBalance(childId);
		if (balance < item.price) return { error: 'INSUFFICIENT_POINTS' };

		// ポイント消費
		insertPointEntry({
			childId,
			amount: -item.price,
			type: 'avatar_purchase',
			description: `きせかえ「${item.name}」を購入`,
		});
	}

	insertChildAvatarItem(childId, itemId);
	return { success: true };
}

// --- 装備 ---

export function equipItem(
	childId: number,
	category: AvatarCategory,
	itemId: number | null,
): { success: true } | { error: string } {
	if (itemId !== null) {
		if (!isItemOwned(childId, itemId)) {
			return { error: 'NOT_OWNED' };
		}
		const item = findAvatarItemById(itemId);
		if (!item || item.category !== category) {
			return { error: 'CATEGORY_MISMATCH' };
		}
	}
	setActiveAvatar(childId, category, itemId);
	return { success: true };
}

// --- アバター設定取得 ---

/** 装備中アイテムのCSS値を返す */
export function getAvatarConfig(childId: number): AvatarConfig {
	const activeIds = getActiveAvatarIds(childId);

	let bgCss = '#ffffff';
	let frameCss = '2px solid #bdbdbd';
	let effectClass = '';

	if (activeIds.bgId) {
		const item = findAvatarItemById(activeIds.bgId);
		if (item) bgCss = item.cssValue;
	}
	if (activeIds.frameId) {
		const item = findAvatarItemById(activeIds.frameId);
		if (item) frameCss = item.cssValue;
	}
	if (activeIds.effectId) {
		const item = findAvatarItemById(activeIds.effectId);
		if (item?.cssValue) effectClass = `avatar-effect-${item.cssValue}`;
	}

	return { bgCss, frameCss, effectClass };
}

// --- レベル/実績によるアイテム自動解放 ---

export function checkAndUnlockItems(childId: number): string[] {
	const allItems = findAllAvatarItems();
	const statusResult = getChildStatus(childId);
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const newlyUnlocked: string[] = [];

	for (const item of allItems) {
		if (item.unlockType === 'free' && !isItemOwned(childId, item.id)) {
			// 無料アイテムは自動付与
			insertChildAvatarItem(childId, item.id);
			continue;
		}
		if (item.unlockType !== 'level') continue;
		if (isItemOwned(childId, item.id)) continue;

		const condition = item.unlockCondition ? JSON.parse(item.unlockCondition) : null;
		if (condition?.level && level >= condition.level) {
			insertChildAvatarItem(childId, item.id);
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
