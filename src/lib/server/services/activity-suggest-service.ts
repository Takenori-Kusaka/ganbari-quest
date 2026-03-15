// src/lib/server/services/activity-suggest-service.ts
// 自然言語から活動情報を推定するサービス

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getCategoryByName } from '$lib/domain/validation/activity';
import { joinIcon } from '$lib/domain/icon-utils';
import { logger } from '$lib/server/logger';

interface SuggestedActivity {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	nameKana: string | null;
	nameKanji: string | null;
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
			logger.error('[activity-suggest] Gemini API失敗、フォールバック使用', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { text },
			});
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

アイコンは「メインアイコン」と「サブアイコン」の2つで構成します。
- mainIcon: 活動の主な対象を表す絵文字（例: お風呂→🛁、歯→🪥）
- subIcon: 活動の動作や状態を表す絵文字（例: 掃除→🧹、水→💧）、不要ならnull
例: お風呂掃除→mainIcon:"🛁",subIcon:"🧹"、歯みがき→mainIcon:"🪥",subIcon:null

活動名は3つの表記を返してください:
- name: デフォルト表示名（ひらがな中心、10文字以内）
- nameKana: 小さい子向けのひらがな表記（漢字を含まない）。nameと同じならnull
- nameKanji: 小学生以上向けの漢字表記。nameと同じならnull

以下のJSON形式のみで回答（説明不要）:
{"name": "活動名", "nameKana": "ひらがな表記またはnull", "nameKanji": "漢字表記またはnull", "category": "カテゴリ名", "mainIcon": "メイン絵文字", "subIcon": "サブ絵文字またはnull", "basePoints": 数値}`;

	const result = await model.generateContent(prompt);
	const responseText = result.response.text();

	// JSONを抽出
	const jsonMatch = responseText.match(/\{[^}]+\}/);
	if (!jsonMatch) {
		throw new Error('No JSON in Gemini response');
	}

	const parsed = JSON.parse(jsonMatch[0]);

	// バリデーション
	const catDef = getCategoryByName(parsed.category);
	const categoryId = catDef?.id ?? 3; // デフォルト: せいかつ
	const basePoints = [3, 5, 8, 10].includes(parsed.basePoints) ? parsed.basePoints : 5;

	// 複合アイコン対応: mainIcon+subIcon → icon、後方互換で parsed.icon もフォールバック
	const mainIcon = String(parsed.mainIcon ?? parsed.icon ?? '📝');
	const subIcon = parsed.subIcon ? String(parsed.subIcon) : null;
	const icon = joinIcon(mainIcon, subIcon);

	return {
		name: String(parsed.name ?? text).slice(0, 50),
		categoryId,
		icon,
		basePoints,
		nameKana: parsed.nameKana ? String(parsed.nameKana).slice(0, 50) : null,
		nameKanji: parsed.nameKanji ? String(parsed.nameKanji).slice(0, 50) : null,
	};
}

/** キーワードベースの簡易推定（Gemini APIがない場合のフォールバック） */
function suggestByKeywords(text: string): SuggestedActivity {
	const lower = text.toLowerCase();

	const rules: { keywords: string[]; categoryName: string; categoryId: number; points: number }[] = [
		{ keywords: ['走', 'はし', 'ボール', 'サッカー', '水泳', 'すいえい', '体操', 'たいそう', 'なわとび', 'プール', '散歩', 'さんぽ', '自転車', 'じてんしゃ', 'ダンス', 'スポーツ'], categoryName: 'うんどう', categoryId: 1, points: 5 },
		{ keywords: ['読', 'よ', '書', 'か', '計算', 'けいさん', 'ひらがな', 'カタカナ', '宿題', 'しゅくだい', '勉強', 'べんきょう', '英語', 'えいご', 'ピアノ', '算数', 'さんすう', '本'], categoryName: 'べんきょう', categoryId: 2, points: 5 },
		{ keywords: ['歯', 'は', 'みがき', '片付', 'かたづ', '着替', 'きが', '手伝', 'てつだ', '洗', 'あら', '掃除', 'そうじ', 'ごはん', 'お風呂', 'ふろ', '靴', 'くつ'], categoryName: 'せいかつ', categoryId: 3, points: 3 },
		{ keywords: ['あいさつ', '友達', 'ともだち', 'ありがとう', 'ごめん', '遊', 'あそ', '話', 'はな', 'お礼', 'おれい', '仲良', 'なかよ'], categoryName: 'こうりゅう', categoryId: 4, points: 3 },
		{ keywords: ['絵', 'え', 'お絵描き', '工作', 'こうさく', '音楽', 'おんがく', '歌', 'うた', '折り紙', 'おりがみ', '作', 'つく', 'ブロック', '粘土', 'ねんど', '料理', 'りょうり'], categoryName: 'そうぞう', categoryId: 5, points: 5 },
	];

	for (const rule of rules) {
		for (const kw of rule.keywords) {
			if (lower.includes(kw)) {
				const icons = CATEGORY_ICONS[rule.categoryName] ?? ['📝'];
				return {
					name: text.slice(0, 50),
					categoryId: rule.categoryId,
					icon: icons[0]!,
					basePoints: rule.points,
					nameKana: null,
					nameKanji: null,
				};
			}
		}
	}

	// デフォルト
	return {
		name: text.slice(0, 50),
		categoryId: 3, // せいかつ
		icon: '📝',
		basePoints: 5,
		nameKana: null,
		nameKanji: null,
	};
}
