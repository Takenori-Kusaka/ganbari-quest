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
import babyFirst from './activity-packs/baby-first.json';
import creativeArtist from './activity-packs/creative-artist.json';
import elementaryChallenge from './activity-packs/elementary-challenge.json';
import examPrep from './activity-packs/exam-prep.json';
import juniorHighChallenge from './activity-packs/junior-high-challenge.json';
import kinderStarter from './activity-packs/kinder-starter.json';
import lifeSkillsBaby from './activity-packs/life-skills-baby.json';
import otetsudaiMaster from './activity-packs/otetsudai-master.json';
import outdoorExplorer from './activity-packs/outdoor-explorer.json';
import seniorHighChallenge from './activity-packs/senior-high-challenge.json';
import socialButterfly from './activity-packs/social-butterfly.json';
import sportsHero from './activity-packs/sports-hero.json';
import studyMaster from './activity-packs/study-master.json';
import weekendFun from './activity-packs/weekend-fun.json';
// ── Checklists ──────────────────────────────────────────────
import eveningBaby from './checklists/evening-baby.json';
import eveningElementary from './checklists/evening-elementary.json';
import eveningJunior from './checklists/evening-junior.json';
import eveningKinder from './checklists/evening-kinder.json';
import eveningSenior from './checklists/evening-senior.json';
import morningBaby from './checklists/morning-baby.json';
import morningElementary from './checklists/morning-elementary.json';
import morningJunior from './checklists/morning-junior.json';
import morningKinder from './checklists/morning-kinder.json';
import morningSenior from './checklists/morning-senior.json';
import weekendBaby from './checklists/weekend-baby.json';
import weekendElementary from './checklists/weekend-elementary.json';
import weekendJunior from './checklists/weekend-junior.json';
import weekendKinder from './checklists/weekend-kinder.json';
import weekendSenior from './checklists/weekend-senior.json';
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
	// Activity packs
	babyFirst,
	kinderStarter,
	elementaryChallenge,
	otetsudaiMaster,
	juniorHighChallenge,
	seniorHighChallenge,
	sportsHero,
	studyMaster,
	creativeArtist,
	socialButterfly,
	outdoorExplorer,
	lifeSkillsBaby,
	examPrep,
	weekendFun,
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
	// Checklists
	morningBaby,
	morningKinder,
	morningElementary,
	morningJunior,
	morningSenior,
	eveningBaby,
	eveningKinder,
	eveningElementary,
	eveningJunior,
	eveningSenior,
	weekendBaby,
	weekendKinder,
	weekendElementary,
	weekendJunior,
	weekendSenior,
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
	if ('legacyPackId' in p) return 0; // legacy wrapper, count resolved at runtime
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
		curator: item.curator,
		itemCount: countPayloadItems(item),
	};
}

/** Get all marketplace item metadata (no payloads) */
export function getMarketplaceIndex(): MarketplaceItemMeta[] {
	return allItems.map(toMeta);
}

/** Get items filtered by type */
export function getMarketplaceByType(type: MarketplaceItemType): MarketplaceItemMeta[] {
	return allItems.filter((i) => i.type === type).map(toMeta);
}

/** Get items matching age range */
export function getMarketplaceByAge(age: number): MarketplaceItemMeta[] {
	return allItems.filter((i) => i.targetAgeMin <= age && i.targetAgeMax >= age).map(toMeta);
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
