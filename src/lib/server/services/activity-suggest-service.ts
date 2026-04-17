// src/lib/server/services/activity-suggest-service.ts
// 自然言語から活動情報を推定するサービス (#721: Bedrock Claude Haiku)

import { joinIcon } from '$lib/domain/icon-utils';
import { getCategoryByName } from '$lib/domain/validation/activity';
import { getAiProvider, isAiAvailable } from '$lib/server/ai/factory';
import { logger } from '$lib/server/logger';

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

/** よく使う活動名の漢字↔ひらがな対応表 */
const NAME_PAIR_TABLE: Record<string, { kana: string; kanji: string }> = {
	すいえい: { kana: 'すいえい', kanji: '水泳' },
	水泳: { kana: 'すいえい', kanji: '水泳' },
	はみがき: { kana: 'はみがき', kanji: '歯みがき' },
	歯みがき: { kana: 'はみがき', kanji: '歯みがき' },
	歯磨き: { kana: 'はみがき', kanji: '歯磨き' },
	おかたづけ: { kana: 'おかたづけ', kanji: 'お片付け' },
	お片付け: { kana: 'おかたづけ', kanji: 'お片付け' },
	片付け: { kana: 'かたづけ', kanji: '片付け' },
	かたづけ: { kana: 'かたづけ', kanji: '片付け' },
	そうじ: { kana: 'そうじ', kanji: '掃除' },
	掃除: { kana: 'そうじ', kanji: '掃除' },
	せんたく: { kana: 'せんたく', kanji: '洗濯' },
	洗濯: { kana: 'せんたく', kanji: '洗濯' },
	りょうり: { kana: 'りょうり', kanji: '料理' },
	料理: { kana: 'りょうり', kanji: '料理' },
	どくしょ: { kana: 'どくしょ', kanji: '読書' },
	読書: { kana: 'どくしょ', kanji: '読書' },
	さんすう: { kana: 'さんすう', kanji: '算数' },
	算数: { kana: 'さんすう', kanji: '算数' },
	しゅくだい: { kana: 'しゅくだい', kanji: '宿題' },
	宿題: { kana: 'しゅくだい', kanji: '宿題' },
	べんきょう: { kana: 'べんきょう', kanji: '勉強' },
	勉強: { kana: 'べんきょう', kanji: '勉強' },
	えいご: { kana: 'えいご', kanji: '英語' },
	英語: { kana: 'えいご', kanji: '英語' },
	たいそう: { kana: 'たいそう', kanji: '体操' },
	体操: { kana: 'たいそう', kanji: '体操' },
	さんぽ: { kana: 'さんぽ', kanji: '散歩' },
	散歩: { kana: 'さんぽ', kanji: '散歩' },
	おえかき: { kana: 'おえかき', kanji: 'お絵描き' },
	お絵描き: { kana: 'おえかき', kanji: 'お絵描き' },
	こうさく: { kana: 'こうさく', kanji: '工作' },
	工作: { kana: 'こうさく', kanji: '工作' },
	おりがみ: { kana: 'おりがみ', kanji: '折り紙' },
	折り紙: { kana: 'おりがみ', kanji: '折り紙' },
	なわとび: { kana: 'なわとび', kanji: '縄跳び' },
	縄跳び: { kana: 'なわとび', kanji: '縄跳び' },
	きがえ: { kana: 'きがえ', kanji: '着替え' },
	着替え: { kana: 'きがえ', kanji: '着替え' },
	おふろ: { kana: 'おふろ', kanji: 'お風呂' },
	お風呂: { kana: 'おふろ', kanji: 'お風呂' },
	じてんしゃ: { kana: 'じてんしゃ', kanji: '自転車' },
	自転車: { kana: 'じてんしゃ', kanji: '自転車' },
	あいさつ: { kana: 'あいさつ', kanji: '挨拶' },
	挨拶: { kana: 'あいさつ', kanji: '挨拶' },
	ねんど: { kana: 'ねんど', kanji: '粘土' },
	粘土: { kana: 'ねんど', kanji: '粘土' },
};

