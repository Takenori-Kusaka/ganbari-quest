// src/lib/server/services/checklist-suggest-service.ts
// 自然言語からチェックリストアイテムを推定するサービス (#720)

import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '$lib/server/logger';

export interface SuggestedChecklistItem {
	name: string;
	icon: string;
	frequency: string;
	direction: string;
}

export interface SuggestedChecklist {
	templateName: string;
	templateIcon: string;
	items: SuggestedChecklistItem[];
	source: 'gemini' | 'fallback';
}

/** よくある持ち物のキーワード → アイコンマッピング */
const ITEM_ICON_MAP: Record<string, string> = {
	教科書: '📚',
	きょうかしょ: '📚',
	ノート: '📓',
	のーと: '📓',
	筆箱: '✏️',
	ふでばこ: '✏️',
	えんぴつ: '✏️',
	鉛筆: '✏️',
	消しゴム: '🧹',
	けしごむ: '🧹',
	連絡帳: '📝',
	れんらくちょう: '📝',
	給食袋: '🍱',
	きゅうしょくぶくろ: '🍱',
	ハンカチ: '🧣',
	はんかち: '🧣',
	ティッシュ: '🧻',
	てぃっしゅ: '🧻',
	水筒: '💧',
	すいとう: '💧',
	体操着: '👕',
	たいそうぎ: '👕',
	上履き: '👟',
	うわばき: '👟',
	お弁当: '🍱',
	おべんとう: '🍱',
	タオル: '🏖️',
	たおる: '🏖️',
	水着: '🩱',
	みずぎ: '🩱',
	帽子: '🧢',
	ぼうし: '🧢',
	リコーダー: '🎵',
	りこーだー: '🎵',
	絵の具: '🎨',
	えのぐ: '🎨',
	習字道具: '🖌️',
	しゅうじどうぐ: '🖌️',
	図書バッグ: '📚',
	としょばっぐ: '📚',
	ランドセル: '🎒',
	らんどせる: '🎒',
	リュック: '🎒',
	りゅっく: '🎒',
	歯ブラシ: '🪥',
	はぶらし: '🪥',
	パジャマ: '👕',
	ぱじゃま: '👕',
	着替え: '👕',
	きがえ: '👕',
	おやつ: '🍬',
	おもちゃ: '🧸',
	名札: '📛',
	なふだ: '📛',
	マスク: '😷',
	ますく: '😷',
};

/** テーマ別のプリセット持ち物リスト（フォールバック用） */
const PRESET_CHECKLISTS = {
	がっこう: {
		templateName: 'がっこうのもちもの',
		templateIcon: '🏫',
		items: [
			{ name: 'きょうかしょ', icon: '📚', frequency: 'daily', direction: 'both' },
			{ name: 'ノート', icon: '📓', frequency: 'daily', direction: 'both' },
			{ name: 'ふでばこ', icon: '✏️', frequency: 'daily', direction: 'both' },
			{ name: 'れんらくちょう', icon: '📝', frequency: 'daily', direction: 'both' },
			{ name: 'ハンカチ', icon: '🧣', frequency: 'daily', direction: 'bring' },
			{ name: 'ティッシュ', icon: '🧻', frequency: 'daily', direction: 'bring' },
			{ name: 'すいとう', icon: '💧', frequency: 'daily', direction: 'both' },
			{ name: 'なふだ', icon: '📛', frequency: 'daily', direction: 'bring' },
		],
	},
	たいいく: {
		templateName: 'たいいくのもちもの',
		templateIcon: '🤸',
		items: [
			{ name: 'たいそうぎ', icon: '👕', frequency: 'daily', direction: 'both' },
			{ name: 'うわばき', icon: '👟', frequency: 'daily', direction: 'both' },
			{ name: 'タオル', icon: '🏖️', frequency: 'daily', direction: 'both' },
			{ name: 'すいとう', icon: '💧', frequency: 'daily', direction: 'bring' },
		],
	},
	プール: {
		templateName: 'プールのもちもの',
		templateIcon: '🏊',
		items: [
			{ name: 'みずぎ', icon: '🩱', frequency: 'daily', direction: 'both' },
			{ name: 'ぼうし', icon: '🧢', frequency: 'daily', direction: 'both' },
			{ name: 'タオル', icon: '🏖️', frequency: 'daily', direction: 'both' },
			{ name: 'ゴーグル', icon: '🥽', frequency: 'daily', direction: 'both' },
			{ name: 'すいとう', icon: '💧', frequency: 'daily', direction: 'bring' },
		],
	},
	えんそく: {
		templateName: 'えんそくのもちもの',
		templateIcon: '🚌',
		items: [
			{ name: 'リュック', icon: '🎒', frequency: 'daily', direction: 'bring' },
			{ name: 'おべんとう', icon: '🍱', frequency: 'daily', direction: 'bring' },
			{ name: 'すいとう', icon: '💧', frequency: 'daily', direction: 'bring' },
			{ name: 'おやつ', icon: '🍬', frequency: 'daily', direction: 'bring' },
			{ name: 'ハンカチ', icon: '🧣', frequency: 'daily', direction: 'bring' },
			{ name: 'ティッシュ', icon: '🧻', frequency: 'daily', direction: 'bring' },
			{ name: 'レジャーシート', icon: '🏕️', frequency: 'daily', direction: 'bring' },
		],
	},
	おとまり: {
		templateName: 'おとまりのもちもの',
		templateIcon: '🌙',
		items: [
			{ name: 'パジャマ', icon: '👕', frequency: 'daily', direction: 'bring' },
			{ name: 'はぶらし', icon: '🪥', frequency: 'daily', direction: 'bring' },
			{ name: 'きがえ', icon: '👕', frequency: 'daily', direction: 'bring' },
			{ name: 'タオル', icon: '🏖️', frequency: 'daily', direction: 'bring' },
			{ name: 'ハンカチ', icon: '🧣', frequency: 'daily', direction: 'bring' },
		],
	},
};

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		logger.warn('[checklist-suggest] GEMINI_API_KEY未設定: フォールバックモードで動作');
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

