// src/lib/domain/season-event-calendar.ts
export interface SeasonEventDef {
	code: string;
	name: string;
	description: string;
	startMonthDay: string;
	endMonthDay: string;
	categoryId: number | null;
	bonusMultiplier: number;
}

export const SEASON_EVENT_CALENDAR: SeasonEventDef[] = [
	{
		code: 'spring-new-term',
		name: 'しんがっきスタートダッシュ',
		description: '新学期のはじまり！ べんきょうをがんばろう',
		startMonthDay: '04-01',
		endMonthDay: '04-14',
		categoryId: 2,
		bonusMultiplier: 1.5,
	},
	{
		code: 'kodomo-no-hi',
		name: 'こどもの日チャレンジ',
		description: 'こどもの日をお祝い！ いろんなことにチャレンジ',
		startMonthDay: '05-01',
		endMonthDay: '05-07',
		categoryId: null,
		bonusMultiplier: 1.5,
	},
	{
		code: 'summer-vacation',
		name: 'なつやすみ大ぼうけん',
		description: 'なつやすみも毎日がんばろう！',
		startMonthDay: '07-20',
		endMonthDay: '08-31',
		categoryId: null,
		bonusMultiplier: 1.2,
	},
	{
		code: 'halloween',
		name: 'ハロウィンおばけたいじ',
		description: 'ハロウィンの季節！ おばけに負けずにがんばろう',
		startMonthDay: '10-25',
		endMonthDay: '10-31',
		categoryId: null,
		bonusMultiplier: 1.5,
	},
	{
		code: 'christmas',
		name: 'クリスマスプレゼント大さくせん',
		description: 'サンタさんにアピール！ いいこでがんばろう',
		startMonthDay: '12-01',
		endMonthDay: '12-25',
		categoryId: null,
		bonusMultiplier: 1.3,
	},
	{
		code: 'new-year',
		name: 'おしょうがつチャレンジ',
		description: 'あたらしい年のはじまり！ せいかつをととのえよう',
		startMonthDay: '01-01',
		endMonthDay: '01-07',
		categoryId: 3,
		bonusMultiplier: 1.5,
	},
	{
		code: 'setsubun',
		name: 'せつぶんおにたいじ',
		description: 'おにはそと！ うんどうでおにをやっつけよう',
		startMonthDay: '02-01',
		endMonthDay: '02-03',
		categoryId: 1,
		bonusMultiplier: 2.0,
	},
	{
		code: 'hinamatsuri',
		name: 'ひなまつりそうぞうチャレンジ',
		description: 'ひなまつりの季節！ そうぞう力をはっきしよう',
		startMonthDay: '03-01',
		endMonthDay: '03-03',
		categoryId: 5,
		bonusMultiplier: 2.0,
	},
];

export function getActiveCalendarEvents(today: string): SeasonEventDef[] {
	const monthDay = today.slice(5);
	return SEASON_EVENT_CALENDAR.filter(
		(ev) => monthDay >= ev.startMonthDay && monthDay <= ev.endMonthDay,
	);
}

export function getCalendarEventByCode(code: string): SeasonEventDef | undefined {
	return SEASON_EVENT_CALENDAR.find((ev) => ev.code === code);
}

export function toFullDate(year: number, monthDay: string): string {
	return `${year}-${monthDay}`;
}
