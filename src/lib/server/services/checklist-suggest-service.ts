// src/lib/server/services/checklist-suggest-service.ts
// 自然言語からチェックリストアイテムを推定するサービス (#720: Bedrock Claude Haiku)

import { getAiProvider, isAiAvailable } from '$lib/server/ai/factory';
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

/** Bedrock tool_use 用のスキーマ定義 */
const CHECKLIST_TOOL = {
	name: 'suggest_checklist',
	description: '子供の持ち物チェックリストをテキストから推定した結果を返す',
	inputSchema: {
		type: 'object' as const,
		properties: {
			templateName: {
				type: 'string',
				description: 'テンプレート名（ひらがな中心、15文字以内）',
			},
			templateIcon: {
				type: 'string',
				description: 'シーンを表す1つの絵文字',
			},
			items: {
				type: 'array',
				description: '持ち物リスト（5〜10個）',
				items: {
					type: 'object',
					properties: {
						name: { type: 'string', description: 'アイテム名（ひらがな中心、10文字以内）' },
						icon: { type: 'string', description: 'アイテムを表す1つの絵文字' },
						frequency: {
							type: 'string',
							description: '頻度（"daily" を基本。特定の曜日なら "weekday:月" 等）',
						},
						direction: {
							type: 'string',
							enum: ['bring', 'return', 'both'],
							description: '"bring"（持参）, "return"（持帰）, "both"（往復）',
						},
					},
					required: ['name', 'icon', 'frequency', 'direction'],
				},
			},
		},
		required: ['templateName', 'templateIcon', 'items'],
	},
};

const SYSTEM_PROMPT = `あなたは子供の持ち物チェックリストを作るアシスタントです。
テキストを分析し、suggest_checklist ツールを使って必要な持ち物リストを返してください。

ルール:
- 子供（3歳〜15歳）の日常シーンを想定
- アイテム名はひらがな中心で子供にわかりやすく（10文字以内）
- アイコンは各アイテムを表す1つの絵文字
- frequency は "daily"（まいにち）を基本。特定の曜日なら "weekday:月" 等
- direction は "bring"（持参）, "return"（持帰）, "both"（往復）から選択
- テンプレート名もひらがな中心で15文字以内
- テンプレートアイコンもシーンを表す1つの絵文字
- アイテムは5〜10個が適切`;

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
	if (isAiAvailable()) {
		try {
			return await suggestWithAi(text);
		} catch (e) {
			logger.error('[checklist-suggest] AI API失敗、フォールバック使用', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { text },
			});
		}
	}

	return suggestByKeywords(text);
}

async function suggestWithAi(text: string): Promise<SuggestedChecklist> {
	const provider = getAiProvider();
	const result = await provider.converseWithTool({
		system: SYSTEM_PROMPT,
		userMessage: `テキスト: "${text}"`,
		tool: CHECKLIST_TOOL,
	});

	const obj = result.input;
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
		throw new Error('No items in Bedrock response');
	}

	return {
		templateName: String(obj.templateName ?? '').slice(0, 50) || 'もちものリスト',
		templateIcon: String(obj.templateIcon ?? '📋'),
		items,
		source: 'gemini', // API 互換性のため 'gemini' を維持
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