/** アイテム名からアイコンを推定 */
function inferIcon(name: string): string {
	for (const [keyword, icon] of Object.entries(ITEM_ICON_MAP)) {
		if (name.includes(keyword)) {
			return icon;
		}
	}
	return '📦';
}

/** 自然言語テキストからチェックリストを推定 */
export async function suggestChecklist(text: string): Promise<SuggestedChecklist> {
	const client = getGeminiClient();

	if (client) {
		try {
			return await suggestWithGemini(client, text);
		} catch (e) {
			logger.error('[checklist-suggest] Gemini API失敗、フォールバック使用', {
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
): Promise<SuggestedChecklist> {
	const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

	const prompt = `あなたは子供の持ち物チェックリストを作るアシスタントです。
以下のテキストを分析し、必要な持ち物リストをJSON形式で回答してください。

テキスト: "${text}"

ルール:
- 子供（3歳〜15歳）の日常シーンを想定
- アイテム名はひらがな中心で子供にわかりやすく（10文字以内）
- アイコンは各アイテムを表す1つの絵文字
- frequency は "daily"（まいにち）を基本。特定の曜日なら "weekday:月" 等
- direction は "bring"（持参）, "return"（持帰）, "both"（往復）から選択
- テンプレート名もひらがな中心で15文字以内
- テンプレートアイコンもシーンを表す1つの絵文字
- アイテムは5〜10個が適切

以下のJSON形式のみで回答（説明不要）:
{
  "templateName": "テンプレート名",
  "templateIcon": "絵文字",
  "items": [
    {"name": "アイテム名", "icon": "絵文字", "frequency": "daily", "direction": "both"}
  ]
}`;

	const result = await model.generateContent(prompt);
	const responseText = result.response.text();

	const parsed = extractJson(responseText);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('No valid JSON in Gemini response');
	}

	const obj = parsed as Record<string, unknown>;
	const rawItems = Array.isArray(obj.items) ? obj.items : [];

	const validDirections = ['bring', 'return', 'both'];
	const items: SuggestedChecklistItem[] = rawItems
		.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
		.slice(0, 15)
		.map((item) => ({
			name: String(item.name ?? '').slice(0, 50),
			icon: String(item.icon ?? '📦'),
			frequency: String(item.frequency ?? 'daily'),
			direction: validDirections.includes(String(item.direction ?? ''))
				? String(item.direction)
				: 'both',
		}));

	if (items.length === 0) {
		throw new Error('No items in Gemini response');
	}

	return {
		templateName: String(obj.templateName ?? '').slice(0, 50) || 'もちものリスト',
		templateIcon: String(obj.templateIcon ?? '📋'),
		items,
		source: 'gemini',
	};
}

/** キーワードベースの簡易推定 */
function suggestByKeywords(text: string): SuggestedChecklist {
	const lower = text.toLowerCase();

	// プリセットマッチング
	for (const [keyword, preset] of Object.entries(PRESET_CHECKLISTS)) {
		if (lower.includes(keyword.toLowerCase())) {
			return { ...preset, source: 'fallback' };
		}
	}

	// 学校関連のキーワード
	const schoolKeywords = ['小学', 'しょうがく', '月曜', '火曜', '水曜', '木曜', '金曜', '学校'];
	if (schoolKeywords.some((kw) => lower.includes(kw))) {
		return { ...PRESET_CHECKLISTS.がっこう, source: 'fallback' };
	}

	// 水泳・プール関連
	const poolKeywords = ['水泳', 'すいえい', 'ぷーる'];
	if (poolKeywords.some((kw) => lower.includes(kw))) {
		return { ...PRESET_CHECKLISTS.プール, source: 'fallback' };
	}

	// 遠足・おでかけ関連
	const excursionKeywords = ['遠足', 'えんそく', 'おでかけ', 'ピクニック', 'ぴくにっく'];
	if (excursionKeywords.some((kw) => lower.includes(kw))) {
		return { ...PRESET_CHECKLISTS.えんそく, source: 'fallback' };
	}

	// お泊り関連
	const sleepoverKeywords = ['おとまり', 'お泊', 'キャンプ', 'きゃんぷ'];
	if (sleepoverKeywords.some((kw) => lower.includes(kw))) {
		return { ...PRESET_CHECKLISTS.おとまり, source: 'fallback' };
	}

	// デフォルト: テキストから個別アイテムを推定
	const words = text
		.split(/[、,\s]+/)
		.map((w) => w.trim())
		.filter((w) => w.length > 0);
	if (words.length >= 2) {
		const items: SuggestedChecklistItem[] = words.slice(0, 10).map((word) => ({
			name: word.slice(0, 50),
			icon: inferIcon(word),
			frequency: 'daily',
			direction: 'both',
		}));
		return {
			templateName: 'もちものリスト',
			templateIcon: '📋',
			items,
			source: 'fallback',
		};
	}

	// 最終フォールバック: 学校の基本持ち物
	return { ...PRESET_CHECKLISTS.がっこう, source: 'fallback' };
}
