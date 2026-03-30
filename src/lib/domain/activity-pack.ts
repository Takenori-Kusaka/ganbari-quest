/**
 * Activity preset pack format definition.
 * Packs are stored as static JSON files under static/activity-packs/.
 */

import type { CategoryCode, GradeLevel } from './validation/activity.js';

export interface ActivityPackItem {
	name: string;
	nameKana?: string;
	nameKanji?: string;
	categoryCode: CategoryCode;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	gradeLevel: GradeLevel | null;
	triggerHint?: string;
	description?: string;
}

export interface ActivityPack {
	formatVersion: '1.0';
	packId: string;
	packName: string;
	description: string;
	icon: string;
	targetAgeMin: number;
	targetAgeMax: number;
	tags: string[];
	activities: ActivityPackItem[];
}

export interface ActivityPackMeta {
	packId: string;
	packName: string;
	description: string;
	icon: string;
	targetAgeMin: number;
	targetAgeMax: number;
	tags: string[];
	activityCount: number;
}

export interface ActivityPackIndex {
	formatVersion: '1.0';
	packs: ActivityPackMeta[];
}
