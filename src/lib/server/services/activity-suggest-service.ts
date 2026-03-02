// src/lib/server/services/activity-suggest-service.ts
// 自然言語から活動情報を推定するサービス

import { GoogleGenerativeAI } from '@google/generative-ai';
import { CATEGORIES } from '$lib/domain/validation/activity';

interface SuggestedActivity {
	name: string;
	category: (typeof CATEGORIES)[number];
	icon: string;
	basePoints: number;
}

const CATEGORY_ICONS: Record<string, string[]> = {
	'うんどう': ['🤸', '⚽', '🏃', '🏊', '🚴', '⚾', '🎾', '🏀'],
	'べんきょう': ['📖', '✏️', '🔢', '📝', '🧮', '📚', '🔬', '🌍'],
	'せいかつ': ['🪥', '🧹', '👕', '🍽️', '🛏️', '🧺', '🚿', '🌱'],
	'こうりゅう': ['🤝', '👋', '💬', '🎉', '👫', '🤗', '📱', '✉️'],
	'そうぞう': ['🎨', '✂️', '🎹', '🎸', '📷', '🏗️', '🧩', '🎤'],
};

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		return null;
	}
	return new GoogleGenerativeAI(apiKey);
}

/** 自然言語テキストから活動情報を推定 */
export async function suggestActivity(text: string): Promise<SuggestedActivity> {
	const client = getGeminiClient();

	if (client) {
		try {
			return await suggestWithGemini(client, text);
		} catch (e) {
			console.error('Gemini activity suggestion failed, using fallback:', e);
		}
	}

	// フォールバック: キーワードベースの簡易推定
	return suggestByKeywords(text);
}

async function suggestWithGemini(client: GoogleGenerativeAI, text: string): Promise<SuggestedActivity> {
	const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

	const prompt = `あなたは子供の活動をカテゴリ分けするアシスタントです。
以下の活動テキストを分析し、JSON形式で回答してください。

活動テキスト: "${text}"

カテゴリ（必ず以下から1つ選択）:
- うんどう（体を動かす活動: 走る、泳ぐ、ボール遊び、体操など）
- べんきょう（学習活動: 読書、計算、ひらがな、英語、宿題など）
- せいかつ（生活習慣: 歯みがき、片付け、お手伝い、着替えなど）
- こうりゅう（社会性: あいさつ、友達と遊ぶ、お礼を言うなど）
- そうぞう（創造性: お絵描き、工作、音楽、ダンス、料理など）

ポイント基準:
- 3: 毎日簡単にできること（あいさつ、歯みがき）
- 5: ちょっと頑張ること（お手伝い、読書）
- 8: 時間がかかること（宿題、習い事の練習）
- 10: 特別なチャレンジ（発表、大会参加）

以下のJSON形式のみで回答（説明不要）:
{"name": "短い活動名（ひらがな中心、10文字以内）", "category": "カテゴリ名", "icon": "最適な絵文字1つ", "basePoints": 数値}`;

	const result = await model.generateContent(prompt);
	const responseText = result.response.text();

	// JSONを抽出
	const jsonMatch = responseText.match(/\{[^}]+\}/);
	if (!jsonMatch) {
		throw new Error('No JSON in Gemini response');
	}

	const parsed = JSON.parse(jsonMatch[0]);

	// バリデーション
	const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'せいかつ';
	const basePoints = [3, 5, 8, 10].includes(parsed.basePoints) ? parsed.basePoints : 5;

	return {
		name: String(parsed.name ?? text).slice(0, 50),
		category,
		icon: String(parsed.icon ?? '📝').slice(0, 4),
		basePoints,
	};
}

/** キーワードベースの簡易推定（Gemini APIがない場合のフォールバック） */
function suggestByKeywords(text: string): SuggestedActivity {
	const lower = text.toLowerCase();

	const rules: { keywords: string[]; category: (typeof CATEGORIES)[number]; points: number }[] = [
		{ keywords: ['走', 'はし', 'ボール', 'サッカー', '水泳', 'すいえい', '体操', 'たいそう', 'なわとび', 'プール', '散歩', 'さんぽ', '自転車', 'じてんしゃ', 'ダンス', 'スポーツ'], category: 'うんどう', points: 5 },
		{ keywords: ['読', 'よ', '書', 'か', '計算', 'けいさん', 'ひらがな', 'カタカナ', '宿題', 'しゅくだい', '勉強', 'べんきょう', '英語', 'えいご', 'ピアノ', '算数', 'さんすう', '本'], category: 'べんきょう', points: 5 },
		{ keywords: ['歯', 'は', 'みがき', '片付', 'かたづ', '着替', 'きが', '手伝', 'てつだ', '洗', 'あら', '掃除', 'そうじ', 'ごはん', 'お風呂', 'ふろ', '靴', 'くつ'], category: 'せいかつ', points: 3 },
		{ keywords: ['あいさつ', '友達', 'ともだち', 'ありがとう', 'ごめん', '遊', 'あそ', '話', 'はな', 'お礼', 'おれい', '仲良', 'なかよ'], category: 'こうりゅう', points: 3 },
		{ keywords: ['絵', 'え', 'お絵描き', '工作', 'こうさく', '音楽', 'おんがく', '歌', 'うた', '折り紙', 'おりがみ', '作', 'つく', 'ブロック', '粘土', 'ねんど', '料理', 'りょうり'], category: 'そうぞう', points: 5 },
	];

	for (const rule of rules) {
		for (const kw of rule.keywords) {
			if (lower.includes(kw)) {
				const icons = CATEGORY_ICONS[rule.category] ?? ['📝'];
				return {
					name: text.slice(0, 50),
					category: rule.category,
					icon: icons[0]!,
					basePoints: rule.points,
				};
			}
		}
	}

	// デフォルト
	return {
		name: text.slice(0, 50),
		category: 'せいかつ',
		icon: '📝',
		basePoints: 5,
	};
}
