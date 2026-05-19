// src/lib/server/services/cheer-suggest-service.ts
// 出来事テキストから応援ポイント情報を推定するサービス (#2273)
//
// reward-suggest-service と別 service。入力プロンプト・出力意味が異なる:
//  - reward-suggest: 「ごほうび案テキスト → ごほうび情報」(子供 shop に並べる商品の提案)
//  - cheer-suggest:  「出来事テキスト   → 応援 P + 理由要約」(子供のがんばりに対する応援)
//
// 共通機構 (AI provider / fallback パターン / SuggestedXxx 型) は同型を維持し、
// 重複コード ≤ 10 行で別 service 化 (ADR-0014 OSS 先調査原則整合)。

import { getAiProvider, isAiAvailable } from '$lib/server/ai/factory';
import { logger } from '$lib/server/logger';

export interface SuggestedCheer {
	/** 理由要約 (出来事の短い言い換え、15文字以内) */
	reason: string;
	/** 推奨応援 P 値 (出来事のすごさ評価) */
	points: number;
	/** カテゴリ */
	category: string;
	/** 表すアイコン (絵文字 1 個) */
	icon: string;
	/** 提案ソース */
	source: 'gemini' | 'fallback';
}

/** キーワード→カテゴリ+アイコン+P値の詳細マッピング (フォールバック用) */
const CHEER_KEYWORD_MAP: {
	keywords: string[];
	category: string;
	icon: string;
	pointsHint: number;
}[] = [
	// 日本ローカライズ — 節句・季節行事 (#2300、EPIC #2294 ⑥)
	// 親が現実イベント後に承認する 1 タップ操作（ADR-0012 anti-engagement 整合、滞在ゼロ）。
	// シーズン期間中の自動配信は不採用。家族コミュニケーション wedge 強化として、
	// 行事関連の出来事入力時にカテゴリ/アイコン/P 値を fallback 推定する。
	// 「ひな祭りのお手伝い」のように `お手伝い` 等の汎用キーワードを含む文でも
	// 行事キーワードが優先されるよう、本ブロックは配列冒頭に配置する。
	{
		keywords: ['ひな祭り', 'ひなまつり', 'ひな人形', 'ひなにんぎょう', '雛祭り'],
		category: 'せいかつ',
		icon: '🎎',
		pointsHint: 30,
	},
	{
		keywords: ['こどもの日', '子供の日', 'こいのぼり', '鯉のぼり', '端午の節句', 'たんごのせっく'],
		category: 'そうぞう',
		icon: '🎏',
		pointsHint: 50,
	},
	{
		keywords: ['七夕', 'たなばた', '短冊', 'たんざく', '織姫', 'おりひめ', '彦星', 'ひこぼし'],
		category: 'そうぞう',
		icon: '🎋',
		pointsHint: 20,
	},
	{
		keywords: ['敬老の日', 'けいろうのひ', 'じいじ', 'ばあば', 'おじいちゃん', 'おばあちゃん'],
		category: 'こうりゅう',
		icon: '💌',
		pointsHint: 50,
	},

	// うんどう（運動・身体）— 大会・順位は高めに評価
	{
		keywords: ['1位', 'いちい', '優勝', 'ゆうしょう', '金メダル', 'きんめだる'],
		category: 'うんどう',
		icon: '🥇',
		pointsHint: 500,
	},
	{
		keywords: ['2位', 'にい', '銀メダル', 'ぎんめだる', '準優勝'],
		category: 'うんどう',
		icon: '🥈',
		pointsHint: 300,
	},
	{
		keywords: ['3位', 'さんい', '銅メダル', 'どうめだる', '入賞'],
		category: 'うんどう',
		icon: '🥉',
		pointsHint: 200,
	},
	{
		keywords: ['運動会', 'うんどうかい', 'リレー', 'りれー', '徒競走', 'ときょうそう'],
		category: 'うんどう',
		icon: '🏃',
		pointsHint: 200,
	},
	{
		keywords: ['サッカー', 'さっかー', '野球', 'やきゅう', 'バスケ', 'ばすけ'],
		category: 'うんどう',
		icon: '⚽',
		pointsHint: 150,
	},
	{
		keywords: ['水泳', 'すいえい', 'プール', 'ぷーる'],
		category: 'うんどう',
		icon: '🏊',
		pointsHint: 150,
	},

	// べんきょう（学習）— テスト点数・成績は高評価
	{
		keywords: ['100点', 'ひゃくてん', 'まんてん', '満点'],
		category: 'べんきょう',
		icon: '💯',
		pointsHint: 500,
	},
	{
		keywords: ['90点', '95点', '高得点', 'こうとくてん'],
		category: 'べんきょう',
		icon: '📝',
		pointsHint: 300,
	},
	{
		keywords: ['テスト', 'てすと', '試験', 'しけん'],
		category: 'べんきょう',
		icon: '📝',
		pointsHint: 200,
	},
	{
		keywords: ['宿題', 'しゅくだい', 'ホームワーク', 'ほーむわーく'],
		category: 'べんきょう',
		icon: '✏️',
		pointsHint: 100,
	},
	{
		keywords: ['漢字', 'かんじ', '計算', 'けいさん', 'ドリル', 'どりる'],
		category: 'べんきょう',
		icon: '📚',
		pointsHint: 100,
	},
	{
		keywords: ['読書', 'どくしょ', '本を読', 'ほんをよ'],
		category: 'べんきょう',
		icon: '📖',
		pointsHint: 100,
	},

	// せいかつ（生活・お手伝い）— 自発的な行動を高めに評価
	{
		keywords: ['お皿', 'おさら', '皿洗い', 'さらあらい', '食器', 'しょっき'],
		category: 'せいかつ',
		icon: '🍽️',
		pointsHint: 100,
	},
	{
		keywords: ['お風呂', 'おふろ', '掃除', 'そうじ', 'お掃除'],
		category: 'せいかつ',
		icon: '🧹',
		pointsHint: 150,
	},
	{
		keywords: ['洗濯', 'せんたく', 'たたみ', 'たたんで'],
		category: 'せいかつ',
		icon: '👕',
		pointsHint: 100,
	},
	{
		keywords: ['料理', 'りょうり', '手伝い', 'てつだい', 'お手伝い'],
		category: 'せいかつ',
		icon: '🍳',
		pointsHint: 150,
	},
	{
		keywords: ['早起き', 'はやおき', '時間通り', 'じかんどおり'],
		category: 'せいかつ',
		icon: '⏰',
		pointsHint: 100,
	},
	{
		keywords: ['歯磨き', 'はみがき', '片付け', 'かたづけ'],
		category: 'せいかつ',
		icon: '🪥',
		pointsHint: 50,
	},

	// こうりゅう（交流・社会性）
	{
		keywords: ['友達', 'ともだち', '優しく', 'やさしく', '助け', 'たすけ'],
		category: 'こうりゅう',
		icon: '🤝',
		pointsHint: 150,
	},
	{
		keywords: ['挨拶', 'あいさつ', 'ありがとう'],
		category: 'こうりゅう',
		icon: '👋',
		pointsHint: 50,
	},
	{
		keywords: ['ごめん', '謝', 'あやま', '仲直り', 'なかなおり'],
		category: 'こうりゅう',
		icon: '🤗',
		pointsHint: 100,
	},

	// そうぞう（創造）
	{
		keywords: ['絵', 'え', 'お絵描き', 'おえかき', '描いた', 'かいた'],
		category: 'そうぞう',
		icon: '🎨',
		pointsHint: 100,
	},
	{
		keywords: ['工作', 'こうさく', '折り紙', 'おりがみ', '作った', 'つくった'],
		category: 'そうぞう',
		icon: '🎭',
		pointsHint: 150,
	},
	{
		keywords: ['ピアノ', 'ぴあの', '楽器', 'がっき', '演奏', 'えんそう'],
		category: 'そうぞう',
		icon: '🎹',
		pointsHint: 200,
	},
];

