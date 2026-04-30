/**
 * Marketplace data loader — build-time bundled JSON for Lambda compatibility.
 * Aggregates all content types into a unified marketplace catalog.
 */

import type {
	MarketplaceItem,
	MarketplaceItemMeta,
	MarketplaceItemType,
} from '$lib/domain/marketplace-item';

// ── Activity Packs ──────────────────────────────────────────
import elementaryBoy from './activity-packs/elementary-boy.json';
import elementaryChallenge from './activity-packs/elementary-challenge.json';
import elementaryGirl from './activity-packs/elementary-girl.json';
import juniorBoy from './activity-packs/junior-boy.json';
import juniorGirl from './activity-packs/junior-girl.json';
import juniorHighChallenge from './activity-packs/junior-high-challenge.json';
import kinderBoy from './activity-packs/kinder-boy.json';
import kinderGirl from './activity-packs/kinder-girl.json';
import kinderStarter from './activity-packs/kinder-starter.json';
import seniorBoy from './activity-packs/senior-boy.json';
import seniorGirl from './activity-packs/senior-girl.json';
import seniorHighChallenge from './activity-packs/senior-high-challenge.json';
// ── Checklists ──────────────────────────────────────────────
// #1758 (#1709-D): morning/evening/weekend × 4 年齢 = 12 件削除（持ち物純化）
// 旧 routine 系 checklist は activities.priority='must'（#1755）に役割移管済み。
// 残るのは event-* 3 件（持ち物リスト用途）のみ。
import eventFieldTrip from './checklists/event-field-trip.json';
import eventPool from './checklists/event-pool.json';
import eventSchoolStart from './checklists/event-school-start.json';
// ── Reward Sets ─────────────────────────────────────────────
import creativeRewards from './reward-sets/creative-rewards.json';
import elementaryRewards from './reward-sets/elementary-rewards.json';
import experienceRewards from './reward-sets/experience-rewards.json';
import foodRewards from './reward-sets/food-rewards.json';
import juniorRewards from './reward-sets/junior-rewards.json';
import kinderRewards from './reward-sets/kinder-rewards.json';
import privilegeRewards from './reward-sets/privilege-rewards.json';
import screenTimeRewards from './reward-sets/screen-time-rewards.json';
import seniorRewards from './reward-sets/senior-rewards.json';
import toddlerRewards from './reward-sets/toddler-rewards.json';

// ── Rule Presets ────────────────────────────────────────────
import categoryChallenge from './rule-presets/category-challenge.json';
import choreSkip from './rule-presets/chore-skip.json';
import earlyBird from './rule-presets/early-bird.json';
import nightOwlPass from './rule-presets/night-owl-pass.json';
import screenTimeExchange from './rule-presets/screen-time-exchange.json';
import selfStudyReward from './rule-presets/self-study-reward.json';
import siblingCoop from './rule-presets/sibling-coop.json';
import sleepInPass from './rule-presets/sleep-in-pass.json';
import streakBonus from './rule-presets/streak-bonus.json';
import weekendSpecial from './rule-presets/weekend-special.json';

// ── Build item map ──────────────────────────────────────────

const allItems: MarketplaceItem[] = [
	// Activity packs (12 items: 4 neutral defaults + 8 gender variants; baby削除 #1301)
	kinderStarter,
	kinderBoy,
	kinderGirl,
	elementaryChallenge,
	elementaryBoy,
	elementaryGirl,
	juniorHighChallenge,
	juniorBoy,
	juniorGirl,
	seniorHighChallenge,
	seniorBoy,
	seniorGirl,
	// Reward sets
	toddlerRewards,
	kinderRewards,
	elementaryRewards,
	juniorRewards,
	seniorRewards,
	experienceRewards,
	screenTimeRewards,
	creativeRewards,
	foodRewards,
	privilegeRewards,
	// Checklists（#1758: routine 系 12 件削除済 → event-* 3 件のみ）
	eventSchoolStart,
	eventPool,
	eventFieldTrip,
	// Rule presets
	nightOwlPass,
	sleepInPass,
	choreSkip,
	streakBonus,
	categoryChallenge,
	earlyBird,
	screenTimeExchange,
	siblingCoop,
	weekendSpecial,
	selfStudyReward,
] as unknown as MarketplaceItem[];

const itemMap = new Map<string, MarketplaceItem>();
for (const item of allItems) {
	itemMap.set(`${item.type}/${item.itemId}`, item);
}

// ── Public API ───────────────────────────────────────────────

function countPayloadItems(item: MarketplaceItem): number {
	const p = item.payload as unknown as Record<string, unknown>;
	if ('activities' in p) return (p.activities as unknown[]).length;
	if ('rewards' in p) return (p.rewards as unknown[]).length;
	if ('items' in p) return (p.items as unknown[]).length;
	if ('rules' in p) return (p.rules as unknown[]).length;
	return 0;
}

function toMeta(item: MarketplaceItem): MarketplaceItemMeta {
	return {
		type: item.type,
		itemId: item.itemId,
		name: item.name,
		description: item.description,
		icon: item.icon,
		targetAgeMin: item.targetAgeMin,
		targetAgeMax: item.targetAgeMax,
		tags: item.tags,
		personas: item.personas,
		gender: item.gender ?? 'neutral',
		curator: item.curator,
		itemCount: countPayloadItems(item),
	};
}

/** Get all marketplace item metadata (no payloads) */
export function getMarketplaceIndex(): MarketplaceItemMeta[] {
	return allItems.map(toMeta);
}

/** Get a single item with full payload */
export function getMarketplaceItem(
	type: MarketplaceItemType,
	itemId: string,
): MarketplaceItem | null {
	return itemMap.get(`${type}/${itemId}`) ?? null;
}

/** Get all unique tags across all items */
export function getAllTags(): string[] {
	const tags = new Set<string>();
	for (const item of allItems) {
		for (const tag of item.tags) {
			tags.add(tag);
		}
	}
	return [...tags].sort();
}

/** Count items by type */
export function getMarketplaceCounts(): Record<MarketplaceItemType, number> {
	const counts: Record<MarketplaceItemType, number> = {
		'activity-pack': 0,
		'reward-set': 0,
		checklist: 0,
		'rule-preset': 0,
	};
	for (const item of allItems) {
		counts[item.type]++;
	}
	return counts;
}
