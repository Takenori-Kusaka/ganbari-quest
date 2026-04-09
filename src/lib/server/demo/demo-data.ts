/**
 * Demo Mode — Static preset data for demo experience
 * All data is read-only. Write operations return success without persisting.
 *
 * Family: がんばり家
 * - Parent: がんばり太郎
 * - Child 1: はなこ (1歳, baby)       — Level 2
 * - Child 2: たろう (5歳, preschool)  — Level 4
 * - Child 3: さくら (8歳, elementary) — Level 6
 * - Child 4: けんた (10歳, elementary) — Level 10
 * - Child 5: じろう (15歳, junior)    — Level 15+
 */

import { getDefaultUiMode } from '$lib/domain/validation/age-tier';
import type {
	Activity,
	ActivityLog,
	ChecklistTemplate,
	ChecklistTemplateItem,
	Child,
	ChildAchievement,
	DailyMission,
	LoginBonus,
	Status,
} from '$lib/server/db/types/index.js';

// ============================================================
// Constants
// ============================================================

const DEMO_TENANT_ID = 'demo';
const NOW = '2026-03-27T09:00:00.000Z';
const TODAY = '2026-03-27';

function daysAgo(n: number): string {
	const d = new Date('2026-03-27');
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
	const d = new Date('2026-03-27T09:00:00.000Z');
	d.setDate(d.getDate() - n);
	return d.toISOString();
}

// ============================================================
// Children
// ============================================================