/** AI provider 共通の tool_use スキーマ */
const CHEER_TOOL = {
	name: 'suggest_cheer',
	description: '子供のがんばり出来事に対する応援内容を推定した結果を返す',
	inputSchema: {
		type: 'object' as const,
		properties: {
			reason: {
				type: 'string',
				description: '出来事の理由要約（15文字以内）',
			},
			category: {
				type: 'string',
				enum: ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう', 'とくべつ'],
				description: 'カテゴリ名',
			},
			icon: { type: 'string', description: '出来事を表す1つの絵文字' },
			points: {
				type: 'number',
				enum: [50, 100, 150, 200, 300, 500, 1000],
				description:
					'応援ポイント（50:小さいがんばり, 100:普通のがんばり, 200:大きながんばり, 500:特別なすごさ, 1000:特大の達成）',
			},
		},
		required: ['reason', 'category', 'icon', 'points'],
	},
};

const SYSTEM_PROMPT = `あなたは子供のがんばりを応援するアシスタントです。
子供の出来事テキストを分析し、suggest_cheer ツールを使って応援内容を返してください。

カテゴリ（必ず以下から1つ選択）:
- うんどう（運動・スポーツ・体育）
- べんきょう（学習・宿題・テスト・読書）
- せいかつ（お手伝い・生活習慣・自律）
- こうりゅう（友達・家族・挨拶・社会性）
- そうぞう（絵・工作・音楽・創作）
- とくべつ（上記以外の特別な出来事）

応援ポイント基準（出来事のすごさで評価。子供の活動ポイントとは別の応援 P）:
- 50: 小さながんばり（毎日のルーティン、簡単なこと）
- 100: 普通のがんばり（自発的なお手伝い、宿題完了）
- 200: 大きながんばり（テストで高得点、大会出場）
- 300: 特に頑張った（入賞、難しい目標達成）
- 500: 特別なすごさ（大会優勝、満点）
- 1000: 特大の達成（全国レベル、大きな表彰）

アイコンは出来事を表す1つの絵文字を選んでください。
理由は出来事の短い言い換え（15文字以内、子供にわかりやすく）にしてください。`;

