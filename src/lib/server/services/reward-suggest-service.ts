// src/lib/server/services/reward-suggest-service.ts
// 自然言語からごほうび情報を推定するサービス (#719)

import { GoogleGenerativeAI } from '@google/generative-ai';
import { PRESET_REWARD_GROUPS } from '$lib/data/preset-rewards';
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

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		logger.warn('[reward-suggest] GEMINI_API_KEY未設定: フォールバックモードで動作');
		return null;
	}
	return new GoogleGenerativeAI(apiKey);
}

/** JSONをレスポンスから安全に抽出 */
function extractJson(text: string): unknown {
	const codeBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
	if (codeBlock?.[1]) {
		return JSON.parse(codeBlock[1]);
	}

	const start = text.indexOf('{');
	if (start === -1) return null;
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}') {
			depth--;
			if (depth === 0) {
				return JSON.parse(text.slice(start, i + 1));
			}
		}
	}
	return null;
}

/** 自然言語テキストからごほうび情報を推定 */
export async function suggestReward(text: string): Promise<SuggestedReward> {
	const client = getGeminiClient();

	if (client) {
		try {
			return await suggestWithGemini(client, text);
		} catch (e) {
			logger.error('[reward-suggest] Gemini API失敗、フォールバック使用', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { text },
			});
		}
	}

	return suggestByKeywords(text);
}

async function suggestWithGemini(
	client: GoogleGenerativeAI,
	text: string,
): Promise<SuggestedReward> {
	const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

	const prompt = `あなたは子供へのごほうびを提案するアシスタントです。
以下のテキストを分析し、子供向けのごほうびとしてJSON形式で回答してください。

テキスト: "${text}"

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
タイトルは子供にわかりやすいひらがな中心の表現で、15文字以内にしてください。

以下のJSON形式のみで回答（説明不要）:
{"title": "ごほうびタイトル", "category": "カテゴリ名", "icon": "絵文字", "points": 数値}`;

	const result = await model.generateContent(prompt);
	const responseText = result.response.text();

	const parsed = extractJson(responseText);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('No valid JSON in Gemini response');
	}

	const obj = parsed as Record<string, unknown>;

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
		source: 'gemini',
	};
}

/** キーワードベースの簡易推定（Gemini APIがない場合のフォールバック） */
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
