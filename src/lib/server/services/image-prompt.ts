// src/lib/server/services/image-prompt.ts
// Gemini 画像生成用プロンプトテンプレート

/** キャラクタータイプ別の外見ヒント */
const CHARACTER_HINTS: Record<string, string> = {
	beginner:
		'A cheerful child just starting their journey, simple outfit with a small backpack, bright curious eyes, warm pastel color palette',
	growing:
		'An adventurous child making progress, casual explorer outfit with a compass accessory, determined expression, green and blue color palette',
	skilled:
		'A confident young adventurer with a cool outfit, decorated with star badges, proud smile, blue and gold color palette',
	expert:
		'A skilled hero with an impressive outfit and flowing cape, glowing accessories, radiant confidence, purple and gold color palette',
	master:
		'A legendary hero in magnificent armor with ethereal glow, crown of light, awe-inspiring presence, gold and rainbow color palette',
};

/** テーマ色に応じた色パレットヒント */
const THEME_COLORS: Record<string, string> = {
	pink: 'soft pink, rose, and white tones',
	blue: 'sky blue, navy, and silver tones',
	green: 'emerald green, lime, and gold tones',
	purple: 'lavender, violet, and silver tones',
	orange: 'warm orange, amber, and cream tones',
};

/** 子供用キャラクターアバター生成プロンプト */
export function buildAvatarPrompt(params: {
	nickname: string;
	age: number;
	theme: string;
	characterType: string;
	level: number;
}): string {
	const { nickname, age, theme, characterType, level } = params;
	const characterHint = CHARACTER_HINTS[characterType] ?? CHARACTER_HINTS.beginner;
	const colorHint = THEME_COLORS[theme] ?? THEME_COLORS.pink;

	return `Generate a cute, child-friendly anime-style character avatar for a gamification app.

Character details:
- Name: ${nickname}
- Age inspiration: ${age} years old
- Level: ${level}
- Character type: ${characterType}

Appearance:
${characterHint}

Color palette:
${colorHint}

Art style requirements (CRITICAL):
- Cute chibi/SD (super-deformed) anime style, suitable for children
- Large round eyes with sparkle highlights
- Simple, clean line art
- Bright, cheerful color palette
- Friendly and approachable expression
- NO scary, violent, or inappropriate elements
- Child-safe content only

Composition:
- Circular portrait, head and upper body
- Centered, facing forward with slight angle
- Simple gradient background matching the color palette
- Clean edges suitable for circular crop

Technical:
- 512x512 pixels
- Clean vector-like quality
- Transparent or solid color background
- High contrast for small display sizes`;
}

/** faviconアプリアイコン生成プロンプト */
export function buildFaviconPrompt(): string {
	return `Generate a simple, bold app icon for a children's gamification app called "がんばりクエスト" (Ganbari Quest - meaning "Effort Quest").

Design requirements:
- A cute star character with a determined/happy expression
- Bright yellow/gold star with simple face (two dot eyes, small smile)
- Simple geometric shape that reads well at 32x32 pixels
- Bold outlines, minimal detail
- Vibrant colors: gold star on a soft blue circle background
- Child-friendly, cheerful, energetic feel
- App icon style (rounded square or circle)

Technical:
- 256x256 pixels
- Clean, crisp edges
- High contrast for favicon use
- Simple enough to be recognizable at very small sizes`;
}