/** 自然言語テキストから応援内容を推定 */
export async function suggestCheer(text: string): Promise<SuggestedCheer> {
	if (isAiAvailable()) {
		try {
			return await suggestWithAi(text);
		} catch (e) {
			logger.error('[cheer-suggest] AI API失敗、フォールバック使用', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { text },
			});
		}
	}

	return suggestByKeywords(text);
}

async function suggestWithAi(text: string): Promise<SuggestedCheer> {
	const provider = getAiProvider();
	const result = await provider.converseWithTool({
		system: SYSTEM_PROMPT,
		userMessage: `出来事: "${text}"`,
		tool: CHEER_TOOL,
	});

	const obj = result.input;

	const validCategories = [
		'うんどう',
		'べんきょう',
		'せいかつ',
		'こうりゅう',
		'そうぞう',
		'とくべつ',
	];
	const category = validCategories.includes(String(obj.category ?? ''))
		? String(obj.category)
		: 'とくべつ';

	const validPoints = [50, 100, 150, 200, 300, 500, 1000];
	const rawPoints = Number(obj.points ?? 100);
	const points = validPoints.reduce((prev, curr) =>
		Math.abs(curr - rawPoints) < Math.abs(prev - rawPoints) ? curr : prev,
	);

	return {
		reason: String(obj.reason ?? text).slice(0, 50),
		points,
		icon: String(obj.icon ?? '✨'),
		category,
		source: 'gemini',
	};
}

/** キーワードベースの簡易推定（AI APIがない場合のフォールバック） */
function suggestByKeywords(text: string): SuggestedCheer {
	const lower = text.toLowerCase();

	for (const entry of CHEER_KEYWORD_MAP) {
		for (const kw of entry.keywords) {
			if (lower.includes(kw.toLowerCase())) {
				return {
					reason: text.slice(0, 50),
					points: entry.pointsHint,
					icon: entry.icon,
					category: entry.category,
					source: 'fallback',
				};
			}
		}
	}

	// デフォルト
	return {
		reason: text.slice(0, 50),
		points: 100,
		icon: '✨',
		category: 'とくべつ',
		source: 'fallback',
	};
}