export const DEMO_CHILDREN: Child[] = [
	{
		id: 901,
		nickname: 'はなこ',
		age: 1,
		birthDate: '2025-01-15',
		theme: 'pink',
		uiMode: getDefaultUiMode(1),
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 902,
		nickname: 'たろう',
		age: 5,
		birthDate: '2020-06-10',
		theme: 'green',
		uiMode: getDefaultUiMode(5),
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		createdAt: '2025-09-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 903,
		nickname: 'さくら',
		age: 8,
		birthDate: '2018-03-22',
		theme: 'blue',
		uiMode: getDefaultUiMode(8),
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 905,
		nickname: 'けんた',
		age: 10,
		birthDate: '2015-04-18',
		theme: 'orange',
		uiMode: getDefaultUiMode(10),
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 904,
		nickname: 'じろう',
		age: 15,
		birthDate: '2010-08-05',
		theme: 'purple',
		uiMode: getDefaultUiMode(15),
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
];

// ============================================================
// Activities (shared across all children)
// ============================================================

export const DEMO_ACTIVITIES: Activity[] = [
	// ============================================================
	// アクティビティパック準拠の活動データ
	// baby-first / kinder-starter / elementary-challenge パック + 上位年齢用
	// ============================================================

	// 運動 (categoryId: 1)
	{
		id: 1,
		name: 'はいはいした',
		categoryId: 1,
		icon: '🐣',
		basePoints: 3,
		ageMin: 0,
		ageMax: 1,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'pack',
		gradeLevel: 'baby',
		subcategory: null,
		description: '這う・伝い歩きなど基本運動',
		nameKana: 'はいはいした',
		nameKanji: null,
		triggerHint: 'マットで はいはい してみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 2,
		name: 'あんよした',
		categoryId: 1,
		icon: '👣',
		basePoints: 5,
		ageMin: 0,
		ageMax: 2,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'pack',
		gradeLevel: 'baby',
		subcategory: null,
		description: '歩行の練習・伝い歩き',
		nameKana: 'あんよした',
		nameKanji: null,
		triggerHint: 'てを つないで あるいてみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 3,
		name: 'おそとにでた',
		categoryId: 1,
		icon: '🌿',
		basePoints: 3,
		ageMin: 0,
		ageMax: 2,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'pack',
		gradeLevel: 'baby',
		subcategory: null,
		description: '戸外で外気に触れ体を動かす',
		nameKana: 'おそとにでた',
		nameKanji: null,
		triggerHint: 'おそとの かぜを かんじよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 4,
		name: 'からだをうごかした',
		categoryId: 1,
		icon: '🤸',
		basePoints: 5,
		ageMin: 0,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '外遊び・体操・かけっこ',
		nameKana: 'からだをうごかした',
		nameKanji: null,
		triggerHint: 'おそとで いっぱい あそぼう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 5,
		name: 'なわとびした',
		categoryId: 1,
		icon: '🪢',
		basePoints: 5,
		ageMin: 4,
		ageMax: 9,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 5,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '縄跳びの練習',
		nameKana: 'なわとびした',
		nameKanji: null,
		triggerHint: 'なわとび れんしゅう してみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 6,
		name: 'ダンスした',
		categoryId: 1,
		icon: '💃',
		basePoints: 5,
		ageMin: 3,
		ageMax: 9,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 6,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '音楽に合わせたダンス',
		nameKana: 'だんすした',
		nameKanji: null,
		triggerHint: 'おんがくに あわせて おどろう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 7,
		name: 'うんどうした',
		categoryId: 1,
		icon: '🏃',
		basePoints: 10,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 7,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: 'スポーツ・運動全般',
		nameKana: 'うんどうした',
		nameKanji: '運動した',
		triggerHint: 'からだを うごかそう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// 勉強 (categoryId: 2)
	{
		id: 10,
		name: 'えほんをよんだ',
		categoryId: 2,
		icon: '📖',
		basePoints: 5,
		ageMin: 0,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '絵本を読む・読み聞かせ',
		nameKana: 'えほんをよんだ',
		nameKanji: null,
		triggerHint: 'えほんを よんでみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 11,
		name: 'すうじをかぞえた',
		categoryId: 2,
		icon: '🔢',
		basePoints: 5,
		ageMin: 3,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'pack',
		gradeLevel: 'kinder',
		subcategory: null,
		description: '1〜10の数を数える',
		nameKana: 'すうじをかぞえた',
		nameKanji: null,
		triggerHint: 'いち、に、さん… かぞえよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 12,
		name: 'ひらがなれんしゅう',
		categoryId: 2,
		icon: '✏️',
		basePoints: 10,
		ageMin: 4,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'pack',
		gradeLevel: 'kinder',
		subcategory: null,
		description: 'ひらがなの読み書き練習',
		nameKana: 'ひらがなれんしゅう',
		nameKanji: null,
		triggerHint: 'ひらがなを かいてみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 13,
		name: 'しゅくだいをした',
		categoryId: 2,
		icon: '📝',
		basePoints: 10,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '学校の宿題を完了',
		nameKana: 'しゅくだいをした',
		nameKanji: '宿題をした',
		triggerHint: 'きょうの しゅくだい おわらせよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 14,
		name: 'どくしょした',
		categoryId: 2,
		icon: '📚',
		basePoints: 10,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 5,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '本・図書を読む',
		nameKana: 'どくしょした',
		nameKanji: '読書した',
		triggerHint: 'ほんを よもう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 15,
		name: 'けいさんれんしゅう',
		categoryId: 2,
		icon: '🔢',
		basePoints: 10,
		ageMin: 6,
		ageMax: 9,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 6,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '計算ドリル・算数プリント',
		nameKana: 'けいさんれんしゅう',
		nameKanji: '計算練習',
		triggerHint: 'けいさんドリルを やろう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// --- upper (9-12) / teen (13+) 向け追加 ---
	{
		id: 16,
		name: '自主学習した',
		categoryId: 2,
		icon: '📓',
		basePoints: 15,
		ageMin: 9,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 7,
		source: 'pack',
		gradeLevel: 'elementary_upper',
		subcategory: null,
		description: '教科書・参考書を使った自主学習',
		nameKana: 'じしゅがくしゅうした',
		nameKanji: '自主学習した',
		triggerHint: 'じぶんで べんきょうを すすめよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 17,
		name: '受験勉強した',
		categoryId: 2,
		icon: '🎓',
		basePoints: 20,
		ageMin: 13,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 8,
		source: 'pack',
		gradeLevel: 'middle_school',
		subcategory: null,
		description: '受験に向けた勉強・過去問演習',
		nameKana: 'じゅけんべんきょうした',
		nameKanji: '受験勉強した',
		triggerHint: '目標に向かって勉強しよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 18,
		name: '資格・検定の勉強',
		categoryId: 2,
		icon: '📜',
		basePoints: 20,
		ageMin: 13,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 9,
		source: 'pack',
		gradeLevel: 'middle_school',
		subcategory: null,
		description: '英検・漢検・数検などの資格勉強',
		nameKana: 'しかく・けんていのべんきょう',
		nameKanji: '資格・検定の勉強',
		triggerHint: '資格取得に向けて勉強しよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// 運動 — upper/teen 追加
	{
		id: 8,
		name: '部活・習い事',
		categoryId: 1,
		icon: '⚽',
		basePoints: 15,
		ageMin: 9,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 8,
		source: 'pack',
		gradeLevel: 'elementary_upper',
		subcategory: null,
		description: '部活動やスポーツ系習い事',
		nameKana: 'ぶかつ・ならいごと',
		nameKanji: '部活・習い事',
		triggerHint: 'きょうの部活・習い事がんばろう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// 生活 (categoryId: 3)
	{
		id: 20,
		name: 'はみがきした',
		categoryId: 3,
		icon: '🪥',
		basePoints: 5,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: 0,
		sortOrder: 1,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '食後の歯磨き',
		nameKana: 'はみがきした',
		nameKanji: null,
		triggerHint: 'ごはんのあと はみがきしよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 21,
		name: 'おきがえした',
		categoryId: 3,
		icon: '👕',
		basePoints: 5,
		ageMin: 0,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '自分で着替え',
		nameKana: 'おきがえした',
		nameKanji: null,
		triggerHint: 'じぶんで おきがえ してみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 22,
		name: 'おかたづけした',
		categoryId: 3,
		icon: '🧹',
		basePoints: 5,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: 'おもちゃ・部屋の片付け',
		nameKana: 'おかたづけした',
		nameKanji: null,
		triggerHint: 'あそんだあと おかたづけ！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 23,
		name: 'てをあらった',
		categoryId: 3,
		icon: '🧼',
		basePoints: 3,
		ageMin: 0,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '帰宅時・食前の手洗い',
		nameKana: 'てをあらった',
		nameKanji: null,
		triggerHint: 'おそとから かえったら てあらい！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 24,
		name: 'はやおきした',
		categoryId: 3,
		icon: '⏰',
		basePoints: 5,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 5,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '決まった時間に起床',
		nameKana: 'はやおきした',
		nameKanji: null,
		triggerHint: 'あさ じかんどおりに おきよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 25,
		name: 'おてつだいした',
		categoryId: 3,
		icon: '🫧',
		basePoints: 10,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 6,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '食事の準備・配膳のお手伝い等',
		nameKana: 'おてつだいした',
		nameKanji: null,
		triggerHint: 'おうちの おてつだい してみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 26,
		name: 'ごはんをたべた',
		categoryId: 3,
		icon: '🍚',
		basePoints: 3,
		ageMin: 0,
		ageMax: 2,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 7,
		source: 'pack',
		gradeLevel: 'baby',
		subcategory: null,
		description: '離乳食・幼児食を食べる',
		nameKana: 'ごはんをたべた',
		nameKanji: null,
		triggerHint: 'もぐもぐ ごはんを たべよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 27,
		name: 'じかんわりのじゅんび',
		categoryId: 3,
		icon: '🎒',
		basePoints: 5,
		ageMin: 6,
		ageMax: 9,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 8,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '翌日の持ち物・教科書の準備',
		nameKana: 'じかんわりのじゅんび',
		nameKanji: '時間割の準備',
		triggerHint: 'あしたの じゅんび しておこう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// --- 生活: upper/teen 追加 ---
	{
		id: 28,
		name: '家事手伝い',
		categoryId: 3,
		icon: '🍳',
		basePoints: 10,
		ageMin: 9,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 9,
		source: 'pack',
		gradeLevel: 'elementary_upper',
		subcategory: null,
		description: '料理・洗濯・掃除など家事全般',
		nameKana: 'かじてつだい',
		nameKanji: '家事手伝い',
		triggerHint: 'おうちの家事を手伝おう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// 交流 (categoryId: 4)
	{
		id: 30,
		name: 'あいさつした',
		categoryId: 4,
		icon: '👋',
		basePoints: 3,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '元気な挨拶・お礼',
		nameKana: 'あいさつした',
		nameKanji: null,
		triggerHint: 'おはよう、ありがとう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 31,
		name: 'いっしょにあそんだ',
		categoryId: 4,
		icon: '🤝',
		basePoints: 5,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: 'お友達との協力遊び',
		nameKana: 'いっしょにあそんだ',
		nameKanji: null,
		triggerHint: 'おともだちと あそぼう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 32,
		name: 'ありがとうをいった',
		categoryId: 4,
		icon: '💕',
		basePoints: 3,
		ageMin: 3,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'pack',
		gradeLevel: 'kinder',
		subcategory: null,
		description: '感謝の気持ちを伝える',
		nameKana: 'ありがとうをいった',
		nameKanji: null,
		triggerHint: 'ありがとう って いえるかな？',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 33,
		name: 'じゅんばんをまもった',
		categoryId: 4,
		icon: '🙋',
		basePoints: 5,
		ageMin: 3,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'pack',
		gradeLevel: 'kinder',
		subcategory: null,
		description: '順番を守る・交代する',
		nameKana: 'じゅんばんをまもった',
		nameKanji: null,
		triggerHint: 'じゅんばんこ できるかな？',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 34,
		name: 'にこにこした',
		categoryId: 4,
		icon: '😊',
		basePoints: 3,
		ageMin: 0,
		ageMax: 2,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 5,
		source: 'pack',
		gradeLevel: 'baby',
		subcategory: null,
		description: '笑顔のコミュニケーション',
		nameKana: 'にこにこした',
		nameKanji: null,
		triggerHint: 'にこにこ えがおを みせよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// --- 交流: teen 追加 ---
	{
		id: 35,
		name: 'ボランティア活動',
		categoryId: 4,
		icon: '🤲',
		basePoints: 20,
		ageMin: 13,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 6,
		source: 'pack',
		gradeLevel: 'middle_school',
		subcategory: null,
		description: '地域活動・ボランティアへの参加',
		nameKana: 'ぼらんてぃあかつどう',
		nameKanji: 'ボランティア活動',
		triggerHint: '地域のために活動しよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},

	// 創造 (categoryId: 5)
	{
		id: 40,
		name: 'おえかきした',
		categoryId: 5,
		icon: '🖍️',
		basePoints: 5,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '自由にお絵描き',
		nameKana: 'おえかきした',
		nameKanji: null,
		triggerHint: 'すきなものを かいてみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 41,
		name: 'こうさくした',
		categoryId: 5,
		icon: '✂️',
		basePoints: 10,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '折り紙・切り貼り・工作',
		nameKana: 'こうさくした',
		nameKanji: null,
		triggerHint: 'はさみや のりで つくろう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 42,
		name: 'おうたをうたった',
		categoryId: 5,
		icon: '🎵',
		basePoints: 5,
		ageMin: 0,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: '童謡やリズム遊び',
		nameKana: 'おうたをうたった',
		nameKanji: null,
		triggerHint: 'おうたを うたおう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
	{
		id: 43,
		name: 'ピアノれんしゅう',
		categoryId: 5,
		icon: '🎹',
		basePoints: 15,
		ageMin: 5,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'pack',
		gradeLevel: null,
		subcategory: null,
		description: 'ピアノ・楽器の練習',
		nameKana: 'ぴあのれんしゅう',
		nameKanji: 'ピアノ練習',
		triggerHint: 'すきな きょくを ひいてみよう！',
		isMainQuest: 0,
		createdAt: NOW,
	},
];

// ============================================================
// Activity Logs (recent 14 days for each child)
// ============================================================

// Use fixed seed approach for deterministic data
export const DEMO_ACTIVITY_LOGS: ActivityLog[] = [
	// はなこ (baby) — simple logs
	...[0, 1, 2, 3, 5, 7, 10].flatMap((d, i) => [
		{
			id: 901001 + i * 2,
			childId: 901,
			activityId: 1,
			points: 11,
			streakDays: 3,
			streakBonus: 2,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 901002 + i * 2,
			childId: 901,
			activityId: 20,
			points: 6,
			streakDays: 3,
			streakBonus: 1,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
	]),
	// たろう (preschool, age 5) — moderate activity
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].flatMap((d, i) => [
		{
			id: 902001 + i * 3,
			childId: 902,
			activityId: 4, // からだをうごかした (age 0-5)
			points: 7,
			streakDays: 10,
			streakBonus: 2,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 902002 + i * 3,
			childId: 902,
			activityId: 10, // えほんをよんだ (age 0-5)
			points: 7,
			streakDays: 10,
			streakBonus: 2,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		...(d % 2 === 0
			? [
					{
						id: 902003 + i * 3,
						childId: 902,
						activityId: 25, // おてつだいした (age 3+)
						points: 12,
						streakDays: 5,
						streakBonus: 2,
						recordedDate: daysAgo(d),
						recordedAt: daysAgoISO(d),
						cancelled: 0,
					},
				]
			: []),
	]),
	// さくら (elementary, age 8) — active with variety
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((d, i) => [
		{
			id: 903001 + i * 4,
			childId: 903,
			activityId: 13, // しゅくだいをした (age 6+)
			points: 18,
			streakDays: 14,
			streakBonus: 7,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 903002 + i * 4,
			childId: 903,
			activityId: 7, // うんどうした (age 6+)
			points: 13,
			streakDays: 14,
			streakBonus: 7,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 903003 + i * 4,
			childId: 903,
			activityId: 22,
			points: 17,
			streakDays: 14,
			streakBonus: 5,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		...(d % 3 === 0
			? [
					{
						id: 903004 + i * 4,
						childId: 903,
						activityId: 40,
						points: 18,
						streakDays: 5,
						streakBonus: 3,
						recordedDate: daysAgo(d),
						recordedAt: daysAgoISO(d),
						cancelled: 0,
					},
				]
			: []),
	]),
	// けんた (elementary, age 10) — active learner, sports & self-study
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((d, i) => [
		{
			id: 905001 + i * 4,
			childId: 905,
			activityId: 16, // 自主学習した (age 9+)
			points: 20,
			streakDays: 14,
			streakBonus: 8,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 905002 + i * 4,
			childId: 905,
			activityId: 8, // 部活・習い事 (age 9+)
			points: 18,
			streakDays: 14,
			streakBonus: 7,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 905003 + i * 4,
			childId: 905,
			activityId: 28, // 家事手伝い (age 9+)
			points: 13,
			streakDays: 10,
			streakBonus: 5,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		...(d % 2 === 0
			? [
					{
						id: 905004 + i * 4,
						childId: 905,
						activityId: 7, // うんどうした (age 6+)
						points: 14,
						streakDays: 7,
						streakBonus: 4,
						recordedDate: daysAgo(d),
						recordedAt: daysAgoISO(d),
						cancelled: 0,
					},
				]
			: []),
	]),
	// じろう (junior, age 15) — very active, all categories
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((d, i) => [
		{
			id: 904001 + i * 5,
			childId: 904,
			activityId: 7, // うんどうした (age 6+)
			points: 15,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904002 + i * 5,
			childId: 904,
			activityId: 13, // しゅくだいをした (age 6+)
			points: 15,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904003 + i * 5,
			childId: 904,
			activityId: 17, // 受験勉強した (age 13+)
			points: 25,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904004 + i * 5,
			childId: 904,
			activityId: 18, // 資格・検定の勉強 (age 13+)
			points: 20,
			streakDays: 14,
			streakBonus: 8,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904005 + i * 5,
			childId: 904,
			activityId: 43, // ピアノれんしゅう
			points: 30,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
	]),
];

// ============================================================
// Status (5-axis per child)
// ============================================================

export const DEMO_STATUSES: Status[] = [
	// はなこ (baby, Lv.2) — 15 XP 程度
	{ id: 9011, childId: 901, categoryId: 1, totalXp: 20, level: 2, peakXp: 20, updatedAt: NOW },
	{ id: 9012, childId: 901, categoryId: 2, totalXp: 10, level: 1, peakXp: 10, updatedAt: NOW },
	{ id: 9013, childId: 901, categoryId: 3, totalXp: 25, level: 2, peakXp: 25, updatedAt: NOW },
	{ id: 9014, childId: 901, categoryId: 4, totalXp: 12, level: 1, peakXp: 12, updatedAt: NOW },
	{ id: 9015, childId: 901, categoryId: 5, totalXp: 18, level: 2, peakXp: 18, updatedAt: NOW },
	// たろう (preschool, Lv.4) — 80-140 XP
	{ id: 9021, childId: 902, categoryId: 1, totalXp: 120, level: 4, peakXp: 120, updatedAt: NOW },
	{ id: 9022, childId: 902, categoryId: 2, totalXp: 90, level: 4, peakXp: 90, updatedAt: NOW },
	{ id: 9023, childId: 902, categoryId: 3, totalXp: 75, level: 3, peakXp: 75, updatedAt: NOW },
	{ id: 9024, childId: 902, categoryId: 4, totalXp: 55, level: 3, peakXp: 55, updatedAt: NOW },
	{ id: 9025, childId: 902, categoryId: 5, totalXp: 100, level: 4, peakXp: 100, updatedAt: NOW },
	// さくら (elementary, Lv.7) — 275-500 XP
	{ id: 9031, childId: 903, categoryId: 1, totalXp: 450, level: 9, peakXp: 450, updatedAt: NOW },
	{ id: 9032, childId: 903, categoryId: 2, totalXp: 350, level: 8, peakXp: 350, updatedAt: NOW },
	{ id: 9033, childId: 903, categoryId: 3, totalXp: 300, level: 7, peakXp: 300, updatedAt: NOW },
	{ id: 9034, childId: 903, categoryId: 4, totalXp: 200, level: 6, peakXp: 200, updatedAt: NOW },
	{ id: 9035, childId: 903, categoryId: 5, totalXp: 280, level: 7, peakXp: 280, updatedAt: NOW },
	// けんた (elementary, Lv.10) — 600-1000 XP
	{ id: 9051, childId: 905, categoryId: 1, totalXp: 800, level: 12, peakXp: 800, updatedAt: NOW },
	{ id: 9052, childId: 905, categoryId: 2, totalXp: 1000, level: 13, peakXp: 1000, updatedAt: NOW },
	{ id: 9053, childId: 905, categoryId: 3, totalXp: 600, level: 10, peakXp: 600, updatedAt: NOW },
	{ id: 9054, childId: 905, categoryId: 4, totalXp: 400, level: 8, peakXp: 400, updatedAt: NOW },
	{ id: 9055, childId: 905, categoryId: 5, totalXp: 700, level: 11, peakXp: 700, updatedAt: NOW },
	// じろう (junior, Lv.15+) — 1200-2500 XP
	{ id: 9041, childId: 904, categoryId: 1, totalXp: 2000, level: 18, peakXp: 2000, updatedAt: NOW },
	{ id: 9042, childId: 904, categoryId: 2, totalXp: 2500, level: 20, peakXp: 2500, updatedAt: NOW },
	{ id: 9043, childId: 904, categoryId: 3, totalXp: 1200, level: 15, peakXp: 1200, updatedAt: NOW },
	{ id: 9044, childId: 904, categoryId: 4, totalXp: 800, level: 10, peakXp: 800, updatedAt: NOW },
	{ id: 9045, childId: 904, categoryId: 5, totalXp: 1800, level: 17, peakXp: 1800, updatedAt: NOW },
];

// ============================================================
// Point Balances (computed from logs)
// ============================================================

export const DEMO_POINT_BALANCES: Record<number, number> = {
	901: 180, // baby — low
	902: 1250, // preschool — moderate
	903: 3400, // elementary — active
	905: 5200, // elementary — active learner
	904: 8500, // junior — very active
};

// ============================================================
// Achievements
// ============================================================

export const DEMO_CHILD_ACHIEVEMENTS: ChildAchievement[] = [
	// たろう
	{ id: 1, childId: 902, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(20) },
	{ id: 2, childId: 902, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(15) },
	// さくら
	{ id: 3, childId: 903, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(60) },
	{ id: 4, childId: 903, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(50) },
	{ id: 5, childId: 903, achievementId: 2, milestoneValue: 50, unlockedAt: daysAgoISO(30) },
	{ id: 6, childId: 903, achievementId: 3, milestoneValue: null, unlockedAt: daysAgoISO(25) },
	{ id: 7, childId: 903, achievementId: 4, milestoneValue: null, unlockedAt: daysAgoISO(10) },
	// けんた
	{ id: 15, childId: 905, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(50) },
	{ id: 16, childId: 905, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(40) },
	{ id: 17, childId: 905, achievementId: 2, milestoneValue: 50, unlockedAt: daysAgoISO(25) },
	{ id: 18, childId: 905, achievementId: 3, milestoneValue: null, unlockedAt: daysAgoISO(20) },
	{ id: 19, childId: 905, achievementId: 4, milestoneValue: null, unlockedAt: daysAgoISO(10) },
	// じろう
	{ id: 8, childId: 904, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(90) },
	{ id: 9, childId: 904, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(80) },
	{ id: 10, childId: 904, achievementId: 2, milestoneValue: 50, unlockedAt: daysAgoISO(60) },
	{ id: 11, childId: 904, achievementId: 2, milestoneValue: 100, unlockedAt: daysAgoISO(30) },
	{ id: 12, childId: 904, achievementId: 3, milestoneValue: null, unlockedAt: daysAgoISO(70) },
	{ id: 13, childId: 904, achievementId: 4, milestoneValue: null, unlockedAt: daysAgoISO(50) },
	{ id: 14, childId: 904, achievementId: 5, milestoneValue: null, unlockedAt: daysAgoISO(20) },
];

// ============================================================
// Daily Missions (today)
// ============================================================

export const DEMO_DAILY_MISSIONS: DailyMission[] = [
	// たろう (preschool, age 5) — 3 missions, 1 done
	{ id: 1, childId: 902, missionDate: TODAY, activityId: 4, completed: 1, completedAt: NOW }, // からだをうごかした
	{ id: 2, childId: 902, missionDate: TODAY, activityId: 10, completed: 0, completedAt: null }, // えほんをよんだ
	{ id: 3, childId: 902, missionDate: TODAY, activityId: 30, completed: 0, completedAt: null }, // あいさつした
	// さくら (elementary, age 8) — 3 missions, 2 done
	{ id: 4, childId: 903, missionDate: TODAY, activityId: 13, completed: 1, completedAt: NOW }, // しゅくだいをした
	{ id: 5, childId: 903, missionDate: TODAY, activityId: 7, completed: 1, completedAt: NOW }, // うんどうした
	{ id: 6, childId: 903, missionDate: TODAY, activityId: 40, completed: 0, completedAt: null }, // おえかきした
	// けんた (elementary, age 10) — 3 missions, 1 done
	{ id: 10, childId: 905, missionDate: TODAY, activityId: 16, completed: 1, completedAt: NOW }, // 自主学習した
	{ id: 11, childId: 905, missionDate: TODAY, activityId: 8, completed: 0, completedAt: null }, // 部活・習い事
	{ id: 12, childId: 905, missionDate: TODAY, activityId: 28, completed: 0, completedAt: null }, // 家事手伝い
	// じろう (junior, age 15) — 3 missions, all done
	{ id: 7, childId: 904, missionDate: TODAY, activityId: 7, completed: 1, completedAt: NOW }, // うんどうした
	{ id: 8, childId: 904, missionDate: TODAY, activityId: 17, completed: 1, completedAt: NOW }, // 受験勉強した
	{ id: 9, childId: 904, missionDate: TODAY, activityId: 43, completed: 1, completedAt: NOW }, // ピアノれんしゅう
];

// ============================================================
// Checklist Templates
// ============================================================

export const DEMO_CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
	{
		id: 901,
		childId: 902,
		name: 'あさのしたく',
		icon: '☀️',
		pointsPerItem: 2,
		completionBonus: 5,
		timeSlot: 'morning',
		isActive: 1,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 902,
		childId: 903,
		name: 'よるのじゅんび',
		icon: '🌙',
		pointsPerItem: 2,
		completionBonus: 5,
		timeSlot: 'evening',
		isActive: 1,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 903,
		childId: 905,
		name: '帰宅後ルーティン',
		icon: '🏠',
		pointsPerItem: 3,
		completionBonus: 10,
		timeSlot: 'afternoon',
		isActive: 1,
		createdAt: NOW,
		updatedAt: NOW,
	},
];

export const DEMO_CHECKLIST_ITEMS: ChecklistTemplateItem[] = [
	// あさのしたく（morning-routine.json 準拠）
	{
		id: 1,
		templateId: 901,
		name: 'はみがき',
		icon: '🪥',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 2,
		templateId: 901,
		name: 'かおをあらう',
		icon: '🧼',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 3,
		templateId: 901,
		name: 'きがえ',
		icon: '👕',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 4,
		templateId: 901,
		name: 'あさごはん',
		icon: '🍚',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
	{
		id: 5,
		templateId: 901,
		name: 'もちものチェック',
		icon: '🎒',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 5,
		createdAt: NOW,
	},
	// よるのじゅんび（evening-routine.json 準拠）
	{
		id: 6,
		templateId: 902,
		name: 'おふろ',
		icon: '🛁',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 7,
		templateId: 902,
		name: 'はみがき',
		icon: '🪥',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 8,
		templateId: 902,
		name: 'あしたのじゅんび',
		icon: '📋',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 9,
		templateId: 902,
		name: 'おやすみのあいさつ',
		icon: '😴',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
	// 帰宅後ルーティン（けんた）
	{
		id: 10,
		templateId: 903,
		name: '手洗い・うがい',
		icon: '🧼',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 11,
		templateId: 903,
		name: '宿題をやる',
		icon: '📝',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 12,
		templateId: 903,
		name: '自主学習30分',
		icon: '📓',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 13,
		templateId: 903,
		name: '部屋の片づけ',
		icon: '🧹',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
];

// ============================================================
// Login Bonus
// ============================================================

export const DEMO_LOGIN_BONUSES: LoginBonus[] = [
	{
		id: 1,
		childId: 902,
		loginDate: TODAY,
		rank: 'dai-kichi',
		basePoints: 10,
		multiplier: 1.5,
		totalPoints: 15,
		consecutiveDays: 5,
		createdAt: NOW,
	},
	{
		id: 2,
		childId: 903,
		loginDate: TODAY,
		rank: 'kichi',
		basePoints: 5,
		multiplier: 2.0,
		totalPoints: 10,
		consecutiveDays: 14,
		createdAt: NOW,
	},
	{
		id: 4,
		childId: 905,
		loginDate: TODAY,
		rank: 'kichi',
		basePoints: 5,
		multiplier: 1.5,
		totalPoints: 8,
		consecutiveDays: 10,
		createdAt: NOW,
	},
	{
		id: 3,
		childId: 904,
		loginDate: TODAY,
		rank: 'chu-kichi',
		basePoints: 3,
		multiplier: 2.0,
		totalPoints: 6,
		consecutiveDays: 14,
		createdAt: NOW,
	},
];

// ============================================================
// Helper: Get demo data for a specific child
// ============================================================

export function getDemoChild(childId: number): Child | undefined {
	return DEMO_CHILDREN.find((c) => c.id === childId);
}

export function getDemoActivitiesForChild(childAge: number): Activity[] {
	return DEMO_ACTIVITIES.filter(
		(a) =>
			(a.ageMin === null || childAge >= a.ageMin) && (a.ageMax === null || childAge <= a.ageMax),
	);
}

export function getDemoLogsForChild(childId: number): ActivityLog[] {
	return DEMO_ACTIVITY_LOGS.filter((l) => l.childId === childId);
}

export function getDemoStatusesForChild(childId: number): Status[] {
	return DEMO_STATUSES.filter((s) => s.childId === childId);
}

export function getDemoMissionsForChild(childId: number): DailyMission[] {
	return DEMO_DAILY_MISSIONS.filter((m) => m.childId === childId);
}

export function getDemoChecklistsForChild(childId: number): {
	templates: ChecklistTemplate[];
	items: ChecklistTemplateItem[];
} {
	const templates = DEMO_CHECKLIST_TEMPLATES.filter((t) => t.childId === childId);
	const templateIds = templates.map((t) => t.id);
	const items = DEMO_CHECKLIST_ITEMS.filter((i) => templateIds.includes(i.templateId));
	return { templates, items };
}

export function getDemoPointBalance(childId: number): number {
	return DEMO_POINT_BALANCES[childId] ?? 0;
}

export function getDemoAchievementsForChild(childId: number): ChildAchievement[] {
	return DEMO_CHILD_ACHIEVEMENTS.filter((a) => a.childId === childId);
}

export { DEMO_TENANT_ID, NOW, TODAY };
