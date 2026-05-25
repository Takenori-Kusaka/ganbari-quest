/**
 * Demo Mode — Static preset data for demo experience
 * All data is read-only. Write operations return success without persisting.
 *
 * Family: がんばり家
 * #703: 5年齢パターン × 男女ミックスの 5 人構成。年齢別プリセット活動を確認でき、
 *       かつ男女のバリエーションも表現する。
 *
 * - Parent: がんばり太郎
 * - Child 1 (901): たろうくん (1歳, baby M, blue)        — Level 2
 * - Child 2 (902): ひなちゃん (5歳, preschool F, pink) — Level 4 (#1893: LP 用代表ペルソナ)
 * - Child 3 (903): けんたくん (8歳, elementary M, green) — Level 7
 * - Child 4 (904): さくらちゃん (14歳, junior F, purple) — Level 15+
 * - Child 5 (906): けいすけくん (17歳, senior M, orange) — Level 20+
 *
 * #1893 (PO-4-7、8 回目指摘) — LP 配信 SS が本番 NUC ユーザの実画面と乖離する問題への
 * 構造的対策の一部:
 * - 902 はなこ → ひなちゃん (旧 PO 期待値「ゆうきちゃん」だったが user 家族実名のため 2026-05-16 リネーム)
 *   注: PO 期待値「テーマ sakura」は THEME_LABELS に sakura が未定義のため、
 *       現行 5 themes 中で本番 NUC 実態と最も近い pink を維持する
 * - 902 活動ログ ≥ 10 件 + records_10 マイルストーン達成済 (MilestoneBanner 表示用)
 * - LP `feature-belongings-checklist` 等の SS 撮影元は #2097 PR-B1 で本番 routes
 *   `/checklist?childId=903` に切替、本 PR-B2 (#2187) で `/demo/checklist` 自体を撤去 →
 *   本番 path に 308 redirect。child 903 は既に活動ログ ≥ 14 件あり、`?screenshot=all`
 *   モード + demo Lambda env (`AUTH_MODE=anonymous` + `DATA_SOURCE=demo`) で MilestoneBanner
 *   強制表示できる
 */

import { getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import type {
	ActivityPackPayload,
	ChecklistPayload,
	RewardSetPayload,
} from '$lib/domain/marketplace-item';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { getDefaultUiMode } from '$lib/domain/validation/age-tier';
import type { RewardCategory } from '$lib/domain/validation/special-reward';
import type { DailyBattleRow } from '$lib/server/db/interfaces/battle-repo.interface';
import { getDefaultStampMasters } from '$lib/server/db/stamp-master-defaults';
import type {
	Activity,
	ActivityLog,
	AutoChallenge,
	Certificate,
	ChecklistTemplate,
	ChecklistTemplateItem,
	Child,
	ChildAchievement,
	ChildActivity,
	ChildChallenge,
	DailyMission,
	Evaluation,
	LoginBonus,
	SiblingChallenge,
	SiblingChallengeProgress,
	SiblingCheer,
	SpecialReward,
	StampCard,
	StampEntry,
	StampMaster,
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
	// 901 — 乳幼児 (男): blue テーマ
	{
		id: 901,
		nickname: 'たろうくん',
		age: 1,
		birthDate: '2025-01-15',
		theme: 'blue',
		uiMode: getDefaultUiMode(1),
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	// 902 — 幼児 (女): pink テーマ (#1893: LP 用代表ペルソナ。
	//        旧 'ゆうきちゃん' は user 家族実名 'ゆうき' を含むため 'ひな' に変更 2026-05-16)
	{
		id: 902,
		nickname: 'ひなちゃん',
		age: 5,
		birthDate: '2020-06-10',
		theme: 'pink',
		uiMode: getDefaultUiMode(5),
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2025-09-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	// 903 — 小学生 (男): green テーマ
	{
		id: 903,
		nickname: 'けんたくん',
		age: 8,
		birthDate: '2018-03-22',
		theme: 'green',
		uiMode: getDefaultUiMode(8),
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	// 904 — 中学生 (女): purple テーマ
	{
		id: 904,
		nickname: 'さくらちゃん',
		age: 14,
		birthDate: '2011-08-05',
		theme: 'purple',
		uiMode: getDefaultUiMode(14),
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	// 906 — 高校生 (男): orange テーマ (旧 'ゆうき' は user 家族実名のため 'けいすけ' に変更 2026-05-16)
	{
		id: 906,
		nickname: 'けいすけくん',
		age: 17,
		birthDate: '2008-11-20',
		theme: 'orange',
		uiMode: getDefaultUiMode(17),
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
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
		gradeLevel: null,
		subcategory: null,
		description: '這う・伝い歩きなど基本運動',
		nameKana: 'はいはいした',
		nameKanji: null,
		triggerHint: 'マットで はいはい してみよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		gradeLevel: null,
		subcategory: null,
		description: '歩行の練習・伝い歩き',
		nameKana: 'あんよした',
		nameKanji: null,
		triggerHint: 'てを つないで あるいてみよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		gradeLevel: null,
		subcategory: null,
		description: '戸外で外気に触れ体を動かす',
		nameKana: 'おそとにでた',
		nameKanji: null,
		triggerHint: 'おそとの かぜを かんじよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'must',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'must',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		nameKanji: '片付けした',
		triggerHint: 'あそんだあと おかたづけ！',
		priority: 'must',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		nameKanji: '早起きした',
		triggerHint: 'あさ じかんどおりに おきよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		nameKanji: 'お手伝いした',
		triggerHint: 'おうちの おてつだい してみよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		gradeLevel: null,
		subcategory: null,
		description: '離乳食・幼児食を食べる',
		nameKana: 'ごはんをたべた',
		nameKanji: null,
		triggerHint: 'もぐもぐ ごはんを たべよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		nameKanji: '挨拶した',
		triggerHint: 'おはよう、ありがとう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		nameKanji: '一緒に遊んだ',
		triggerHint: 'おともだちと あそぼう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		gradeLevel: null,
		subcategory: null,
		description: '笑顔のコミュニケーション',
		nameKana: 'にこにこした',
		nameKanji: null,
		triggerHint: 'にこにこ えがおを みせよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		nameKanji: '工作した',
		triggerHint: 'はさみや のりで つくろう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
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
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
	},

	// ============================================================
	// senior 専用 (age 16+) — #1147 中高生差別化
	// ============================================================
	{
		id: 50,
		name: '大学受験勉強した',
		categoryId: 2,
		icon: '🎯',
		basePoints: 25,
		ageMin: 16,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 10,
		source: 'pack',
		gradeLevel: 'high_school',
		subcategory: null,
		description: '大学受験・共通テスト対策',
		nameKana: 'だいがくじゅけんべんきょうした',
		nameKanji: '大学受験勉強した',
		triggerHint: '志望校合格に向けて勉強しよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
	},
	{
		id: 51,
		name: 'アルバイトした',
		categoryId: 3,
		icon: '💼',
		basePoints: 20,
		ageMin: 16,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 10,
		source: 'pack',
		gradeLevel: 'high_school',
		subcategory: null,
		description: 'アルバイト・社会経験',
		nameKana: 'あるばいとした',
		nameKanji: 'アルバイトした',
		triggerHint: '社会経験を積もう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
	},
	{
		id: 52,
		name: '自動車学校',
		categoryId: 2,
		icon: '🚗',
		basePoints: 15,
		ageMin: 17,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 11,
		source: 'pack',
		gradeLevel: 'high_school',
		subcategory: null,
		description: '自動車学校・教習所',
		nameKana: 'じどうしゃがっこう',
		nameKanji: '自動車学校',
		triggerHint: '運転免許取得に向けて頑張ろう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
	},
	{
		id: 53,
		name: '進路相談',
		categoryId: 4,
		icon: '🎓',
		basePoints: 15,
		ageMin: 16,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 7,
		source: 'pack',
		gradeLevel: 'high_school',
		subcategory: null,
		description: '進路について先生・家族と相談',
		nameKana: 'しんろそうだん',
		nameKanji: '進路相談',
		triggerHint: '将来について話してみよう！',
		priority: 'optional',
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
	},
];

// ============================================================
// DEMO_CHILD_ACTIVITIES — per-child instance fixture (#2362 PR-3 / ADR-0055)
// ============================================================
// per-child instance (child_activities table) の demo fixture。
// Phase 7 で旧 `activities` table drop + FK 切替後、ChildActivity ベースの
// 一覧 / カウント API が本 fixture を直接参照する。
//
// 設計原則 (ADR-0055):
//   - childId NOT NULL (cross-child access を構造的に防ぐ)
//   - 旧 master Activity から代表 5-7 件を各 child に instance 化
//   - sourcePresetId: 'demo:<master.id>' で master と紐付け
//
// id 体系: child_id * 10_000 + offset
//   901: 9010001 - 9010099 (たろうくん baby)
//   902: 9020001 - 9020099 (ひなちゃん preschool)
//   903: 9030001 - 9030099 (けんたくん elementary)
//   904: 9040001 - 9040099 (さくらちゃん junior)
//   906: 9060001 - 9060099 (けいすけくん senior)
//
// 並存原則: Phase 6 段階では DEMO_ACTIVITIES (旧 master) と本 fixture が併存。
// child-activity-repo (demo Lambda 実装) は本 fixture を優先参照し、未定義 child は
// 旧 master を per-child 投影する legacy fallback で動作継続。

function buildChildActivity(spec: {
	id: number;
	childId: number;
	sourceMasterId: number;
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	isMainQuest?: boolean;
	priority?: 'must' | 'optional';
	sortOrder?: number;
}): ChildActivity {
	return {
		id: spec.id,
		childId: spec.childId,
		name: spec.name,
		categoryId: spec.categoryId,
		icon: spec.icon,
		basePoints: spec.basePoints,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: spec.sortOrder ?? 0,
		source: 'demo-per-child',
		nameKana: null,
		nameKanji: null,
		triggerHint: null,
		isMainQuest: spec.isMainQuest ? 1 : 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
		sourcePresetId: `demo:${spec.sourceMasterId}`,
		priority: spec.priority ?? 'optional',
	};
}

export const DEMO_CHILD_ACTIVITIES: ChildActivity[] = [
	// 901 たろうくん (baby M, age 1) — baby 基本動作 3 件
	buildChildActivity({
		id: 9010001,
		childId: 901,
		sourceMasterId: 1,
		name: 'はいはいした',
		categoryId: 1,
		icon: '🐣',
		basePoints: 3,
		sortOrder: 1,
	}),
	buildChildActivity({
		id: 9010002,
		childId: 901,
		sourceMasterId: 2,
		name: 'あんよした',
		categoryId: 1,
		icon: '👣',
		basePoints: 5,
		sortOrder: 2,
	}),
	buildChildActivity({
		id: 9010003,
		childId: 901,
		sourceMasterId: 10,
		name: 'えほんをよんだ',
		categoryId: 2,
		icon: '📖',
		basePoints: 5,
		sortOrder: 3,
	}),

	// 902 ひなちゃん (preschool F, age 5) — 幼児期 5 件 (うち must 1 件 = はみがき)
	buildChildActivity({
		id: 9020001,
		childId: 902,
		sourceMasterId: 4,
		name: 'からだをうごかした',
		categoryId: 1,
		icon: '🤸',
		basePoints: 5,
		sortOrder: 1,
	}),
	buildChildActivity({
		id: 9020002,
		childId: 902,
		sourceMasterId: 10,
		name: 'えほんをよんだ',
		categoryId: 2,
		icon: '📖',
		basePoints: 5,
		sortOrder: 2,
	}),
	buildChildActivity({
		id: 9020003,
		childId: 902,
		sourceMasterId: 25,
		name: 'おてつだいした',
		categoryId: 3,
		icon: '🧹',
		basePoints: 6,
		sortOrder: 3,
	}),
	buildChildActivity({
		id: 9020004,
		childId: 902,
		sourceMasterId: 30,
		name: 'あいさつした',
		categoryId: 4,
		icon: '👋',
		basePoints: 3,
		sortOrder: 4,
	}),
	buildChildActivity({
		id: 9020005,
		childId: 902,
		sourceMasterId: 35,
		name: 'はみがきした',
		categoryId: 3,
		icon: '🪥',
		basePoints: 5,
		priority: 'must',
		sortOrder: 5,
	}),

	// 903 けんたくん (elementary M, age 8) — 小学生 6 件 (うち main quest 1 件 + must 1 件)
	buildChildActivity({
		id: 9030001,
		childId: 903,
		sourceMasterId: 7,
		name: 'うんどうした',
		categoryId: 1,
		icon: '⚽',
		basePoints: 8,
		sortOrder: 1,
	}),
	buildChildActivity({
		id: 9030002,
		childId: 903,
		sourceMasterId: 13,
		name: 'しゅくだいをした',
		categoryId: 2,
		icon: '📝',
		basePoints: 10,
		priority: 'must',
		sortOrder: 2,
	}),
	buildChildActivity({
		id: 9030003,
		childId: 903,
		sourceMasterId: 40,
		name: 'おえかきした',
		categoryId: 5,
		icon: '🎨',
		basePoints: 5,
		sortOrder: 3,
	}),
	buildChildActivity({
		id: 9030004,
		childId: 903,
		sourceMasterId: 25,
		name: 'おてつだいした',
		categoryId: 3,
		icon: '🧹',
		basePoints: 6,
		sortOrder: 4,
	}),
	buildChildActivity({
		id: 9030005,
		childId: 903,
		sourceMasterId: 30,
		name: 'あいさつした',
		categoryId: 4,
		icon: '👋',
		basePoints: 3,
		sortOrder: 5,
	}),
	buildChildActivity({
		id: 9030006,
		childId: 903,
		sourceMasterId: 43,
		name: 'ピアノれんしゅう',
		categoryId: 5,
		icon: '🎹',
		basePoints: 10,
		isMainQuest: true,
		sortOrder: 6,
	}),

	// 904 さくらちゃん (junior F, age 14) — 中学生 5 件 (受験 / 検定中心)
	buildChildActivity({
		id: 9040001,
		childId: 904,
		sourceMasterId: 7,
		name: '運動した',
		categoryId: 1,
		icon: '🏃',
		basePoints: 8,
		sortOrder: 1,
	}),
	buildChildActivity({
		id: 9040002,
		childId: 904,
		sourceMasterId: 13,
		name: '宿題をした',
		categoryId: 2,
		icon: '📚',
		basePoints: 10,
		priority: 'must',
		sortOrder: 2,
	}),
	buildChildActivity({
		id: 9040003,
		childId: 904,
		sourceMasterId: 17,
		name: '受験勉強した',
		categoryId: 2,
		icon: '✏️',
		basePoints: 15,
		isMainQuest: true,
		sortOrder: 3,
	}),
	buildChildActivity({
		id: 9040004,
		childId: 904,
		sourceMasterId: 18,
		name: '資格・検定の勉強',
		categoryId: 2,
		icon: '📖',
		basePoints: 12,
		sortOrder: 4,
	}),
	buildChildActivity({
		id: 9040005,
		childId: 904,
		sourceMasterId: 22,
		name: '部活がんばった',
		categoryId: 1,
		icon: '🏃‍♀️',
		basePoints: 8,
		sortOrder: 5,
	}),

	// 906 けいすけくん (senior M, age 17) — 高校生 5 件 (大学受験 / アルバイト)
	buildChildActivity({
		id: 9060001,
		childId: 906,
		sourceMasterId: 7,
		name: '運動した',
		categoryId: 1,
		icon: '🏃',
		basePoints: 8,
		sortOrder: 1,
	}),
	buildChildActivity({
		id: 9060002,
		childId: 906,
		sourceMasterId: 50,
		name: '大学受験勉強した',
		categoryId: 2,
		icon: '🎓',
		basePoints: 20,
		isMainQuest: true,
		priority: 'must',
		sortOrder: 2,
	}),
	buildChildActivity({
		id: 9060003,
		childId: 906,
		sourceMasterId: 51,
		name: 'アルバイトした',
		categoryId: 4,
		icon: '💼',
		basePoints: 15,
		sortOrder: 3,
	}),
	buildChildActivity({
		id: 9060004,
		childId: 906,
		sourceMasterId: 18,
		name: '資格・検定の勉強',
		categoryId: 2,
		icon: '📖',
		basePoints: 12,
		sortOrder: 4,
	}),
	buildChildActivity({
		id: 9060005,
		childId: 906,
		sourceMasterId: 52,
		name: '自動車学校',
		categoryId: 4,
		icon: '🚗',
		basePoints: 18,
		sortOrder: 5,
	}),
];

// ============================================================
// Activity Logs (recent 14 days for each child)
// ============================================================

// Use fixed seed approach for deterministic data
export const DEMO_ACTIVITY_LOGS: ActivityLog[] = [
	// 901 たろうくん (baby, age 1) — simple logs
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
	// 902 ひなちゃん (preschool, age 5) — moderate activity
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
	// 903 けんたくん (elementary, age 8) — active with variety
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
	// 904 さくらちゃん (junior, age 14) — very active, all categories
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
	// 906 けいすけくん (senior, age 17) — very active, senior 専用活動中心
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((d, i) => [
		{
			id: 906001 + i * 5,
			childId: 906,
			activityId: 50, // 大学受験勉強した (senior 専用)
			points: 35,
			streakDays: 14,
			streakBonus: 12,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 906002 + i * 5,
			childId: 906,
			activityId: 51, // アルバイトした (senior 専用)
			points: 28,
			streakDays: 10,
			streakBonus: 8,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 906003 + i * 5,
			childId: 906,
			activityId: 18, // 資格・検定の勉強
			points: 25,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 906004 + i * 5,
			childId: 906,
			activityId: 52, // 自動車学校 (senior 専用)
			points: 20,
			streakDays: 7,
			streakBonus: 5,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 906005 + i * 5,
			childId: 906,
			activityId: 7, // 運動した
			points: 20,
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
	// 901 たろうくん (baby, Lv.2) — 15 XP 程度
	{ id: 9011, childId: 901, categoryId: 1, totalXp: 20, level: 2, peakXp: 20, updatedAt: NOW },
	{ id: 9012, childId: 901, categoryId: 2, totalXp: 10, level: 1, peakXp: 10, updatedAt: NOW },
	{ id: 9013, childId: 901, categoryId: 3, totalXp: 25, level: 2, peakXp: 25, updatedAt: NOW },
	{ id: 9014, childId: 901, categoryId: 4, totalXp: 12, level: 1, peakXp: 12, updatedAt: NOW },
	{ id: 9015, childId: 901, categoryId: 5, totalXp: 18, level: 2, peakXp: 18, updatedAt: NOW },
	// 902 ひなちゃん (preschool, Lv.4) — 80-140 XP
	{ id: 9021, childId: 902, categoryId: 1, totalXp: 120, level: 4, peakXp: 120, updatedAt: NOW },
	{ id: 9022, childId: 902, categoryId: 2, totalXp: 90, level: 4, peakXp: 90, updatedAt: NOW },
	{ id: 9023, childId: 902, categoryId: 3, totalXp: 75, level: 3, peakXp: 75, updatedAt: NOW },
	{ id: 9024, childId: 902, categoryId: 4, totalXp: 55, level: 3, peakXp: 55, updatedAt: NOW },
	{ id: 9025, childId: 902, categoryId: 5, totalXp: 100, level: 4, peakXp: 100, updatedAt: NOW },
	// 903 けんたくん (elementary, Lv.7) — 275-500 XP
	{ id: 9031, childId: 903, categoryId: 1, totalXp: 450, level: 9, peakXp: 450, updatedAt: NOW },
	{ id: 9032, childId: 903, categoryId: 2, totalXp: 350, level: 8, peakXp: 350, updatedAt: NOW },
	{ id: 9033, childId: 903, categoryId: 3, totalXp: 300, level: 7, peakXp: 300, updatedAt: NOW },
	{ id: 9034, childId: 903, categoryId: 4, totalXp: 200, level: 6, peakXp: 200, updatedAt: NOW },
	{ id: 9035, childId: 903, categoryId: 5, totalXp: 280, level: 7, peakXp: 280, updatedAt: NOW },
	// 904 さくらちゃん (junior, Lv.15+) — 1200-2500 XP
	{ id: 9041, childId: 904, categoryId: 1, totalXp: 2000, level: 18, peakXp: 2000, updatedAt: NOW },
	{ id: 9042, childId: 904, categoryId: 2, totalXp: 2500, level: 20, peakXp: 2500, updatedAt: NOW },
	{ id: 9043, childId: 904, categoryId: 3, totalXp: 1200, level: 15, peakXp: 1200, updatedAt: NOW },
	{ id: 9044, childId: 904, categoryId: 4, totalXp: 800, level: 10, peakXp: 800, updatedAt: NOW },
	{ id: 9045, childId: 904, categoryId: 5, totalXp: 1800, level: 17, peakXp: 1800, updatedAt: NOW },
	// 906 けいすけくん (senior, Lv.20+) — 2000-3000 XP
	{ id: 9061, childId: 906, categoryId: 1, totalXp: 2800, level: 22, peakXp: 2800, updatedAt: NOW },
	{ id: 9062, childId: 906, categoryId: 2, totalXp: 3000, level: 23, peakXp: 3000, updatedAt: NOW },
	{ id: 9063, childId: 906, categoryId: 3, totalXp: 2200, level: 19, peakXp: 2200, updatedAt: NOW },
	{ id: 9064, childId: 906, categoryId: 4, totalXp: 2000, level: 18, peakXp: 2000, updatedAt: NOW },
	{ id: 9065, childId: 906, categoryId: 5, totalXp: 2500, level: 20, peakXp: 2500, updatedAt: NOW },
];

// ============================================================
// Point Balances (computed from logs)
// ============================================================

export const DEMO_POINT_BALANCES: Record<number, number> = {
	901: 180, // たろうくん (baby) — low
	902: 1250, // ひなちゃん (preschool) — moderate
	903: 3400, // けんた (elementary) — active
	904: 8500, // さくら (junior) — very active
	906: 12000, // けいすけくん (senior) — most active
};

// ============================================================
// Achievements
// ============================================================

export const DEMO_CHILD_ACHIEVEMENTS: ChildAchievement[] = [
	// 902 ひなちゃん (preschool)
	{ id: 1, childId: 902, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(20) },
	{ id: 2, childId: 902, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(15) },
	// 903 けんた (elementary)
	{ id: 3, childId: 903, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(60) },
	{ id: 4, childId: 903, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(50) },
	{ id: 5, childId: 903, achievementId: 2, milestoneValue: 50, unlockedAt: daysAgoISO(30) },
	{ id: 6, childId: 903, achievementId: 3, milestoneValue: null, unlockedAt: daysAgoISO(25) },
	{ id: 7, childId: 903, achievementId: 4, milestoneValue: null, unlockedAt: daysAgoISO(10) },
	// 904 さくら (junior)
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
	// 902 ひなちゃん (preschool, age 5) — 3 missions, 1 done
	{ id: 1, childId: 902, missionDate: TODAY, activityId: 4, completed: 1, completedAt: NOW }, // からだをうごかした
	{ id: 2, childId: 902, missionDate: TODAY, activityId: 10, completed: 0, completedAt: null }, // えほんをよんだ
	{ id: 3, childId: 902, missionDate: TODAY, activityId: 30, completed: 0, completedAt: null }, // あいさつした
	// 903 けんた (elementary, age 8) — 3 missions, 2 done
	{ id: 4, childId: 903, missionDate: TODAY, activityId: 13, completed: 1, completedAt: NOW }, // しゅくだいをした
	{ id: 5, childId: 903, missionDate: TODAY, activityId: 7, completed: 1, completedAt: NOW }, // うんどうした
	{ id: 6, childId: 903, missionDate: TODAY, activityId: 40, completed: 0, completedAt: null }, // おえかきした
	// 904 さくら (junior, age 14) — 3 missions, all done
	{ id: 7, childId: 904, missionDate: TODAY, activityId: 7, completed: 1, completedAt: NOW }, // うんどうした
	{ id: 8, childId: 904, missionDate: TODAY, activityId: 17, completed: 1, completedAt: NOW }, // 受験勉強した
	{ id: 9, childId: 904, missionDate: TODAY, activityId: 43, completed: 1, completedAt: NOW }, // ピアノれんしゅう
	// 906 けいすけくん (senior, age 17) — 3 missions, 2 done (senior 専用: 大学受験 + アルバイト)
	{ id: 13, childId: 906, missionDate: TODAY, activityId: 50, completed: 1, completedAt: NOW }, // 大学受験勉強した
	{ id: 14, childId: 906, missionDate: TODAY, activityId: 51, completed: 1, completedAt: NOW }, // アルバイトした
	{ id: 15, childId: 906, missionDate: TODAY, activityId: 52, completed: 0, completedAt: null }, // 自動車学校
];

// ============================================================
// Auto Challenges (weekly auto-generated per-child challenges)
// #2097 Phase B-4: demo fixture for IAutoChallengeRepo
// ============================================================
//
// 設計メモ:
// - weekStart は実行時の「今週月曜」を起点にする必要がある
//   （auto-challenge-service.ts は getWeekStart(new Date()) を呼ぶ）。
//   demo-data.ts は ESM module-init で 1 回だけ評価され、その後 immutable に扱われる
//   (ADR-0048 §決定 §2)。runtime mutation は行わない。
// - 901 (baby, age 1) は ADR-0011 により「親の準備モード」のため自動チャレンジ対象外
// - カテゴリ ID: 1=うんどう / 2=べんきょう / 3=せいかつ / 4=こうりゅう / 5=そうぞう
//   (auto-challenge-service.ts CATEGORY_NAMES と一致)
// - 各子供に「当週 active 1 件」+「過去 1-2 週分 completed」を配置し
//   achievements page (`getActiveChallenge` + `getChallengeHistory`) が
//   永久に空にならないことを保証する。

/** Current week Monday (YYYY-MM-DD), evaluated once at module init */
function currentWeekMonday(): string {
	const d = new Date();
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function weekStartOffset(weeksAgo: number): string {
	const d = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() - weeksAgo * 7);
	return d.toISOString().slice(0, 10);
}

const DEMO_WEEK_CURRENT = currentWeekMonday();
const DEMO_WEEK_LAST = weekStartOffset(1);
const DEMO_WEEK_2AGO = weekStartOffset(2);

// ID scheme: <childId>_<weekIndex>0 (e.g., 9020 = 902 current week, 9021 = 902 1 week ago)
export const DEMO_AUTO_CHALLENGES: AutoChallenge[] = [
	// 902 ひなちゃん (preschool, age 5)
	// 当週: こうりゅう (weak category — daily missions の あいさつ 未達示唆) 進捗 1/3
	{
		id: 9020,
		childId: 902,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_CURRENT,
		categoryId: 4,
		targetCount: 3,
		currentCount: 1,
		status: 'active',
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 先週: うんどう (streak-bonus 風) 完了
	{
		id: 9021,
		childId: 902,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_LAST,
		categoryId: 1,
		targetCount: 3,
		currentCount: 3,
		status: 'completed',
		createdAt: NOW,
		updatedAt: NOW,
	},

	// 903 けんたくん (elementary, age 8)
	// 当週: そうぞう (weak — おえかき 未達) 進捗 2/4
	{
		id: 9030,
		childId: 903,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_CURRENT,
		categoryId: 5,
		targetCount: 4,
		currentCount: 2,
		status: 'active',
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 先週: せいかつ (category-weak) 完了
	{
		id: 9031,
		childId: 903,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_LAST,
		categoryId: 3,
		targetCount: 4,
		currentCount: 4,
		status: 'completed',
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 2 週前: べんきょう 完了 (履歴の厚み演出)
	{
		id: 9032,
		childId: 903,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_2AGO,
		categoryId: 2,
		targetCount: 3,
		currentCount: 3,
		status: 'completed',
		createdAt: NOW,
		updatedAt: NOW,
	},

	// 904 さくらちゃん (junior, age 14)
	// 当週: うんどう (junior は受験勉強偏重で運動が weak) 進捗 3/5
	{
		id: 9040,
		childId: 904,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_CURRENT,
		categoryId: 1,
		targetCount: 5,
		currentCount: 3,
		status: 'active',
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 先週: こうりゅう (streak-bonus) 完了
	{
		id: 9041,
		childId: 904,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_LAST,
		categoryId: 4,
		targetCount: 5,
		currentCount: 5,
		status: 'completed',
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 2 週前: そうぞう 完了
	{
		id: 9042,
		childId: 904,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_2AGO,
		categoryId: 5,
		targetCount: 4,
		currentCount: 4,
		status: 'completed',
		createdAt: NOW,
		updatedAt: NOW,
	},

	// 906 けいすけくん (senior, age 17)
	// 当週: せいかつ (senior は大学受験 + アルバイトで生活管理が weak) 進捗 2/5
	{
		id: 9060,
		childId: 906,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_CURRENT,
		categoryId: 3,
		targetCount: 5,
		currentCount: 2,
		status: 'active',
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 先週: べんきょう (大学受験で常時 active な category) 完了
	{
		id: 9061,
		childId: 906,
		tenantId: DEMO_TENANT_ID,
		weekStart: DEMO_WEEK_LAST,
		categoryId: 2,
		targetCount: 6,
		currentCount: 6,
		status: 'completed',
		createdAt: NOW,
		updatedAt: NOW,
	},
];

// ============================================================
// Checklist Templates
// ============================================================

export const DEMO_CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
	// #1755 (#1709-A): kind 削除 — 持ち物純化
	//   旧 kind='routine' のテンプレート (901 あさのしたく / 902 よるのじゅんび) は削除
	//   ルーティン的なふるまいは後続 sub-issue (#1709-B/C) で activities.priority='must' へ役割移管予定
	// 残存パターン (持ち物系のみ):
	// baby (901 たろう) → おでかけのじゅんび
	// junior (904 さくら) → 中学生の登校準備
	// senior (906 けいすけくん) → 高校生の登校準備
	{
		id: 900,
		childId: 901,
		name: 'おでかけのじゅんび',
		icon: '🍼',
		pointsPerItem: 2,
		completionBonus: 5,
		timeSlot: 'morning',
		isActive: 1,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 904,
		childId: 904,
		name: '中学生の登校準備',
		icon: '🎒',
		pointsPerItem: 3,
		completionBonus: 10,
		timeSlot: 'morning',
		isActive: 1,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 905,
		childId: 906,
		name: '高校生の登校準備',
		icon: '📚',
		pointsPerItem: 3,
		completionBonus: 10,
		timeSlot: 'morning',
		isActive: 1,
		isArchived: 0,
		archivedReason: null,
		createdAt: NOW,
		updatedAt: NOW,
	},
];

export const DEMO_CHECKLIST_ITEMS: ChecklistTemplateItem[] = [
	// #1755 (#1709-A): kind 削除 — テンプレート 901 (あさのしたく) / 902 (よるのじゅんび) は kind='routine' のため削除済み
	//   それぞれの item (id 1-9) も併せて削除した。後続 sub-issue (#1709-C) で activities.priority='must' に役割移管予定
	// #703: おでかけのじゅんび（たろう・乳幼児）
	{
		id: 20,
		templateId: 900,
		name: 'おむつ',
		icon: '👶',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 21,
		templateId: 900,
		name: 'おしりふき',
		icon: '🧻',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 22,
		templateId: 900,
		name: 'きがえ',
		icon: '👕',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 23,
		templateId: 900,
		name: 'ぼうし',
		icon: '🧢',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
	{
		id: 24,
		templateId: 900,
		name: 'みずとう',
		icon: '🍼',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 5,
		createdAt: NOW,
	},
	// #703: 中学生の登校準備（さくら・中学生）
	{
		id: 30,
		templateId: 904,
		name: '教科書',
		icon: '📕',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 31,
		templateId: 904,
		name: 'ノート',
		icon: '📒',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 32,
		templateId: 904,
		name: '体操着',
		icon: '👕',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 33,
		templateId: 904,
		name: '制服',
		icon: '🎽',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
	{
		id: 34,
		templateId: 904,
		name: 'お弁当',
		icon: '🍱',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 5,
		createdAt: NOW,
	},
	// #703: 高校生の登校準備（けいすけくん・高校生）
	{
		id: 40,
		templateId: 905,
		name: '教科書',
		icon: '📕',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 41,
		templateId: 905,
		name: 'ノート',
		icon: '📒',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 42,
		templateId: 905,
		name: '参考書',
		icon: '📖',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 43,
		templateId: 905,
		name: 'お弁当',
		icon: '🍱',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
	{
		id: 44,
		templateId: 905,
		name: 'ICカード',
		icon: '💳',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 5,
		createdAt: NOW,
	},
];

// ============================================================
// Login Bonus
// ============================================================

export const DEMO_LOGIN_BONUSES: LoginBonus[] = [
	// 902 ひなちゃん (preschool)
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
	// 903 けんた (elementary)
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
	// 904 さくら (junior)
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
// Sibling Cheers (#2097 Phase B-5b)
// ============================================================
// きょうだい間で送受信した「おうえんスタンプ」履歴。
// 子供画面の SiblingCheerOverlay 等で表示される。
// fixture immutability 原則 (ADR-0048 §決定 §2) に従い shownAt は固定値。

// stampCode は services/sibling-cheer-service.ts の CHEER_STAMPS と整合:
// ganbare / sugoi / issho / omedeto / nice / fight
export const DEMO_SIBLING_CHEERS: SiblingCheer[] = [
	// ── 過去履歴 (shownAt 設定済み) ──
	// 903 けんた → 902 ひな (兄から妹へ)
	{
		id: 1,
		fromChildId: 903,
		toChildId: 902,
		stampCode: 'ganbare',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(2),
		shownAt: daysAgoISO(2),
	},
	// 904 さくら → 902 ひな (姉から妹へ)
	{
		id: 2,
		fromChildId: 904,
		toChildId: 902,
		stampCode: 'omedeto',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(2),
		shownAt: daysAgoISO(2),
	},
	// 902 ひな → 903 けんた (妹から兄へ)
	{
		id: 3,
		fromChildId: 902,
		toChildId: 903,
		stampCode: 'sugoi',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(3),
		shownAt: daysAgoISO(3),
	},
	// 904 さくら → 903 けんた (姉から弟へ)
	{
		id: 4,
		fromChildId: 904,
		toChildId: 903,
		stampCode: 'nice',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(3),
		shownAt: daysAgoISO(3),
	},
	// 906 けいすけ → 904 さくら (兄から妹へ)
	{
		id: 5,
		fromChildId: 906,
		toChildId: 904,
		stampCode: 'fight',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(4),
		shownAt: daysAgoISO(4),
	},
	// ── 未表示 (shownAt: null) — demo 子供画面でおうえん受信演出が確認可能 ──
	// 903 → 902 (直近)
	{
		id: 6,
		fromChildId: 903,
		toChildId: 902,
		stampCode: 'issho',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(0),
		shownAt: null,
	},
	// 906 → 903 (直近)
	{
		id: 7,
		fromChildId: 906,
		toChildId: 903,
		stampCode: 'sugoi',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(0),
		shownAt: null,
	},
	// 902 → 904 (直近)
	{
		id: 8,
		fromChildId: 902,
		toChildId: 904,
		stampCode: 'ganbare',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(0),
		shownAt: null,
	},
	// 903 → 906 (直近)
	{
		id: 9,
		fromChildId: 903,
		toChildId: 906,
		stampCode: 'nice',
		tenantId: DEMO_TENANT_ID,
		sentAt: daysAgoISO(0),
		shownAt: null,
	},
];

// ============================================================
// Sibling Challenges (#2097 Phase B-5b)
// ============================================================
// きょうだい全員で取り組む協力チャレンジ + 完了済み実績。
// targetConfig / rewardConfig は services/sibling-challenge-service.ts の
// TargetConfig / RewardConfig 型と整合する JSON 文字列。

export const DEMO_SIBLING_CHALLENGES: SiblingChallenge[] = [
	// active: 今週のチャレンジ「みんなで合計 100 pt 達成」
	{
		id: 1,
		title: 'みんなで 100 ポイントチャレンジ',
		description: 'きょうだい全員のポイントを合算して 100 pt を目指そう！',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(2),
		endDate: daysAgo(-4), // 4 日後まで
		targetConfig: JSON.stringify({
			metric: 'count',
			baseTarget: 25,
			ageAdjustments: { '3': 15, '6': 25, '13': 30, '16': 30 },
		}),
		rewardConfig: JSON.stringify({
			points: 50,
			message: 'みんなでがんばったね！',
		}),
		status: 'active',
		isActive: 1,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(2),
	},
	// active: 「うんどう週間」カテゴリ縛り
	{
		id: 2,
		title: 'うんどう週間チャレンジ',
		description: '今週はみんなでうんどうカテゴリ 5 回ずつ達成しよう',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(1),
		endDate: daysAgo(-5),
		targetConfig: JSON.stringify({
			metric: 'count',
			categoryId: 1, // うんどう
			baseTarget: 5,
		}),
		rewardConfig: JSON.stringify({
			points: 30,
			message: 'みんなで体力アップ！',
		}),
		status: 'active',
		isActive: 1,
		createdAt: daysAgoISO(1),
		updatedAt: daysAgoISO(1),
	},
	// completed: 先週のチャレンジ
	{
		id: 3,
		title: '先週のべんきょうチャレンジ',
		description: 'べんきょう 30 回達成チャレンジ',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(10),
		endDate: daysAgo(3),
		targetConfig: JSON.stringify({
			metric: 'count',
			categoryId: 2, // べんきょう
			baseTarget: 10,
		}),
		rewardConfig: JSON.stringify({
			points: 40,
			message: 'みんなで物知り博士！',
		}),
		status: 'completed',
		isActive: 0,
		createdAt: daysAgoISO(10),
		updatedAt: daysAgoISO(3),
	},
];

/** Sibling Challenge 進捗 (challenge × child) */
export const DEMO_SIBLING_CHALLENGE_PROGRESSES: SiblingChallengeProgress[] = [
	// Challenge 1 (active, baseTarget 25): 902/903/904/906 が enrolled
	{
		id: 1,
		challengeId: 1,
		childId: 902,
		currentValue: 12,
		targetValue: 15, // age-adjusted (5歳)
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	{
		id: 2,
		challengeId: 1,
		childId: 903,
		currentValue: 20,
		targetValue: 25, // age-adjusted (8歳)
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	{
		id: 3,
		challengeId: 1,
		childId: 904,
		currentValue: 25,
		targetValue: 30, // age-adjusted (14歳)
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	{
		id: 4,
		challengeId: 1,
		childId: 906,
		currentValue: 28,
		targetValue: 30, // age-adjusted (17歳)
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	// Challenge 2 (active うんどう、baseTarget 5)
	{
		id: 5,
		challengeId: 2,
		childId: 902,
		currentValue: 2,
		targetValue: 5,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	{
		id: 6,
		challengeId: 2,
		childId: 903,
		currentValue: 3,
		targetValue: 5,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	{
		id: 7,
		challengeId: 2,
		childId: 904,
		currentValue: 5,
		targetValue: 5,
		completed: 1,
		completedAt: daysAgoISO(1),
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	{
		id: 8,
		challengeId: 2,
		childId: 906,
		currentValue: 4,
		targetValue: 5,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		progressJson: null,
		updatedAt: daysAgoISO(1),
	},
	// Challenge 3 (completed): 全員達成済み
	{
		id: 9,
		challengeId: 3,
		childId: 903,
		currentValue: 10,
		targetValue: 10,
		completed: 1,
		completedAt: daysAgoISO(3),
		rewardClaimed: 1,
		rewardClaimedAt: daysAgoISO(3),
		progressJson: null,
		updatedAt: daysAgoISO(3),
	},
	{
		id: 10,
		challengeId: 3,
		childId: 904,
		currentValue: 12,
		targetValue: 10,
		completed: 1,
		completedAt: daysAgoISO(4),
		rewardClaimed: 1,
		rewardClaimedAt: daysAgoISO(3),
		progressJson: null,
		updatedAt: daysAgoISO(3),
	},
	{
		id: 11,
		challengeId: 3,
		childId: 906,
		currentValue: 15,
		targetValue: 10,
		completed: 1,
		completedAt: daysAgoISO(5),
		rewardClaimed: 1,
		rewardClaimedAt: daysAgoISO(3),
		progressJson: null,
		updatedAt: daysAgoISO(3),
	},
];

// ============================================================
// Child Challenges (#2362 PR-7、ADR-0055、User §6)
// ============================================================
// 旧 DEMO_SIBLING_CHALLENGES (family-wide + 別 progress 配列) を per-child instance に flip。
// 同じ sourceTemplateId を持つ instance が admin/challenges 画面で
// SiblingChallengeComparison により兄弟連動表示される。
// 902 (ひなちゃん 5歳) と 903 (けんたくん 8歳) と 904 (さくらちゃん 14歳) が
// 「みんなで 100 ポイントチャレンジ」を共有 (兄弟連動 UX デモ)。

export const DEMO_CHILD_CHALLENGES: ChildChallenge[] = [
	// 兄弟連動 instance: 902 ひなちゃん版 (5歳 age-adjusted target 15)
	{
		id: 101,
		childId: 902,
		title: 'みんなで 100 ポイントチャレンジ',
		description: 'きょうだいで力を合わせて 100 pt を目指そう！',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(2),
		endDate: daysAgo(-4),
		targetConfig: JSON.stringify({ metric: 'count', baseTarget: 15 }),
		rewardConfig: JSON.stringify({ points: 50, message: 'みんなでがんばったね！' }),
		status: 'active',
		isActive: 1,
		sourceTemplateId: 'challenge-100pt',
		currentValue: 12,
		targetValue: 15,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(1),
	},
	// 兄弟連動 instance: 903 けんたくん版 (8歳 age-adjusted target 25)
	{
		id: 102,
		childId: 903,
		title: 'みんなで 100 ポイントチャレンジ',
		description: 'きょうだいで力を合わせて 100 pt を目指そう！',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(2),
		endDate: daysAgo(-4),
		targetConfig: JSON.stringify({ metric: 'count', baseTarget: 25 }),
		rewardConfig: JSON.stringify({ points: 50, message: 'みんなでがんばったね！' }),
		status: 'active',
		isActive: 1,
		sourceTemplateId: 'challenge-100pt',
		currentValue: 20,
		targetValue: 25,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(1),
	},
	// 兄弟連動 instance: 904 さくらちゃん版 (14歳 age-adjusted target 30)
	{
		id: 103,
		childId: 904,
		title: 'みんなで 100 ポイントチャレンジ',
		description: 'きょうだいで力を合わせて 100 pt を目指そう！',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(2),
		endDate: daysAgo(-4),
		targetConfig: JSON.stringify({ metric: 'count', baseTarget: 30 }),
		rewardConfig: JSON.stringify({ points: 50, message: 'みんなでがんばったね！' }),
		status: 'active',
		isActive: 1,
		sourceTemplateId: 'challenge-100pt',
		currentValue: 28,
		targetValue: 30,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(1),
	},
	// 個別 instance: 903 けんたくんの「うんどう週間チャレンジ」(兄弟連動なし)
	{
		id: 104,
		childId: 903,
		title: 'うんどう週間チャレンジ',
		description: 'うんどうカテゴリを 5 回達成しよう',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: daysAgo(1),
		endDate: daysAgo(-5),
		targetConfig: JSON.stringify({ metric: 'count', categoryId: 1, baseTarget: 5 }),
		rewardConfig: JSON.stringify({ points: 30, message: 'たいりょくアップ！' }),
		status: 'active',
		isActive: 1,
		sourceTemplateId: null,
		currentValue: 3,
		targetValue: 5,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: daysAgoISO(1),
		updatedAt: daysAgoISO(0),
	},
];

// ============================================================
// Battles (#2097 Phase B-5b + battle fixture)
// ============================================================
// 日次バトル履歴。battle UI 対象の elementary/junior/senior 年齢 (903/904/906) を中心に
// 過去 5-7 日分の戦績 + 当日 active battle を持たせる。
// 902 (preschool) はバトル UI 対象外のため fixture なし。
// 901 (baby) も同様に対象外。

const DEFAULT_BATTLE_STATS_JSON = JSON.stringify({
	hp: 100,
	atk: 30,
	def: 20,
	spd: 25,
	rec: 15,
});

const STRONGER_BATTLE_STATS_JSON = JSON.stringify({
	hp: 150,
	atk: 45,
	def: 30,
	spd: 30,
	rec: 20,
});

const STRONGEST_BATTLE_STATS_JSON = JSON.stringify({
	hp: 200,
	atk: 60,
	def: 40,
	spd: 35,
	rec: 25,
});

export const DEMO_BATTLES: DailyBattleRow[] = [
	// ── 903 けんた (elementary) ──
	// 当日 (TODAY): pending
	{
		id: 9030,
		childId: 903,
		enemyId: 1,
		date: TODAY,
		status: 'pending',
		outcome: null,
		rewardPoints: 0,
		turnsUsed: 0,
		playerStatsJson: DEFAULT_BATTLE_STATS_JSON,
		createdAt: NOW,
		updatedAt: NOW,
	},
	// 過去 5 日: completed 履歴
	{
		id: 9031,
		childId: 903,
		enemyId: 1,
		date: daysAgo(1),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 20,
		turnsUsed: 5,
		playerStatsJson: DEFAULT_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(1),
		updatedAt: daysAgoISO(1),
	},
	{
		id: 9032,
		childId: 903,
		enemyId: 2,
		date: daysAgo(2),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 25,
		turnsUsed: 6,
		playerStatsJson: DEFAULT_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(2),
	},
	{
		id: 9033,
		childId: 903,
		enemyId: 3,
		date: daysAgo(3),
		status: 'completed',
		outcome: 'lose',
		rewardPoints: 5,
		turnsUsed: 8,
		playerStatsJson: DEFAULT_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(3),
		updatedAt: daysAgoISO(3),
	},
	{
		id: 9034,
		childId: 903,
		enemyId: 1,
		date: daysAgo(4),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 20,
		turnsUsed: 4,
		playerStatsJson: DEFAULT_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(4),
	},
	{
		id: 9035,
		childId: 903,
		enemyId: 2,
		date: daysAgo(5),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 25,
		turnsUsed: 5,
		playerStatsJson: DEFAULT_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(5),
		updatedAt: daysAgoISO(5),
	},
	// ── 904 さくら (junior) ──
	{
		id: 9040,
		childId: 904,
		enemyId: 4,
		date: TODAY,
		status: 'pending',
		outcome: null,
		rewardPoints: 0,
		turnsUsed: 0,
		playerStatsJson: STRONGER_BATTLE_STATS_JSON,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 9041,
		childId: 904,
		enemyId: 4,
		date: daysAgo(1),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 40,
		turnsUsed: 4,
		playerStatsJson: STRONGER_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(1),
		updatedAt: daysAgoISO(1),
	},
	{
		id: 9042,
		childId: 904,
		enemyId: 5,
		date: daysAgo(2),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 45,
		turnsUsed: 6,
		playerStatsJson: STRONGER_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(2),
	},
	{
		id: 9043,
		childId: 904,
		enemyId: 6,
		date: daysAgo(3),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 50,
		turnsUsed: 5,
		playerStatsJson: STRONGER_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(3),
		updatedAt: daysAgoISO(3),
	},
	{
		id: 9044,
		childId: 904,
		enemyId: 4,
		date: daysAgo(4),
		status: 'completed',
		outcome: 'lose',
		rewardPoints: 8,
		turnsUsed: 7,
		playerStatsJson: STRONGER_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(4),
	},
	{
		id: 9045,
		childId: 904,
		enemyId: 5,
		date: daysAgo(5),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 45,
		turnsUsed: 5,
		playerStatsJson: STRONGER_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(5),
		updatedAt: daysAgoISO(5),
	},
	// ── 906 けいすけ (senior) ──
	{
		id: 9060,
		childId: 906,
		enemyId: 7,
		date: TODAY,
		status: 'pending',
		outcome: null,
		rewardPoints: 0,
		turnsUsed: 0,
		playerStatsJson: STRONGEST_BATTLE_STATS_JSON,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 9061,
		childId: 906,
		enemyId: 7,
		date: daysAgo(1),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 60,
		turnsUsed: 3,
		playerStatsJson: STRONGEST_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(1),
		updatedAt: daysAgoISO(1),
	},
	{
		id: 9062,
		childId: 906,
		enemyId: 8,
		date: daysAgo(2),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 70,
		turnsUsed: 4,
		playerStatsJson: STRONGEST_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(2),
		updatedAt: daysAgoISO(2),
	},
	{
		id: 9063,
		childId: 906,
		enemyId: 9,
		date: daysAgo(3),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 80,
		turnsUsed: 5,
		playerStatsJson: STRONGEST_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(3),
		updatedAt: daysAgoISO(3),
	},
	{
		id: 9064,
		childId: 906,
		enemyId: 7,
		date: daysAgo(4),
		status: 'completed',
		outcome: 'win',
		rewardPoints: 60,
		turnsUsed: 4,
		playerStatsJson: STRONGEST_BATTLE_STATS_JSON,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(4),
	},
];

// ============================================================
// Evaluations (#2097 Phase B-5b)
// ============================================================
// 週次評価レポート (週次サマリー)。
// 全 5 子供 (901-906) の過去 4 週分。グラフ表示・推移確認用。
// scoresJson は services/evaluation-service.ts の categoryScores 型と整合する JSON 文字列:
//   Record<categoryId, { count, points, statusIncrease }>
//
// 週の区切り: 2026-03-27 (Friday) の週は 2026-03-23 (Mon) - 2026-03-29 (Sun)
// 過去 4 週: 当週 / -1 週 / -2 週 / -3 週

function weekStartDate(weeksAgo: number): string {
	// daysAgo(0) = 2026-03-27 (Fri). 当週月曜は 4 日前 = 2026-03-23
	const monOffset = weeksAgo * 7 + 4;
	return daysAgo(monOffset);
}

function weekEndDate(weeksAgo: number): string {
	// 当週日曜は 2 日後だが TODAY 基準で過去のみ扱うため、その週の月曜+6 日
	const monOffset = weeksAgo * 7 + 4;
	return daysAgo(monOffset - 6); // 月曜 + 6 = 日曜
}

function makeScoresJson(c1: number, c2: number, c3: number, c4: number, c5: number): string {
	return JSON.stringify({
		1: { count: c1, points: c1 * 10, statusIncrease: Math.floor(c1 / 2) },
		2: { count: c2, points: c2 * 10, statusIncrease: Math.floor(c2 / 2) },
		3: { count: c3, points: c3 * 10, statusIncrease: Math.floor(c3 / 2) },
		4: { count: c4, points: c4 * 10, statusIncrease: Math.floor(c4 / 2) },
		5: { count: c5, points: c5 * 10, statusIncrease: Math.floor(c5 / 2) },
	});
}

export const DEMO_EVALUATIONS: Evaluation[] = [
	// ── 901 たろうくん (baby) — 低頻度活動 ──
	{
		id: 9011,
		childId: 901,
		weekStart: weekStartDate(0),
		weekEnd: weekEndDate(0),
		scoresJson: makeScoresJson(2, 1, 3, 1, 2),
		bonusPoints: 5,
		createdAt: daysAgoISO(0),
	},
	{
		id: 9012,
		childId: 901,
		weekStart: weekStartDate(1),
		weekEnd: weekEndDate(1),
		scoresJson: makeScoresJson(1, 1, 2, 1, 1),
		bonusPoints: 3,
		createdAt: daysAgoISO(7),
	},
	{
		id: 9013,
		childId: 901,
		weekStart: weekStartDate(2),
		weekEnd: weekEndDate(2),
		scoresJson: makeScoresJson(2, 0, 2, 1, 2),
		bonusPoints: 3,
		createdAt: daysAgoISO(14),
	},
	{
		id: 9014,
		childId: 901,
		weekStart: weekStartDate(3),
		weekEnd: weekEndDate(3),
		scoresJson: makeScoresJson(1, 1, 1, 0, 1),
		bonusPoints: 2,
		createdAt: daysAgoISO(21),
	},
	// ── 902 ひなちゃん (preschool) ──
	{
		id: 9021,
		childId: 902,
		weekStart: weekStartDate(0),
		weekEnd: weekEndDate(0),
		scoresJson: makeScoresJson(5, 4, 3, 2, 4),
		bonusPoints: 15,
		createdAt: daysAgoISO(0),
	},
	{
		id: 9022,
		childId: 902,
		weekStart: weekStartDate(1),
		weekEnd: weekEndDate(1),
		scoresJson: makeScoresJson(4, 3, 3, 2, 3),
		bonusPoints: 12,
		createdAt: daysAgoISO(7),
	},
	{
		id: 9023,
		childId: 902,
		weekStart: weekStartDate(2),
		weekEnd: weekEndDate(2),
		scoresJson: makeScoresJson(3, 2, 2, 1, 3),
		bonusPoints: 8,
		createdAt: daysAgoISO(14),
	},
	{
		id: 9024,
		childId: 902,
		weekStart: weekStartDate(3),
		weekEnd: weekEndDate(3),
		scoresJson: makeScoresJson(2, 2, 2, 1, 2),
		bonusPoints: 6,
		createdAt: daysAgoISO(21),
	},
	// ── 903 けんたくん (elementary) — 高頻度 ──
	{
		id: 9031,
		childId: 903,
		weekStart: weekStartDate(0),
		weekEnd: weekEndDate(0),
		scoresJson: makeScoresJson(10, 8, 6, 4, 7),
		bonusPoints: 30,
		createdAt: daysAgoISO(0),
	},
	{
		id: 9032,
		childId: 903,
		weekStart: weekStartDate(1),
		weekEnd: weekEndDate(1),
		scoresJson: makeScoresJson(9, 7, 5, 4, 6),
		bonusPoints: 28,
		createdAt: daysAgoISO(7),
	},
	{
		id: 9033,
		childId: 903,
		weekStart: weekStartDate(2),
		weekEnd: weekEndDate(2),
		scoresJson: makeScoresJson(8, 6, 5, 3, 5),
		bonusPoints: 25,
		createdAt: daysAgoISO(14),
	},
	{
		id: 9034,
		childId: 903,
		weekStart: weekStartDate(3),
		weekEnd: weekEndDate(3),
		scoresJson: makeScoresJson(7, 5, 4, 3, 5),
		bonusPoints: 22,
		createdAt: daysAgoISO(21),
	},
	// ── 904 さくらちゃん (junior) — 高頻度 ──
	{
		id: 9041,
		childId: 904,
		weekStart: weekStartDate(0),
		weekEnd: weekEndDate(0),
		scoresJson: makeScoresJson(12, 14, 8, 5, 10),
		bonusPoints: 45,
		createdAt: daysAgoISO(0),
	},
	{
		id: 9042,
		childId: 904,
		weekStart: weekStartDate(1),
		weekEnd: weekEndDate(1),
		scoresJson: makeScoresJson(11, 13, 7, 5, 9),
		bonusPoints: 42,
		createdAt: daysAgoISO(7),
	},
	{
		id: 9043,
		childId: 904,
		weekStart: weekStartDate(2),
		weekEnd: weekEndDate(2),
		scoresJson: makeScoresJson(10, 12, 7, 4, 8),
		bonusPoints: 38,
		createdAt: daysAgoISO(14),
	},
	{
		id: 9044,
		childId: 904,
		weekStart: weekStartDate(3),
		weekEnd: weekEndDate(3),
		scoresJson: makeScoresJson(9, 11, 6, 4, 7),
		bonusPoints: 35,
		createdAt: daysAgoISO(21),
	},
	// ── 906 けいすけくん (senior) — 最頻度 ──
	{
		id: 9061,
		childId: 906,
		weekStart: weekStartDate(0),
		weekEnd: weekEndDate(0),
		scoresJson: makeScoresJson(14, 16, 12, 10, 13),
		bonusPoints: 60,
		createdAt: daysAgoISO(0),
	},
	{
		id: 9062,
		childId: 906,
		weekStart: weekStartDate(1),
		weekEnd: weekEndDate(1),
		scoresJson: makeScoresJson(13, 15, 11, 10, 12),
		bonusPoints: 55,
		createdAt: daysAgoISO(7),
	},
	{
		id: 9063,
		childId: 906,
		weekStart: weekStartDate(2),
		weekEnd: weekEndDate(2),
		scoresJson: makeScoresJson(12, 14, 10, 9, 11),
		bonusPoints: 50,
		createdAt: daysAgoISO(14),
	},
	{
		id: 9064,
		childId: 906,
		weekStart: weekStartDate(3),
		weekEnd: weekEndDate(3),
		scoresJson: makeScoresJson(11, 13, 10, 8, 10),
		bonusPoints: 45,
		createdAt: daysAgoISO(21),
	},
];

// ============================================================
// Marketplace integration (#2097 Phase B-7)
// ============================================================
// 製品公式マーケットプレイス JSON (src/lib/data/marketplace/) を demo Lambda の
// baseline content として取り込む。本番の新規 tenant が setup wizard skip 動線で
// 受け取る default import 体験と parity を実現する。
//
// MARKETPLACE SNAPSHOT: 2026-03-27
// 子供別 default pack 仕様 (docs/research/2097-marketplace-default-import-spec.md §3):
//   902 (5歳 preschool F)   : kinder-starter (30 activities) + kinder-rewards (10 rewards)
//   903 (8歳 elementary M)  : elementary-boy (28) + elementary-rewards (10) + event-pool (10)
//   904 (14歳 junior F)     : junior-girl (25) + junior-rewards (10) + event-school-start (11)
//   906 (17歳 senior M)     : senior-boy (25) + senior-rewards (10)
//   901 (1歳 baby M)        : 既存 DEMO_ACTIVITIES (baby-first 由来) のみ（marketplace 対象外）
// ============================================================

// Synthetic ID ranges (5000+ で既存 DEMO_* と衝突しない):
//   activities      : 5000-5999  (順序: pack 出現順)
//   templates       : 5000+      (per child checklist preset)
//   template items  : 6000+      (per template item 順)
//   special rewards : 5000+      (per child reward-set 上位 5 件)
const SYN_ACTIVITY_ID_BASE = 5000;
const SYN_TEMPLATE_ID_BASE = 5000;
const SYN_TEMPLATE_ITEM_ID_BASE = 6000;
const SYN_SPECIAL_REWARD_ID_BASE = 5000;

// Category code → numeric ID (activity-import-service.ts の CATEGORY_CODE_TO_ID と同義)
const CATEGORY_CODE_TO_ID: Record<string, number> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_CODE_TO_ID[code] = i + 1;
}

/** Marketplace ActivityPackItem → Domain Activity への変換 (production の importActivities と同型) */
function convertMarketplaceActivitiesToDomain(
	items: ActivityPackItem[],
	presetId: string,
	idOffset: number,
): Activity[] {
	return items.map((item, idx) => {
		const categoryId = CATEGORY_CODE_TO_ID[item.categoryCode] ?? 3; // fallback: seikatsu
		return {
			id: SYN_ACTIVITY_ID_BASE + idOffset + idx,
			name: item.name,
			categoryId,
			icon: item.icon,
			basePoints: item.basePoints,
			ageMin: item.ageMin,
			ageMax: item.ageMax,
			isVisible: 1,
			dailyLimit: null,
			sortOrder: idOffset + idx,
			source: 'marketplace',
			gradeLevel: item.gradeLevel ?? null,
			subcategory: null,
			description: item.description ?? null,
			nameKana: null,
			nameKanji: null,
			triggerHint: item.triggerHint ?? null,
			// #1758 (#1709-D) と同等: mustDefault=true なら 'must'、それ以外 'optional'
			priority: item.mustDefault === true ? 'must' : 'optional',
			isMainQuest: 0,
			isArchived: 0,
			archivedReason: null,
			createdAt: NOW,
			sourcePresetId: presetId,
		} satisfies Activity;
	});
}

// ── Per-child preset mapping (A-4 §3 spec) ────────────────────

const ACTIVITY_PACKS_BY_CHILD: Record<number, string[]> = {
	902: ['kinder-starter'],
	903: ['elementary-boy'],
	904: ['junior-girl'],
	906: ['senior-boy'],
};

const REWARD_SETS_BY_CHILD: Record<number, string[]> = {
	902: ['kinder-rewards'],
	903: ['elementary-rewards'],
	904: ['junior-rewards'],
	906: ['senior-rewards'],
};

const CHECKLISTS_BY_CHILD: Record<number, string[]> = {
	903: ['event-pool'],
	904: ['event-school-start'],
};

// ── Module-load factory builders ──────────────────────────────

const MARKETPLACE_ACTIVITIES_BY_CHILD: Record<number, Activity[]> = (() => {
	const map: Record<number, Activity[]> = {};
	let idOffset = 0;
	for (const [childIdStr, packIds] of Object.entries(ACTIVITY_PACKS_BY_CHILD)) {
		const childId = Number(childIdStr);
		const collected: Activity[] = [];
		for (const packId of packIds) {
			const pack = getMarketplaceItem('activity-pack', packId);
			if (!pack) continue;
			const activities = (pack.payload as ActivityPackPayload).activities as ActivityPackItem[];
			const converted = convertMarketplaceActivitiesToDomain(activities, packId, idOffset);
			collected.push(...converted);
			idOffset += converted.length;
		}
		map[childId] = collected;
	}
	return map;
})();

const MARKETPLACE_REWARD_TEMPLATES_BY_CHILD: Record<
	number,
	Array<{ title: string; points: number; icon: string; category: RewardCategory }>
> = (() => {
	const map: Record<
		number,
		Array<{ title: string; points: number; icon: string; category: RewardCategory }>
	> = {};
	for (const [childIdStr, setIds] of Object.entries(REWARD_SETS_BY_CHILD)) {
		const childId = Number(childIdStr);
		const collected: Array<{
			title: string;
			points: number;
			icon: string;
			category: RewardCategory;
		}> = [];
		for (const setId of setIds) {
			const set = getMarketplaceItem('reward-set', setId);
			if (!set) continue;
			const payload = set.payload as RewardSetPayload;
			collected.push(
				...payload.rewards.map((r) => ({
					title: r.title,
					points: r.points,
					icon: r.icon,
					category: r.category,
				})),
			);
		}
		map[childId] = collected;
	}
	return map;
})();

const MARKETPLACE_CHECKLIST_TEMPLATES_BY_CHILD: Record<number, ChecklistTemplate[]> = (() => {
	const map: Record<number, ChecklistTemplate[]> = {};
	let tplIdOffset = 0;
	for (const [childIdStr, listIds] of Object.entries(CHECKLISTS_BY_CHILD)) {
		const childId = Number(childIdStr);
		const collected: ChecklistTemplate[] = [];
		for (const listId of listIds) {
			const item = getMarketplaceItem('checklist', listId);
			if (!item) continue;
			collected.push({
				id: SYN_TEMPLATE_ID_BASE + tplIdOffset,
				childId,
				name: item.name,
				icon: item.icon,
				pointsPerItem: 2,
				completionBonus: 10,
				timeSlot: (item.payload as ChecklistPayload).timing ?? 'daily',
				isActive: 1,
				isArchived: 0,
				archivedReason: null,
				createdAt: NOW,
				updatedAt: NOW,
				sourcePresetId: listId,
			} satisfies ChecklistTemplate);
			tplIdOffset++;
		}
		map[childId] = collected;
	}
	return map;
})();

const MARKETPLACE_CHECKLIST_ITEMS_BY_TEMPLATE: Record<number, ChecklistTemplateItem[]> = (() => {
	const map: Record<number, ChecklistTemplateItem[]> = {};
	let itemIdOffset = 0;
	for (const [childIdStr, listIds] of Object.entries(CHECKLISTS_BY_CHILD)) {
		const childId = Number(childIdStr);
		const templates = MARKETPLACE_CHECKLIST_TEMPLATES_BY_CHILD[childId] ?? [];
		for (let i = 0; i < listIds.length; i++) {
			const listId = listIds[i];
			const template = templates[i];
			if (!listId || !template) continue;
			const item = getMarketplaceItem('checklist', listId);
			if (!item) continue;
			const payload = item.payload as ChecklistPayload;
			map[template.id] = payload.items.map((it, idx) => ({
				id: SYN_TEMPLATE_ITEM_ID_BASE + itemIdOffset + idx,
				templateId: template.id,
				name: it.label,
				icon: it.icon,
				frequency: 'daily',
				direction: 'positive',
				sortOrder: it.order ?? idx + 1,
				createdAt: NOW,
			}));
			itemIdOffset += payload.items.length;
		}
	}
	return map;
})();

// ── SpecialReward fixture (child reward shop 用 + 達成プレゼント modal 演出用) ───────────────
//
// Demo Lambda の子供側ごほうびショップ (`/(child)/[uiMode]/shop`) は
// `getChildSpecialRewards` 経由で `findSpecialRewards(childId, tenantId)` を呼ぶ。
// marketplace reward-set から各子供に上位 5 件を pre-granted として配置:
//
// - idx 0 (最新): **未表示** (shownAt = null) — `findUnshownReward` で取得され
//   子供ホームで `SpecialRewardOverlay` (おうかん演出 / 達成プレゼント modal) を発火させる (B-5a)
// - idx 1-4 (古い): 既表示 (shownAt 設定済み) — child shop 棚の履歴として表示される
const MARKETPLACE_SPECIAL_REWARDS_BY_CHILD: Record<number, SpecialReward[]> = (() => {
	const map: Record<number, SpecialReward[]> = {};
	let idOffset = 0;
	for (const [childIdStr, templates] of Object.entries(MARKETPLACE_REWARD_TEMPLATES_BY_CHILD)) {
		const childId = Number(childIdStr);
		const presetId = REWARD_SETS_BY_CHILD[childId]?.[0] ?? null;
		// 上位 5 件を pre-granted として配置（child shop で「いくつか並んだ棚」を再現 + 1 件未表示）
		const top5 = templates.slice(0, 5);
		map[childId] = top5.map((tpl, idx) => ({
			id: SYN_SPECIAL_REWARD_ID_BASE + idOffset + idx,
			childId,
			grantedBy: null,
			title: tpl.title,
			description: null,
			points: tpl.points,
			icon: tpl.icon,
			category: tpl.category,
			grantedAt: daysAgoISO(idx + 1),
			// idx 0: shownAt=null (達成プレゼント modal 発火、B-5a)
			// idx 1-4: shownAt 設定済み (履歴表示)
			shownAt: idx === 0 ? null : daysAgoISO(idx + 1),
			sourcePresetId: presetId,
		}));
		idOffset += top5.length;
	}
	return map;
})();

// ── Flat union exports (Repository read methods 用) ────────────

/** 全 marketplace 由来 activities の flat 配列 (findActivities 用) */
export const DEMO_MARKETPLACE_ACTIVITIES: Activity[] = Object.values(
	MARKETPLACE_ACTIVITIES_BY_CHILD,
).flat();

/** 全 marketplace 由来 checklist templates の flat 配列 */
export const DEMO_MARKETPLACE_CHECKLIST_TEMPLATES: ChecklistTemplate[] = Object.values(
	MARKETPLACE_CHECKLIST_TEMPLATES_BY_CHILD,
).flat();

/** 全 marketplace 由来 checklist items の flat 配列 */
export const DEMO_MARKETPLACE_CHECKLIST_ITEMS: ChecklistTemplateItem[] = Object.values(
	MARKETPLACE_CHECKLIST_ITEMS_BY_TEMPLATE,
).flat();

/** 全 marketplace 由来 special rewards の flat 配列 */
export const DEMO_MARKETPLACE_SPECIAL_REWARDS: SpecialReward[] = Object.values(
	MARKETPLACE_SPECIAL_REWARDS_BY_CHILD,
).flat();

// ── Per-child getter API ──────────────────────────────────────

export function getDemoMarketplaceActivitiesByChild(childId: number): Activity[] {
	return MARKETPLACE_ACTIVITIES_BY_CHILD[childId] ?? [];
}

export function getDemoMarketplaceRewardTemplatesByChild(
	childId: number,
): Array<{ title: string; points: number; icon: string; category: RewardCategory }> {
	return MARKETPLACE_REWARD_TEMPLATES_BY_CHILD[childId] ?? [];
}

/**
 * テナント全体の reward templates を返す（Demo Lambda は単一テナント 'demo'）。
 * Settings repo の 'reward_templates' キー fixture として使用される。
 * 全子供分の reward-set を集合化、`title` 重複排除。
 */
export function getDemoMarketplaceRewardTemplatesForTenant(): Array<{
	title: string;
	points: number;
	icon: string;
	category: RewardCategory;
}> {
	const seen = new Set<string>();
	const collected: Array<{
		title: string;
		points: number;
		icon: string;
		category: RewardCategory;
	}> = [];
	for (const templates of Object.values(MARKETPLACE_REWARD_TEMPLATES_BY_CHILD)) {
		for (const tpl of templates) {
			if (seen.has(tpl.title)) continue;
			seen.add(tpl.title);
			collected.push(tpl);
		}
	}
	return collected;
}

export function getDemoMarketplaceChecklistTemplatesByChild(childId: number): ChecklistTemplate[] {
	return MARKETPLACE_CHECKLIST_TEMPLATES_BY_CHILD[childId] ?? [];
}

export function getDemoMarketplaceChecklistItemsByTemplate(
	templateId: number,
): ChecklistTemplateItem[] {
	return MARKETPLACE_CHECKLIST_ITEMS_BY_TEMPLATE[templateId] ?? [];
}

export function getDemoMarketplaceSpecialRewardsByChild(childId: number): SpecialReward[] {
	return MARKETPLACE_SPECIAL_REWARDS_BY_CHILD[childId] ?? [];
}

// ============================================================
// Stamp Cards (#2097 Phase B-2)
// ============================================================
// stamp_masters SSOT: src/lib/server/db/stamp-master-defaults.ts (16 種)
// rarity 別出現確率: N 60% / R 25% / SR 12% / UR 3% (stamp-card-service.ts §RARITY_WEIGHTS)
//
// baby (901) は ADR-0011 によりスタンプカード非表示。
// preschool/elementary/junior/senior の 4 子供に対し、
// - 当週 (weekStart=2026-03-23, demo TODAY=2026-03-27 Fri):
//   active "collecting" card + 子供の活動レベルに応じた filled stamp 2-4 個
// - 前週 (weekStart=2026-03-16): 5/5 filled + status='redeemed' の完了カード
//
// 当週カード ID = 7xx, 前週カード ID = 8xx, entry ID = card_id * 10 + slot
// child 別 fillCount (当週): 902=2, 903=3, 904=4, 906=4 (年齢/活発度に応じて段階)

export const DEMO_STAMP_MASTERS: StampMaster[] = getDefaultStampMasters(NOW);

// 週境界: demo TODAY=2026-03-27 (Fri) → weekStart=2026-03-23 / weekEnd=2026-03-29
// 前週: weekStart=2026-03-16 / weekEnd=2026-03-22
const CURRENT_WEEK_START = '2026-03-23';
const CURRENT_WEEK_END = '2026-03-29';
const PREV_WEEK_START = '2026-03-16';
const PREV_WEEK_END = '2026-03-22';

// 当週 active "collecting" card: card.id = 7xx (子供ごと固定)
// 前週 5/5 完了 "redeemed" card: card.id = 8xx
export const DEMO_STAMP_CARDS: StampCard[] = [
	// 902 ひなちゃん (preschool) — 当週 2 枚 (月火)
	{
		id: 702,
		childId: 902,
		weekStart: CURRENT_WEEK_START,
		weekEnd: CURRENT_WEEK_END,
		status: 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(3),
	},
	{
		id: 802,
		childId: 902,
		weekStart: PREV_WEEK_START,
		weekEnd: PREV_WEEK_END,
		status: 'redeemed',
		redeemedPoints: 100, // 5*10 + 50 complete bonus
		redeemedAt: daysAgoISO(5),
		createdAt: daysAgoISO(11),
		updatedAt: daysAgoISO(5),
	},
	// 903 けんたくん (elementary) — 当週 3 枚 (月火水)
	{
		id: 703,
		childId: 903,
		weekStart: CURRENT_WEEK_START,
		weekEnd: CURRENT_WEEK_END,
		status: 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(2),
	},
	{
		id: 803,
		childId: 903,
		weekStart: PREV_WEEK_START,
		weekEnd: PREV_WEEK_END,
		status: 'redeemed',
		redeemedPoints: 100,
		redeemedAt: daysAgoISO(5),
		createdAt: daysAgoISO(11),
		updatedAt: daysAgoISO(5),
	},
	// 904 さくらちゃん (junior) — 当週 4 枚 (月火水木)
	{
		id: 704,
		childId: 904,
		weekStart: CURRENT_WEEK_START,
		weekEnd: CURRENT_WEEK_END,
		status: 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(1),
	},
	{
		id: 804,
		childId: 904,
		weekStart: PREV_WEEK_START,
		weekEnd: PREV_WEEK_END,
		status: 'redeemed',
		redeemedPoints: 100,
		redeemedAt: daysAgoISO(5),
		createdAt: daysAgoISO(11),
		updatedAt: daysAgoISO(5),
	},
	// 906 けいすけくん (senior) — 当週 4 枚 (月火水木)
	{
		id: 706,
		childId: 906,
		weekStart: CURRENT_WEEK_START,
		weekEnd: CURRENT_WEEK_END,
		status: 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: daysAgoISO(4),
		updatedAt: daysAgoISO(1),
	},
	{
		id: 806,
		childId: 906,
		weekStart: PREV_WEEK_START,
		weekEnd: PREV_WEEK_END,
		status: 'redeemed',
		redeemedPoints: 100,
		redeemedAt: daysAgoISO(5),
		createdAt: daysAgoISO(11),
		updatedAt: daysAgoISO(5),
	},
];

// stamp_entries: cardId * 10 + slot
// loginDate は当週: weekStart 起点 (Mon=2026-03-23) で slot-1 日後
//                  前週: weekStart 起点 (Mon=2026-03-16) で slot-1 日後
function currentWeekDate(slot: number): string {
	const d = new Date(`${CURRENT_WEEK_START}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + (slot - 1));
	return d.toISOString().slice(0, 10);
}
function prevWeekDate(slot: number): string {
	const d = new Date(`${PREV_WEEK_START}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + (slot - 1));
	return d.toISOString().slice(0, 10);
}

export const DEMO_STAMP_ENTRIES: StampEntry[] = [
	// === 902 ひな 当週 (cardId=702) — slot 1-2, masters 1(N)+3(N) ===
	{
		id: 7021,
		cardId: 702,
		stampMasterId: 1,
		omikujiRank: 'sho-kichi',
		slot: 1,
		loginDate: currentWeekDate(1),
		earnedAt: daysAgoISO(4),
	},
	{
		id: 7022,
		cardId: 702,
		stampMasterId: 3,
		omikujiRank: 'kichi',
		slot: 2,
		loginDate: currentWeekDate(2),
		earnedAt: daysAgoISO(3),
	},
	// === 902 ひな 前週 (cardId=802) — 5/5 完了, N×3 + R×1 + SR×1 ===
	{
		id: 8021,
		cardId: 802,
		stampMasterId: 1,
		omikujiRank: 'sho-kichi',
		slot: 1,
		loginDate: prevWeekDate(1),
		earnedAt: daysAgoISO(11),
	},
	{
		id: 8022,
		cardId: 802,
		stampMasterId: 4,
		omikujiRank: 'sho-kichi',
		slot: 2,
		loginDate: prevWeekDate(2),
		earnedAt: daysAgoISO(10),
	},
	{
		id: 8023,
		cardId: 802,
		stampMasterId: 5,
		omikujiRank: 'kichi',
		slot: 3,
		loginDate: prevWeekDate(3),
		earnedAt: daysAgoISO(9),
	},
	{
		id: 8024,
		cardId: 802,
		stampMasterId: 9,
		omikujiRank: 'chu-kichi',
		slot: 4,
		loginDate: prevWeekDate(4),
		earnedAt: daysAgoISO(8),
	},
	{
		id: 8025,
		cardId: 802,
		stampMasterId: 12,
		omikujiRank: 'dai-kichi',
		slot: 5,
		loginDate: prevWeekDate(5),
		earnedAt: daysAgoISO(7),
	},
	// === 903 けんた 当週 (cardId=703) — 3 個, N+N+R ===
	{
		id: 7031,
		cardId: 703,
		stampMasterId: 2,
		omikujiRank: 'sho-kichi',
		slot: 1,
		loginDate: currentWeekDate(1),
		earnedAt: daysAgoISO(4),
	},
	{
		id: 7032,
		cardId: 703,
		stampMasterId: 5,
		omikujiRank: 'kichi',
		slot: 2,
		loginDate: currentWeekDate(2),
		earnedAt: daysAgoISO(3),
	},
	{
		id: 7033,
		cardId: 703,
		stampMasterId: 8,
		omikujiRank: 'chu-kichi',
		slot: 3,
		loginDate: currentWeekDate(3),
		earnedAt: daysAgoISO(2),
	},
	// === 903 けんた 前週 (cardId=803) — 5/5 完了, N×2 + R×2 + SR×1 ===
	{
		id: 8031,
		cardId: 803,
		stampMasterId: 1,
		omikujiRank: 'sho-kichi',
		slot: 1,
		loginDate: prevWeekDate(1),
		earnedAt: daysAgoISO(11),
	},
	{
		id: 8032,
		cardId: 803,
		stampMasterId: 5,
		omikujiRank: 'kichi',
		slot: 2,
		loginDate: prevWeekDate(2),
		earnedAt: daysAgoISO(10),
	},
	{
		id: 8033,
		cardId: 803,
		stampMasterId: 6,
		omikujiRank: 'chu-kichi',
		slot: 3,
		loginDate: prevWeekDate(3),
		earnedAt: daysAgoISO(9),
	},
	{
		id: 8034,
		cardId: 803,
		stampMasterId: 7,
		omikujiRank: 'chu-kichi',
		slot: 4,
		loginDate: prevWeekDate(4),
		earnedAt: daysAgoISO(8),
	},
	{
		id: 8035,
		cardId: 803,
		stampMasterId: 13,
		omikujiRank: 'dai-kichi',
		slot: 5,
		loginDate: prevWeekDate(5),
		earnedAt: daysAgoISO(7),
	},
	// === 904 さくら 当週 (cardId=704) — 4 個, N+R+SR+R ===
	{
		id: 7041,
		cardId: 704,
		stampMasterId: 3,
		omikujiRank: 'sho-kichi',
		slot: 1,
		loginDate: currentWeekDate(1),
		earnedAt: daysAgoISO(4),
	},
	{
		id: 7042,
		cardId: 704,
		stampMasterId: 8,
		omikujiRank: 'chu-kichi',
		slot: 2,
		loginDate: currentWeekDate(2),
		earnedAt: daysAgoISO(3),
	},
	{
		id: 7043,
		cardId: 704,
		stampMasterId: 11,
		omikujiRank: 'dai-kichi',
		slot: 3,
		loginDate: currentWeekDate(3),
		earnedAt: daysAgoISO(2),
	},
	{
		id: 7044,
		cardId: 704,
		stampMasterId: 9,
		omikujiRank: 'chu-kichi',
		slot: 4,
		loginDate: currentWeekDate(4),
		earnedAt: daysAgoISO(1),
	},
	// === 904 さくら 前週 (cardId=804) — 5/5 完了, R×2 + SR×2 + UR×1 ===
	{
		id: 8041,
		cardId: 804,
		stampMasterId: 6,
		omikujiRank: 'chu-kichi',
		slot: 1,
		loginDate: prevWeekDate(1),
		earnedAt: daysAgoISO(11),
	},
	{
		id: 8042,
		cardId: 804,
		stampMasterId: 10,
		omikujiRank: 'chu-kichi',
		slot: 2,
		loginDate: prevWeekDate(2),
		earnedAt: daysAgoISO(10),
	},
	{
		id: 8043,
		cardId: 804,
		stampMasterId: 11,
		omikujiRank: 'dai-kichi',
		slot: 3,
		loginDate: prevWeekDate(3),
		earnedAt: daysAgoISO(9),
	},
	{
		id: 8044,
		cardId: 804,
		stampMasterId: 14,
		omikujiRank: 'dai-kichi',
		slot: 4,
		loginDate: prevWeekDate(4),
		earnedAt: daysAgoISO(8),
	},
	{
		id: 8045,
		cardId: 804,
		stampMasterId: 16,
		omikujiRank: 'dai-kichi',
		slot: 5,
		loginDate: prevWeekDate(5),
		earnedAt: daysAgoISO(7),
	},
	// === 906 けいすけ 当週 (cardId=706) — 4 個, R+SR+R+SR ===
	{
		id: 7061,
		cardId: 706,
		stampMasterId: 7,
		omikujiRank: 'chu-kichi',
		slot: 1,
		loginDate: currentWeekDate(1),
		earnedAt: daysAgoISO(4),
	},
	{
		id: 7062,
		cardId: 706,
		stampMasterId: 12,
		omikujiRank: 'dai-kichi',
		slot: 2,
		loginDate: currentWeekDate(2),
		earnedAt: daysAgoISO(3),
	},
	{
		id: 7063,
		cardId: 706,
		stampMasterId: 10,
		omikujiRank: 'chu-kichi',
		slot: 3,
		loginDate: currentWeekDate(3),
		earnedAt: daysAgoISO(2),
	},
	{
		id: 7064,
		cardId: 706,
		stampMasterId: 13,
		omikujiRank: 'dai-kichi',
		slot: 4,
		loginDate: currentWeekDate(4),
		earnedAt: daysAgoISO(1),
	},
	// === 906 けいすけ 前週 (cardId=806) — 5/5 完了, R×1 + SR×2 + UR×2 ===
	{
		id: 8061,
		cardId: 806,
		stampMasterId: 8,
		omikujiRank: 'chu-kichi',
		slot: 1,
		loginDate: prevWeekDate(1),
		earnedAt: daysAgoISO(11),
	},
	{
		id: 8062,
		cardId: 806,
		stampMasterId: 12,
		omikujiRank: 'dai-kichi',
		slot: 2,
		loginDate: prevWeekDate(2),
		earnedAt: daysAgoISO(10),
	},
	{
		id: 8063,
		cardId: 806,
		stampMasterId: 14,
		omikujiRank: 'dai-kichi',
		slot: 3,
		loginDate: prevWeekDate(3),
		earnedAt: daysAgoISO(9),
	},
	{
		id: 8064,
		cardId: 806,
		stampMasterId: 15,
		omikujiRank: 'dai-kichi',
		slot: 4,
		loginDate: prevWeekDate(4),
		earnedAt: daysAgoISO(8),
	},
	{
		id: 8065,
		cardId: 806,
		stampMasterId: 16,
		omikujiRank: 'dai-kichi',
		slot: 5,
		loginDate: prevWeekDate(5),
		earnedAt: daysAgoISO(7),
	},
];

// ============================================================
// Certificates (#2262 — demo Lambda /admin/growth-book 復旧 + LP 訴求担保)
// ============================================================
//
// LP 訴求 (growth-stage-graduate / monthly-report) は「がんばり証明書 N 枚」を可視化する
// ため、903 けんたくん (elementary, Level 7+) に streak / level / monthly 証明書を 4 件配布。
// 他の子は最小 1 件 (902 ひな = streak_7、904 さくら = level_10、906 けいすけ = annual_2025) と
// する。901 たろう (baby) は証明書なし (year_dependent な実績がまだ生まれていない年齢)。
//
// `certificateType` 命名は certificate-service.ts §getStreakDef / getLevelDef 等と一致させる:
//   streak_<N> / level_<N> / monthly_<YYYY-MM> / category_master_<catId> / annual_<YYYY>

export const DEMO_CERTIFICATES: Certificate[] = [
	// 902 ひな (preschool F, Level 4) — 1 件: 7 日連続
	{
		id: 9021,
		tenantId: DEMO_TENANT_ID,
		childId: 902,
		certificateType: 'streak_7',
		title: 'れんぞく7にちのぼうけんしゃ',
		description: '7にちれんぞくで がんばりました！',
		metadata: null,
		issuedAt: daysAgoISO(20),
	},
	// 903 けんた (elementary M, Level 7) — 4 件: streak 14 / level 5 / 2026-02 月間 / 運動マスター
	{
		id: 9031,
		tenantId: DEMO_TENANT_ID,
		childId: 903,
		certificateType: 'streak_14',
		title: 'れんぞく14にちのぼうけんしゃ',
		description: '14にちれんぞくで がんばりました！',
		metadata: null,
		issuedAt: daysAgoISO(40),
	},
	{
		id: 9032,
		tenantId: DEMO_TENANT_ID,
		childId: 903,
		certificateType: 'level_5',
		title: 'レベル5とうたつ！',
		description: 'レベル5に たっせいしました！',
		metadata: null,
		issuedAt: daysAgoISO(60),
	},
	{
		id: 9033,
		tenantId: DEMO_TENANT_ID,
		childId: 903,
		certificateType: 'monthly_2026-02',
		title: '2026ねん2がつの がんばりしょうめいしょ',
		description: '2026ねん2がつ にがんばりました！',
		metadata: null,
		issuedAt: daysAgoISO(25),
	},
	{
		id: 9034,
		tenantId: DEMO_TENANT_ID,
		childId: 903,
		certificateType: 'category_master_1',
		title: 'うんどうマスター',
		description: 'うんどうカテゴリで たくさんがんばりました！',
		metadata: null,
		issuedAt: daysAgoISO(15),
	},
	// 904 さくら (junior F, Level 15+) — 1 件: Lv.10
	{
		id: 9041,
		tenantId: DEMO_TENANT_ID,
		childId: 904,
		certificateType: 'level_10',
		title: 'レベル10とうたつ！',
		description: 'レベル10に たっせいしました！',
		metadata: null,
		issuedAt: daysAgoISO(90),
	},
	// 906 けいすけ (senior M, Level 20+) — 1 件: 2025年度総括
	{
		id: 9061,
		tenantId: DEMO_TENANT_ID,
		childId: 906,
		certificateType: 'annual_2025',
		title: '2025ねんどの がんばりしょうめいしょ',
		description: '2025ねんどに たくさんがんばりました！',
		metadata: null,
		issuedAt: daysAgoISO(120),
	},
];

// ============================================================
// Helper: Get demo data for a specific child
// ============================================================

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

export { DEMO_TENANT_ID, NOW, TODAY };