/** Bedrock tool_use 用のスキーマ定義 */
const ACTIVITY_TOOL = {
	name: 'suggest_activity',
	description: '子供の活動テキストからカテゴリ・アイコン・ポイントを推定した結果を返す',
	inputSchema: {
		type: 'object' as const,
		properties: {
			name: { type: 'string', description: '活動名（ひらがな中心、10文字以内）' },
			nameKana: { type: 'string', description: '全ひらがな表記（漢字・カタカナを含まない）' },
			nameKanji: { type: 'string', description: '漢字混じり表記' },
			category: {
				type: 'string',
				enum: ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう'],
				description: '活動カテゴリ',
			},
			mainIcon: { type: 'string', description: '活動の主な対象を表す絵文字' },
			subIcon: {
				type: 'string',
				description: '活動の動作や状態を表す絵文字（不要なら空文字）',
			},
			basePoints: {
				type: 'number',
				enum: [3, 5, 8, 10],
				description: 'ポイント（3:簡単, 5:ちょっと頑張る, 8:時間がかかる, 10:特別なチャレンジ）',
			},
		},
		required: ['name', 'nameKana', 'nameKanji', 'category', 'mainIcon', 'basePoints'],
	},
};

/** テキストがひらがな・カタカナのみかを判定 */
function isKanaOnly(text: string): boolean {
	return /^[\u3040-\u309F\u30A0-\u30FF\u30FC\u3000-\u3002\uFF01-\uFF5Eー・、。\s]+$/.test(text);
}

/** テキストに漢字が含まれるか */
function hasKanji(text: string): boolean {
	return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
}

const SYSTEM_PROMPT = `あなたは子供の活動をカテゴリ分けするアシスタントです。
活動テキストを分析し、suggest_activity ツールを使って結果を返してください。

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

アイコンルール:
- mainIcon: 活動の主な対象を表す絵文字（例: お風呂→🛁、歯→🪥）
- subIcon: 活動の動作や状態を表す絵文字（例: 掃除→🧹）、不要なら空文字

活動名ルール:
- name: デフォルト表示名（ひらがな中心、10文字以内）
- nameKana: 全ひらがな表記（漢字・カタカナを含まない）
- nameKanji: 漢字混じり表記`;

/** 自然言語テキストから活動情報を推定 */
export async function suggestActivity(text: string): Promise<SuggestedActivity> {
	if (isAiAvailable()) {
		try {
			return await suggestWithAi(text);
		} catch (e) {
			logger.error('[activity-suggest] AI API失敗、フォールバック使用', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { text },
			});
		}
	}

	// フォールバック: キーワードベースの簡易推定
	return suggestByKeywords(text);
}

async function suggestWithAi(text: string): Promise<SuggestedActivity> {
	const provider = getAiProvider();
	const result = await provider.converseWithTool({
		system: SYSTEM_PROMPT,
		userMessage: `活動テキスト: "${text}"`,
		tool: ACTIVITY_TOOL,
	});

	const obj = result.input;

	// バリデーション
	const catDef = getCategoryByName(String(obj.category ?? ''));
	const categoryId = catDef?.id ?? 3;
	const basePoints = [3, 5, 8, 10].includes(Number(obj.basePoints)) ? Number(obj.basePoints) : 5;

	// 複合アイコン対応
	const mainIcon = String(obj.mainIcon ?? '📝');
	const subIcon = obj.subIcon ? String(obj.subIcon) : null;
	const icon = joinIcon(mainIcon, subIcon);

	const fallbackNames = inferNames(text);
	return {
		name: String(obj.name ?? text).slice(0, 50),
		categoryId,
		icon,
		basePoints,
		nameKana: obj.nameKana ? String(obj.nameKana).slice(0, 50) : fallbackNames.nameKana,
		nameKanji: obj.nameKanji ? String(obj.nameKanji).slice(0, 50) : fallbackNames.nameKanji,
		source: 'gemini', // API 互換性のため 'gemini' を維持
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
	const best = scores[0] as (typeof scores)[0];

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

/** 入力テキストからnameKana/nameKanjiを推定（NAME_PAIR_TABLE で相互変換） */
function inferNames(text: string): { nameKana: string | null; nameKanji: string | null } {
	const trimmed = text.trim().slice(0, 50);

	// NAME_PAIR_TABLE で完全一致 → 両方のペアを返す
	const pair = NAME_PAIR_TABLE[trimmed];
	if (pair) {
		return { nameKana: pair.kana, nameKanji: pair.kanji };
	}

	// 部分一致: テキストに含まれるキーワードから推定
	for (const [key, val] of Object.entries(NAME_PAIR_TABLE)) {
		if (trimmed.includes(key)) {
			if (isKanaOnly(trimmed)) {
				return { nameKana: trimmed, nameKanji: val.kanji };
			}
			if (hasKanji(trimmed)) {
				return { nameKana: val.kana, nameKanji: trimmed };
			}
		}
	}

	if (isKanaOnly(trimmed)) {
		return { nameKana: trimmed, nameKanji: null };
	}

	if (hasKanji(trimmed)) {
		return { nameKana: null, nameKanji: trimmed };
	}

	return { nameKana: null, nameKanji: null };
}
