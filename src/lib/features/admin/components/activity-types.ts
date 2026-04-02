/**
 * Shared types for admin activity management components.
 * These mirror the server-side Activity type but are safe for client-side use.
 */

export interface ActivityItem {
	id: number;
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	isVisible: number;
	dailyLimit: number | null;
	sortOrder: number;
	source: string;
	gradeLevel: string | null;
	subcategory: string | null;
	description: string | null;
	nameKana: string | null;
	nameKanji: string | null;
	triggerHint: string | null;
	createdAt: string;
}

export interface ActivityPackInfo {
	packId: string;
	packName: string;
	description: string;
	icon: string;
	targetAgeMin: number;
	targetAgeMax: number;
	tags: string[];
	activityCount: number;
}

export interface AiPreviewData {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	nameKana: string | null;
	nameKanji: string | null;
	source: string;
}

/** Category info with label, description, and icon candidates */
export interface CategoryInfo {
	label: string;
	desc: string;
	icons: string[];
}

/** Point guide entry */
export interface PointGuideEntry {
	points: number;
	label: string;
	desc: string;
	color: string;
}

/** Shared constants for activity forms */
export const CATEGORY_INFO: Record<string, CategoryInfo> = {
	うんどう: {
		label: 'うんどう',
		desc: '体を動かす活動（走る、泳ぐ、ボール遊びなど）',
		icons: ['🤸', '⚽', '🏃', '🏊', '🚴', '⚾', '🎾', '🏀', '🤾', '🧗', '🥋', '💃'],
	},
	べんきょう: {
		label: 'べんきょう',
		desc: '頭を使う活動（読書、計算、ひらがな練習など）',
		icons: ['📖', '✏️', '🔢', '📝', '🧮', '📚', '🔬', '🌍', '💡', '🎵', '🇦', '🗣️'],
	},
	せいかつ: {
		label: 'せいかつ',
		desc: '生活習慣（歯みがき、片付け、お手伝いなど）',
		icons: ['🪥', '🧹', '👕', '🍽️', '🛏️', '🧺', '🚿', '🌱', '🐕', '🗑️', '👟', '💊'],
	},
	こうりゅう: {
		label: 'こうりゅう',
		desc: '人との関わり（あいさつ、お友達と遊ぶなど）',
		icons: ['🤝', '👋', '💬', '🎉', '👫', '🤗', '📱', '✉️', '🎭', '🙏', '🫂', '👨‍👩‍👧'],
	},
	そうぞう: {
		label: 'そうぞう',
		desc: '創造的活動（お絵描き、工作、音楽など）',
		icons: ['🎨', '✂️', '🎹', '🎸', '📷', '🏗️', '🧩', '🎤', '🖍️', '🎲', '📐', '🪡'],
	},
};

export const POINT_GUIDE: PointGuideEntry[] = [
	{
		points: 3,
		label: 'かんたん',
		desc: '毎日できること（あいさつ、歯みがきなど）',
		color: 'bg-green-100 text-green-700',
	},
	{
		points: 5,
		label: 'ふつう',
		desc: 'ちょっとがんばること（お手伝い、読書など）',
		color: 'bg-blue-100 text-blue-700',
	},
	{
		points: 8,
		label: 'がんばる',
		desc: '時間がかかること（宿題、習い事の練習など）',
		color: 'bg-purple-100 text-purple-700',
	},
	{
		points: 10,
		label: 'すごい',
		desc: '特別なチャレンジ（発表、大会参加など）',
		color: 'bg-amber-100 text-amber-700',
	},
];

export const SUB_ICON_PRESETS = [
	'🧹',
	'💧',
	'✨',
	'🎯',
	'📝',
	'🔥',
	'⭐',
	'🎵',
	'💪',
	'🧠',
	'❤️',
	'🌟',
	'🎁',
	'🏠',
	'👆',
	'🤲',
];

export const DAILY_LIMIT_OPTIONS = [
	{ val: '', label: '1回' },
	{ val: '2', label: '2回' },
	{ val: '3', label: '3回' },
	{ val: '0', label: '無制限' },
];
