// src/lib/server/services/activity-suggest-service.ts
// 自然言語から活動情報を推定するサービス

import { joinIcon } from '$lib/domain/icon-utils';
import { getCategoryByName } from '$lib/domain/validation/activity';
import { logger } from '$lib/server/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface SuggestedActivity {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	nameKana: string | null;
	nameKanji: string | null;
	source: 'gemini' | 'fallback';
}

const CATEGORY_ICONS: Record<string, string[]> = {
	うんどう: ['🤸', '⚽', '🏃', '🏊', '🚴', '⚾', '🎾', '🏀'],
	べんきょう: ['📖', '✏️', '🔢', '📝', '🧮', '📚', '🔬', '🌍'],
	せいかつ: ['🪥', '🧹', '👕', '🍽️', '🛏️', '🧺', '🚿', '🌱'],
	こうりゅう: ['🤝', '👋', '💬', '🎉', '👫', '🤗', '📱', '✉️'],
	そうぞう: ['🎨', '✂️', '🎹', '🎸', '📷', '🏗️', '🧩', '🎤'],
};

/** キーワード→アイコンの詳細マッピング */
const KEYWORD_ICONS: Record<string, string> = {
	サッカー: '⚽',
	さっかー: '⚽',
	野球: '⚾',
	やきゅう: '⚾',
	水泳: '🏊',
	すいえい: '🏊',
	プール: '🏊',
	自転車: '🚴',
	じてんしゃ: '🚴',
	テニス: '🎾',
	てにす: '🎾',
	バスケ: '🏀',
	ばすけ: '🏀',
	体操: '🤸',
	たいそう: '🤸',
	なわとび: '🪢',
	縄跳び: '🪢',
	散歩: '🚶',
	さんぽ: '🚶',
	ダンス: '💃',
	だんす: '💃',
	柔道: '🥋',
	じゅうどう: '🥋',
	空手: '🥋',
	からて: '🥋',
	ピアノ: '🎹',
	ぴあの: '🎹',
	ギター: '🎸',
	ぎたー: '🎸',
	歌: '🎤',
	うた: '🎤',
	合唱: '🎤',
	読書: '📖',
	どくしょ: '📖',
	本: '📖',
	ほん: '📖',
	算数: '🔢',
	さんすう: '🔢',
	計算: '🔢',
	けいさん: '🔢',
	英語: '🇦',
	えいご: '🇦',
	ひらがな: '✏️',
	カタカナ: '✏️',
	宿題: '📝',
	しゅくだい: '📝',
	歯みがき: '🪥',
	はみがき: '🪥',
	歯磨き: '🪥',
	片付け: '🧹',
	かたづけ: '🧹',
	おかたづけ: '🧹',
	掃除: '🧹',
	そうじ: '🧹',
	洗濯: '🧺',
	せんたく: '🧺',
	料理: '🍳',
	りょうり: '🍳',
	お風呂: '🛁',
	おふろ: '🛁',
	着替え: '👕',
	きがえ: '👕',
	ごはん: '🍽️',
	お絵描き: '🎨',
	おえかき: '🎨',
	絵: '🎨',
	工作: '✂️',
	こうさく: '✂️',
	折り紙: '🪭',
	おりがみ: '🪭',
	ブロック: '🧩',
	ぶろっく: '🧩',
	レゴ: '🧩',
	粘土: '🏗️',
	ねんど: '🏗️',
	あいさつ: '👋',
	挨拶: '👋',
	ありがとう: '🙏',
	お礼: '🙏',
};

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		return null;
	}
	return new GoogleGenerativeAI(apiKey);
}

