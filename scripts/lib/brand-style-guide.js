/**
 * scripts/lib/brand-style-guide.js
 *
 * がんばりクエスト ブランドスタイル定数 — SSOT
 * generate-image.mjs および既存の generate-*.mjs スクリプトから参照する。
 *
 * 詳細: docs/reference/gemini_image_generation_guide.md
 */

/** ブランドスタイルブロック（すべての生成プロンプトの冒頭に貼り付ける）*/
export const BRAND_STYLE_BLOCK = `Art style: kawaii chibi flat illustration. Head-to-body ratio 1:1.5.
Oversized round head with large expressive eyes (occupying 35-40% of face area).
Cel-shaded warm pastel palette. Clean 2-3px flat outlines, no complex gradients.
Warm white highlight dot on each eye. Chubby rounded cheeks with subtle pink blush circles.
Transparent background (PNG). No text, no watermarks, no UI elements in image.
Brand colors: Blue #5BA3E6→#3878B8, Gold #FFE44D→#FFCC00, Skin #FFE0B2→#FFCC80.
Reference character: D3 warrior (blue helmet + cape + gold magic wand + star emblem on chest).
Style must be consistent with existing assets: hero-default.png, common-slime.png, chukichi.png.`;

/** 標準ネガティブプロンプト（すべての生成に含める）*/
export const NEGATIVE_PROMPTS = `Negative prompts (always include):
realistic human proportions, photorealistic, 3D render, CGI, 3D modeling,
heavy shadows, dramatic lighting, dark or gloomy mood,
text overlay, watermark, logo, signature,
adult content, violence, scary imagery,
complex background (unless background art category),
anime screenshot style, manga screentone`;

/** レアリティ別追加プロンプト語彙 */
export const RARITY_KEYWORDS = {
	N: 'simple clean design, single color accent, minimal details, soft colors',
	R: 'sparkle star accent, colored outline glow (subtle), 2 color accents, dynamic feel',
	SR: 'ornate golden glow effect, particle sparkles around item, jewel accent, premium feel',
	UR: 'legendary prismatic rainbow shimmer, aura glow, constellation particle effects, mythical sacred energy',
};

/** カテゴリ別設定 */
export const CATEGORY_CONFIG = {
	stamp: {
		size: '128x128 pixels',
		aspectRatio: '1:1',
		background: 'transparent',
		template: (subject, rarityKw) =>
			`${BRAND_STYLE_BLOCK}
A cute kawaii chibi stamp seal item for a children's gamification app.
The stamp depicts: ${subject}.
${rarityKw}
128x128 pixels, square format, transparent background.
${NEGATIVE_PROMPTS}.`,
	},
	badge: {
		size: '256x256 pixels',
		aspectRatio: '1:1',
		background: 'transparent',
		template: (subject, rarityKw) =>
			`${BRAND_STYLE_BLOCK}
A cute achievement badge for a children's gamification app.
Badge shape: circular medal with decorative border.
The badge represents: ${subject}.
${rarityKw}
256x256 pixels, square format, transparent background.
${NEGATIVE_PROMPTS}.`,
	},
	title: {
		size: '128x128 pixels',
		aspectRatio: '1:1',
		background: 'transparent',
		template: (subject, rarityKw) =>
			`${BRAND_STYLE_BLOCK}
A cute heraldic emblem crest icon for a children's gamification title system.
The title represents: ${subject}.
Emblem style: circular crest with the symbol as central motif.
${rarityKw}
128x128 pixels, square format, transparent background.
${NEGATIVE_PROMPTS}.`,
	},
	character: {
		size: '512x512 pixels',
		aspectRatio: '1:1',
		background: 'transparent',
		template: (subject, _rarityKw) =>
			`${BRAND_STYLE_BLOCK}
A cute kawaii chibi character for a children's gamification app.
Character description: ${subject}.
Must match the reference character's head-to-body ratio, eye size, and brand colors exactly.
512x512 pixels or larger, transparent background.
${NEGATIVE_PROMPTS}, complex background.`,
	},
	background: {
		size: '1920x1080 pixels',
		aspectRatio: '16:9',
		background: 'gradient',
		template: (subject, _rarityKw) =>
			`${BRAND_STYLE_BLOCK}
A cute kawaii background illustration for a children's app.
Scene description: ${subject}.
Soft gradient background (not transparent), pastel colors matching brand palette.
Leave center-bottom area relatively uncluttered for UI overlay.
1920x1080 pixels, landscape format.
${NEGATIVE_PROMPTS}.`,
	},
	marketing: {
		size: '1200x630 pixels',
		aspectRatio: '16:9',
		background: 'gradient',
		template: (subject, _rarityKw) =>
			`${BRAND_STYLE_BLOCK}
A marketing illustration for a children's gamification app.
Description: ${subject}.
No text, no letters in the image. Character positioned on left, open space on right for text overlay.
Soft gradient background, bright and cheerful colors.
${NEGATIVE_PROMPTS}.`,
	},
	general: {
		size: 'auto',
		aspectRatio: '1:1',
		background: 'transparent',
		template: (subject, rarityKw) =>
			`${BRAND_STYLE_BLOCK}
${subject}
${rarityKw}
Transparent background.
${NEGATIVE_PROMPTS}.`,
	},
};

/** デフォルト参照画像パス */
export const DEFAULT_REFERENCE_IMAGE = 'static/assets/brand/master-character-sheet.png';

/** フォールバック参照画像パス（master-character-sheet.png が未生成の場合） */
export const FALLBACK_REFERENCE_IMAGE = 'static/assets/battle/characters/hero-default.png';

/** モデル ID マッピング */
export const MODEL_IDS = {
	flash: 'gemini-2.0-flash-preview-image-generation',
	pro: 'gemini-2.5-pro',
};
