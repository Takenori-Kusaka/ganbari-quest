// src/lib/server/services/reward-suggest-service.ts
// 自然言語からごほうび情報を推定するサービス (#719, #987: provider 層移行)

import { PRESET_REWARD_GROUPS } from '$lib/data/preset-rewards';
import { getAiProvider, isAiAvailable } from '$lib/server/ai/factory';
import { logger } from '$lib/server/logger';

export interface SuggestedReward {
	title: string;
	points: number;
	icon: string;
	category: string;
	source: 'gemini' | 'fallback';
}

/** キーワード→カテゴリ+アイコンの詳細マッピング */
const REWARD_KEYWORD_MAP: {
	keywords: string[];
	category: string;
	icon: string;
	pointsHint: number;
}[] = [
	// もの（物品）
	{ keywords: ['おもちゃ', 'おもちや', '玩具'], category: 'もの', icon: '🧸', pointsHint: 500 },
	{ keywords: ['シール', 'しーる', 'ステッカー'], category: 'もの', icon: '⭐', pointsHint: 50 },
	{
		keywords: ['おかし', 'お菓子', 'おやつ', 'チョコ', 'ちょこ', 'アイス', 'あいす'],
		category: 'もの',
		icon: '🍬',
		pointsHint: 100,
	},
	{
		keywords: ['文房具', 'ぶんぼうぐ', 'ペン', 'ぺん', 'ノート', 'のーと', '消しゴム', 'けしごむ'],
		category: 'もの',
		icon: '✏️',
		pointsHint: 200,
	},
	{
		keywords: ['本', 'ほん', '絵本', 'えほん', 'マンガ', 'まんが', '漫画', '図鑑', 'ずかん'],
		category: 'もの',
		icon: '📚',
		pointsHint: 300,
	},
	{
		keywords: ['ゲームソフト', 'げーむそふと', 'カード', 'かーど', 'トレカ', 'とれか'],
		category: 'もの',
		icon: '🎮',
		pointsHint: 500,
	},
	{
		keywords: ['服', 'ふく', '洋服', 'ようふく', 'くつ', '靴', 'アクセサリー'],
		category: 'もの',
		icon: '👗',
		pointsHint: 500,
	},

	// たいけん（体験）
	{
		keywords: ['おでかけ', 'お出かけ', 'おでかけ', '遊園地', 'ゆうえんち', 'テーマパーク'],
		category: 'たいけん',
		icon: '🎢',
		pointsHint: 500,
	},
	{
		keywords: ['がいしょく', '外食', 'レストラン', 'れすとらん', 'ファミレス', 'ふぁみれす'],
		category: 'たいけん',
		icon: '🍽️',
		pointsHint: 500,
	},
	{
		keywords: ['えいが', '映画', 'シネマ', 'しねま'],
		category: 'たいけん',
		icon: '🎬',
		pointsHint: 500,
	},
	{
		keywords: ['ゲーム時間', 'げーむじかん', 'ゲーム', 'げーむ', 'スイッチ', 'すいっち'],
		category: 'たいけん',
		icon: '🎮',
		pointsHint: 200,
	},
	{
		keywords: ['YouTube', 'ゆーちゅーぶ', '動画', 'どうが', 'テレビ', 'てれび'],
		category: 'たいけん',
		icon: '📺',
		pointsHint: 200,
	},
	{
		keywords: ['りょこう', '旅行', 'キャンプ', 'きゃんぷ'],
		category: 'たいけん',
		icon: '✈️',
		pointsHint: 1000,
	},
	{
		keywords: ['プール', 'ぷーる', '海', 'うみ', '川', 'かわ'],
		category: 'たいけん',
		icon: '🏖️',
		pointsHint: 500,
	},
	{
		keywords: ['ともだち', '友達', '友だち', 'おともだち'],
		category: 'たいけん',
		icon: '👫',
		pointsHint: 300,
	},

	// おこづかい
	{
		keywords: ['おこづかい', 'お小遣い', 'おこずかい'],
		category: 'おこづかい',
		icon: '💰',
		pointsHint: 200,
	},
	{ keywords: ['100円', 'ひゃくえん'], category: 'おこづかい', icon: '🪙', pointsHint: 200 },
	{ keywords: ['500円', 'ごひゃくえん'], category: 'おこづかい', icon: '💴', pointsHint: 500 },
	{
		keywords: ['1000円', 'せんえん', '千円'],
		category: 'おこづかい',
		icon: '💵',
		pointsHint: 1000,
	},

	// とくべつ
	{
		keywords: ['よふかし', '夜更かし', 'よるふかし'],
		category: 'とくべつ',
		icon: '🌙',
		pointsHint: 300,
	},
	{
		keywords: ['あさねぼう', '朝寝坊', 'ねぼう', '寝坊'],
		category: 'とくべつ',
		icon: '😴',
		pointsHint: 200,
	},
	{
		keywords: ['メニュー', 'めにゅー', 'リクエスト', 'りくえすと', 'すきなもの', '好きなもの'],
		category: 'とくべつ',
		icon: '🍕',
		pointsHint: 200,
	},
	{
		keywords: ['ペット', 'ぺっと', '犬', 'いぬ', '猫', 'ねこ'],
		category: 'とくべつ',
		icon: '🐕',
		pointsHint: 150,
	},
	{
		keywords: ['ちょきん', '貯金', '貯金箱', 'ちょきんばこ'],
		category: 'とくべつ',
		icon: '🏦',
		pointsHint: 500,
	},
	{
		keywords: ['かぞく', '家族', 'ボードゲーム', 'ぼーどげーむ', 'カードゲーム'],
		category: 'とくべつ',
		icon: '🎲',
		pointsHint: 300,
	},
];

