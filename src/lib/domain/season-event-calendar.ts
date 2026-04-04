// src/lib/domain/season-event-calendar.ts
// Season Event Calendar — master data for auto-delivered seasonal events.
// These define the "what" and "when"; tenants opt in/out via tenant_events table.

export interface SeasonEventMission {
	categoryId: number;
	targetCount: number;
	description: string;
}

export interface SeasonEventDefinition {
	id: string; // unique code e.g., 'spring-start', 'kodomo-no-hi'
	name: string; // display name
	icon: string; // emoji
	startMonth: number; // 1-12
	startDay: number;
	endMonth: number; // 1-12
	endDay: number;
	defaultMissions: SeasonEventMission[];
	flavorText: string;
}

/**
 * Annual season event calendar.
 * Events are automatically delivered to tenants when the date range matches.
 * Parents can toggle individual events on/off.
 */
export const SEASON_EVENTS: SeasonEventDefinition[] = [
	// ============================================================
	// Spring (4-5月)
	// ============================================================
	{
		id: 'spring-start',
		name: '春の新学期チャレンジ',
		icon: '🌸',
		startMonth: 4,
		startDay: 1,
		endMonth: 4,
		endDay: 30,
		defaultMissions: [
			{ categoryId: 2, targetCount: 10, description: '4月中にべんきょうを10回やろう！' },
			{ categoryId: 3, targetCount: 8, description: 'せいかつを8回がんばろう！' },
		],
		flavorText: 'あたらしい学年のスタート！いろいろチャレンジしてみよう！',
	},
	{
		id: 'kodomo-no-hi',
		name: 'こどもの日チャレンジ',
		icon: '🎏',
		startMonth: 5,
		startDay: 1,
		endMonth: 5,
		endDay: 5,
		defaultMissions: [
			{ categoryId: 1, targetCount: 5, description: 'うんどうを5回やって元気いっぱい！' },
		],
		flavorText: 'こいのぼりのように元気にがんばろう！',
	},

	// ============================================================
	// Summer (7-8月)
	// ============================================================
	{
		id: 'summer-vacation',
		name: '夏休みスペシャル',
		icon: '🌻',
		startMonth: 7,
		startDay: 20,
		endMonth: 8,
		endDay: 31,
		defaultMissions: [
			{ categoryId: 1, targetCount: 15, description: '夏休み中にうんどうを15回！' },
			{ categoryId: 5, targetCount: 10, description: 'そうぞうを10回やってみよう！' },
			{ categoryId: 2, targetCount: 12, description: '夏休みの宿題もがんばろう！べんきょう12回！' },
		],
		flavorText: 'なつやすみはいろんなことにチャレンジできるチャンス！',
	},

	// ============================================================
	// Autumn (10月)
	// ============================================================
	{
		id: 'halloween',
		name: 'ハロウィンチャレンジ',
		icon: '🎃',
		startMonth: 10,
		startDay: 1,
		endMonth: 10,
		endDay: 31,
		defaultMissions: [
			{ categoryId: 5, targetCount: 8, description: 'そうぞうを8回がんばろう！' },
			{ categoryId: 4, targetCount: 5, description: 'こうりゅうを5回やろう！' },
		],
		flavorText: 'トリック・オア・トリート！がんばったらごほうびだ！',
	},
	{
		id: 'sports-day',
		name: 'うんどうかいチャレンジ',
		icon: '🏅',
		startMonth: 10,
		startDay: 1,
		endMonth: 10,
		endDay: 15,
		defaultMissions: [
			{ categoryId: 1, targetCount: 10, description: 'うんどうかいに向けて、うんどう10回！' },
		],
		flavorText: 'うんどうかいでかつやくできるようにれんしゅうだ！',
	},

	// ============================================================
	// Winter (12-3月)
	// ============================================================
	{
		id: 'christmas',
		name: 'クリスマスチャレンジ',
		icon: '🎄',
		startMonth: 12,
		startDay: 1,
		endMonth: 12,
		endDay: 25,
		defaultMissions: [
			{ categoryId: 3, targetCount: 10, description: 'せいかつを10回がんばろう！' },
			{ categoryId: 4, targetCount: 5, description: 'こうりゅう5回でサンタさんもにっこり！' },
		],
		flavorText: 'サンタさんもがんばるきみを応援しているよ！',
	},
	{
		id: 'new-year',
		name: 'お正月チャレンジ',
		icon: '🎍',
		startMonth: 1,
		startDay: 1,
		endMonth: 1,
		endDay: 15,
		defaultMissions: [
			{ categoryId: 2, targetCount: 5, description: '新年はべんきょうからスタート！5回やろう！' },
			{ categoryId: 3, targetCount: 5, description: 'せいかつ5回でいい1年にしよう！' },
		],
		flavorText: 'あけましておめでとう！ことしもいっぱいがんばろう！',
	},
	{
		id: 'setsubun',
		name: '節分チャレンジ',
		icon: '👹',
		startMonth: 2,
		startDay: 1,
		endMonth: 2,
		endDay: 3,
		defaultMissions: [
			{ categoryId: 1, targetCount: 3, description: 'おにをたいじ！うんどう3回！' },
		],
		flavorText: 'おにはそと！ふくはうち！がんばっておにをやっつけよう！',
	},
	{
		id: 'hinamatsuri',
		name: 'ひなまつりチャレンジ',
		icon: '🎎',
		startMonth: 3,
		startDay: 1,
		endMonth: 3,
		endDay: 3,
		defaultMissions: [{ categoryId: 5, targetCount: 3, description: 'そうぞうを3回やろう！' }],
		flavorText: 'すてきなおひなさまのように、きれいなものをつくってみよう！',
	},
];

/**
 * Get season events that are active for a given date.
 * Handles year-wrapping (e.g., events spanning Dec -> Jan).
 */
export function getActiveSeasonEvents(date: Date): SeasonEventDefinition[] {
	const month = date.getMonth() + 1; // 1-12
	const day = date.getDate();

	return SEASON_EVENTS.filter((event) => {
		if (event.startMonth <= event.endMonth) {
			// Normal range (e.g., 4/1 - 4/30)
			if (month < event.startMonth || month > event.endMonth) return false;
			if (month === event.startMonth && day < event.startDay) return false;
			if (month === event.endMonth && day > event.endDay) return false;
			return true;
		}
		// Year-wrapping range (e.g., 12/1 - 1/15)
		if (month > event.startMonth || (month === event.startMonth && day >= event.startDay)) {
			return true;
		}
		if (month < event.endMonth || (month === event.endMonth && day <= event.endDay)) {
			return true;
		}
		return false;
	});
}

/**
 * Get the specific year's date range for a season event.
 * For year-wrapping events, startDate is in the given year and endDate may be in year+1.
 */
export function getEventDateRange(
	event: SeasonEventDefinition,
	year: number,
): { startDate: string; endDate: string } {
	const startDate = `${year}-${String(event.startMonth).padStart(2, '0')}-${String(event.startDay).padStart(2, '0')}`;

	const endYear = event.startMonth > event.endMonth ? year + 1 : year;
	const endDate = `${endYear}-${String(event.endMonth).padStart(2, '0')}-${String(event.endDay).padStart(2, '0')}`;

	return { startDate, endDate };
}