/** JSONをレスポンスから安全に抽出 */
function extractJson(text: string): unknown {
	// 1. ```json ... ``` コードブロックを探す
	const codeBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
	if (codeBlock?.[1]) {
		return JSON.parse(codeBlock[1]);
	}

	// 2. ブラケットマッチングで最初の完全なJSONオブジェクトを抽出
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

/** テキストがひらがな・カタカナのみかを判定 */
function isKanaOnly(text: string): boolean {
	return /^[\u3040-\u309F\u30A0-\u30FF\u30FC\u3000-\u3002\uFF01-\uFF5Eー・、。\s]+$/.test(text);
}

/** テキストに漢字が含まれるか */
function hasKanji(text: string): boolean {
	return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
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

async function suggestWithGemini(
	client: GoogleGenerativeAI,
	text: string,
): Promise<SuggestedActivity> {
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

活動名は3つの表記を必ずすべて返してください（省略禁止）:
- name: デフォルト表示名（ひらがな中心、10文字以内）
- nameKana: 小さい子向けの全ひらがな表記（漢字・カタカナを含まない）
- nameKanji: 小学生以上向けの漢字混じり表記

重要: nameKana と nameKanji は name と同じ内容でも必ず値を返してください。nullにしないでください。

以下のJSON形式のみで回答（説明不要）:
{"name": "活動名", "nameKana": "ひらがな表記", "nameKanji": "漢字表記", "category": "カテゴリ名", "mainIcon": "メイン絵文字", "subIcon": "サブ絵文字またはnull", "basePoints": 数値}`;

	const result = await model.generateContent(prompt);
	const responseText = result.response.text();

	// JSONを安全に抽出
	const parsed = extractJson(responseText);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('No valid JSON in Gemini response');
	}

	const obj = parsed as Record<string, unknown>;

	// バリデーション
	const catDef = getCategoryByName(String(obj.category ?? ''));
	const categoryId = catDef?.id ?? 3; // デフォルト: せいかつ
	const basePoints = [3, 5, 8, 10].includes(Number(obj.basePoints)) ? Number(obj.basePoints) : 5;

	// 複合アイコン対応: mainIcon+subIcon → icon
	const mainIcon = String(obj.mainIcon ?? obj.icon ?? '📝');
	const subIcon = obj.subIcon ? String(obj.subIcon) : null;
	const icon = joinIcon(mainIcon, subIcon);

	return {
		name: String(obj.name ?? text).slice(0, 50),
		categoryId,
		icon,
		basePoints,
		nameKana: obj.nameKana ? String(obj.nameKana).slice(0, 50) : null,
		nameKanji: obj.nameKanji ? String(obj.nameKanji).slice(0, 50) : null,
		source: 'gemini',
	};
}

/** キーワードベースの簡易推定（Gemini APIがない場合のフォールバック） */
function suggestByKeywords(text: string): SuggestedActivity {
	const lower = text.toLowerCase();

	const rules: {
		keywords: string[];
		categoryName: string;
		categoryId: number;
		basePoints: number;
	}[] = [
		{
			keywords: [
				'走',
				'はし',
				'かけっこ',
				'ボール',
				'サッカー',
				'さっかー',
				'水泳',
				'すいえい',
				'体操',
				'たいそう',
				'なわとび',
				'プール',
				'散歩',
				'さんぽ',
				'自転車',
				'じてんしゃ',
				'ダンス',
				'だんす',
				'スポーツ',
				'すぽーつ',
				'柔道',
				'じゅうどう',
				'空手',
				'からて',
				'バスケ',
				'ばすけ',
				'野球',
				'やきゅう',
				'テニス',
				'てにす',
			],
			categoryName: 'うんどう',
			categoryId: 1,
			basePoints: 5,
		},
		{
			keywords: [
				'読書',
				'どくしょ',
				'計算',
				'けいさん',
				'ひらがな',
				'カタカナ',
				'宿題',
				'しゅくだい',
				'勉強',
				'べんきょう',
				'英語',
				'えいご',
				'算数',
				'さんすう',
				'漢字',
				'かんじ',
				'ドリル',
				'どりる',
				'九九',
				'くく',
			],
			categoryName: 'べんきょう',
			categoryId: 2,
			basePoints: 5,
		},
		{
			keywords: [
				'歯',
				'はみがき',
				'みがき',
				'片付',
				'かたづ',
				'着替',
				'きが',
				'手伝',
				'てつだ',
				'洗',
				'あら',
				'掃除',
				'そうじ',
				'ごはん',
				'お風呂',
				'おふろ',
				'ふろ',
				'靴',
				'くつ',
				'布団',
				'ふとん',
				'トイレ',
				'といれ',
				'水やり',
				'みずやり',
			],
			categoryName: 'せいかつ',
			categoryId: 3,
			basePoints: 3,
		},
		{
			keywords: [
				'あいさつ',
				'挨拶',
				'友達',
				'ともだち',
				'ありがとう',
				'ごめん',
				'遊',
				'あそ',
				'話',
				'はな',
				'お礼',
				'おれい',
				'仲良',
				'なかよ',
				'手紙',
				'てがみ',
				'おてがみ',
				'先生',
				'せんせい',
			],
			categoryName: 'こうりゅう',
			categoryId: 4,
			basePoints: 3,
		},
		{
			keywords: [
				'絵',
				'え',
				'お絵描き',
				'おえかき',
				'工作',
				'こうさく',
				'音楽',
				'おんがく',
				'歌',
				'うた',
				'折り紙',
				'おりがみ',
				'作',
				'つく',
				'ブロック',
				'ぶろっく',
				'粘土',
				'ねんど',
				'料理',
				'りょうり',
				'ピアノ',
				'ぴあの',
				'ギター',
				'ぎたー',
			],
			categoryName: 'そうぞう',
			categoryId: 5,
			basePoints: 5,
		},
	];

	// スコアリング: 各カテゴリのヒット数を数えて最高スコアを選択
	const scores = rules.map((rule) => {
		let score = 0;
		for (const kw of rule.keywords) {
			if (lower.includes(kw)) score++;
		}
		return { ...rule, score };
	});

	scores.sort((a, b) => b.score - a.score);
	const best = scores[0]!;

	// マッチしなかった場合のデフォルト
	if (best.score === 0) {
		return {
			name: text.slice(0, 50),
			categoryId: 3,
			icon: '📝',
			basePoints: 5,
			...inferNames(text),
			source: 'fallback',
		};
	}

	// キーワード別アイコンを探す
	let icon = CATEGORY_ICONS[best.categoryName]?.[0] ?? '📝';
	for (const [kw, ic] of Object.entries(KEYWORD_ICONS)) {
		if (lower.includes(kw.toLowerCase())) {
			icon = ic;
			break;
		}
	}

	// ポイント細分化: 習い事系は8P
	const practiceKeywords = [
		'ピアノ',
		'ぴあの',
		'ギター',
		'ぎたー',
		'水泳',
		'すいえい',
		'柔道',
		'じゅうどう',
		'空手',
		'からて',
		'バレエ',
		'ばれえ',
		'英語',
		'えいご',
	];
	let points = best.basePoints;
	for (const kw of practiceKeywords) {
		if (lower.includes(kw.toLowerCase())) {
			points = 8;
			break;
		}
	}

	return {
		name: text.slice(0, 50),
		categoryId: best.categoryId,
		icon,
		basePoints: points,
		...inferNames(text),
		source: 'fallback',
	};
}

/** 入力テキストからnameKana/nameKanjiを推定 */
function inferNames(text: string): { nameKana: string | null; nameKanji: string | null } {
	const trimmed = text.trim().slice(0, 50);

	if (isKanaOnly(trimmed)) {
		// ひらがな・カタカナのみ → nameKana として設定
		return { nameKana: trimmed, nameKanji: null };
	}

	if (hasKanji(trimmed)) {
		// 漢字を含む → nameKanji として設定
		return { nameKana: null, nameKanji: trimmed };
	}

	return { nameKana: null, nameKanji: null };
}