/** Bedrock / Gemini 共通の tool_use スキーマ */
const REWARD_TOOL = {
	name: 'suggest_reward',
	description: '子供へのごほうびを推定した結果を返す',
	inputSchema: {
		type: 'object' as const,
		properties: {
			title: {
				type: 'string',
				description: 'ごほうびタイトル（ひらがな中心、15文字以内）',
			},
			category: {
				type: 'string',
				enum: ['もの', 'たいけん', 'おこづかい', 'とくべつ'],
				description: 'カテゴリ名',
			},
			icon: { type: 'string', description: 'ごほうびを表す1つの絵文字' },
			points: {
				type: 'number',
				enum: [50, 100, 150, 200, 300, 500, 1000],
				description:
					'ポイント（50:とても小さい, 100:小さい, 200:中くらい, 300:やや大きい, 500:大きい, 1000:特大）',
			},
		},
		required: ['title', 'category', 'icon', 'points'],
	},
};

const SYSTEM_PROMPT = `あなたは子供へのごほうびを提案するアシスタントです。
テキストを分析し、suggest_reward ツールを使って結果を返してください。

カテゴリ（必ず以下から1つ選択）:
- もの（物品: おもちゃ、本、お菓子、文房具、服など）
- たいけん（体験: おでかけ、外食、映画、ゲーム時間、旅行など）
- おこづかい（お金: おこづかい、貯金など）
- とくべつ（特別な許可: 夜更かし、メニューリクエスト、家族でゲームなど）

ポイント基準（子供が活動ポイントを貯めて交換する前提）:
- 50: とても小さなごほうび（シール1枚、小さなおやつ）
- 100: 小さなごほうび（おかし、ちょっとした特権）
- 200: 中くらいのごほうび（文房具、ゲーム時間+30分、お小遣い100円）
- 300: やや大きなごほうび（本、夜更かし許可、友達とおでかけ）
- 500: 大きなごほうび（おもちゃ、外食、映画、お小遣い500円）
- 1000: 特大のごほうび（旅行貯金、ゲームソフト、お小遣い1000円）

アイコンは活動の内容を表す1つの絵文字を選んでください。
タイトルは子供にわかりやすいひらがな中心の表現で、15文字以内にしてください。`;

/** 自然言語テキストからごほうび情報を推定 */
export async function suggestReward(text: string): Promise<SuggestedReward> {
	if (isAiAvailable()) {
		try {
			return await suggestWithAi(text);
		} catch (e) {
			logger.error('[reward-suggest] AI API失敗、フォールバック使用', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { text },
			});
		}
	}

	return suggestByKeywords(text);
}

async function suggestWithAi(text: string): Promise<SuggestedReward> {
	const provider = getAiProvider();
	const result = await provider.converseWithTool({
		system: SYSTEM_PROMPT,
		userMessage: `テキスト: "${text}"`,
		tool: REWARD_TOOL,
	});

	const obj = result.input;

	const validCategories = ['もの', 'たいけん', 'おこづかい', 'とくべつ'];
	const category = validCategories.includes(String(obj.category ?? ''))
		? String(obj.category)
		: 'とくべつ';

	const validPoints = [50, 100, 150, 200, 300, 500, 1000];
	const rawPoints = Number(obj.points ?? 200);
	const points = validPoints.reduce((prev, curr) =>
		Math.abs(curr - rawPoints) < Math.abs(prev - rawPoints) ? curr : prev,
	);

	return {
		title: String(obj.title ?? text).slice(0, 50),
		points,
		icon: String(obj.icon ?? '🎁'),
		category,
		source: 'gemini', // API 互換性のため 'gemini' を維持
	};
}

/** キーワードベースの簡易推定（AI APIがない場合のフォールバック） */
function suggestByKeywords(text: string): SuggestedReward {
	const lower = text.toLowerCase();

	// キーワードマッピングからマッチを探す
	for (const entry of REWARD_KEYWORD_MAP) {
		for (const kw of entry.keywords) {
			if (lower.includes(kw.toLowerCase())) {
				return {
					title: text.slice(0, 50),
					points: entry.pointsHint,
					icon: entry.icon,
					category: entry.category,
					source: 'fallback',
				};
			}
		}
	}

	// プリセット報酬のタイトルからマッチを探す
	for (const group of PRESET_REWARD_GROUPS) {
		for (const reward of group.rewards) {
			if (lower.includes(reward.title.toLowerCase())) {
				return {
					title: reward.title,
					points: reward.points,
					icon: reward.icon,
					category: group.groupName,
					source: 'fallback',
				};
			}
		}
	}

	// デフォルト
	return {
		title: text.slice(0, 50),
		points: 200,
		icon: '🎁',
		category: 'とくべつ',
		source: 'fallback',
	};
}
