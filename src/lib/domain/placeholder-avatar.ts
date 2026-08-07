// src/lib/domain/placeholder-avatar.ts
// #4413: 子供の登録時に自動で付ける「仮アバター」の SVG を組み立てる。
//
// # なぜここにあるか
//
// 元は image-service.ts の `generateFallbackAvatar()` — アバターの AI 生成 (Gemini) が
// 失敗したときの代替として置かれていた。#4397 / PR #4404 で AI 生成を廃止した際、
// この関数も**親機能に巻き込まれて**一緒に消えた。
//
// しかし写真をアップロードしない家庭にとっては、これが唯一のアバター設定手段であり、
// 「子供の顔写真を上げたくない保護者」は本製品の主要ターゲットである。fallback ではなく
// **登録フローの一次機能**なので、名前 (`buildPlaceholderAvatarSvg`) も配置 (domain の純粋関数)
// も実態に合わせ直した。
//
// # なぜ import が 1 本も無いか
//
// 「子供のニックネームを運営者の環境の外へ出さない」ことを、構文で表明するため。
// import が 0 本なら HTTP client も SDK も掴みようがなく、外部送信が不可能になる。
// tests/unit/architecture/placeholder-avatar-offline.test.ts が機械で固定している。
// 永続化 (storage 書き込み / avatar_url 更新) は呼び出し側の child-service が持つ。
//
// # 色について
//
// SVG は <img src> で独立して読み込まれるため、アプリの CSS custom property
// (--theme-50 等) が届かない。したがって hex を持たざるを得ない。値は
// src/lib/ui/styles/app.css の [data-theme="..."] 実値と一致させてある
// (背景 = --theme-50 / 文字 = --theme-accent)。app.css 側を変えたら本表も追随すること。

/** 仮アバターの MIME type */
export const PLACEHOLDER_AVATAR_CONTENT_TYPE = 'image/svg+xml';

/** 仮アバターのファイル拡張子 */
export const PLACEHOLDER_AVATAR_EXTENSION = 'svg';

interface AvatarColors {
	/** 背景 (app.css の --theme-50) */
	bg: string;
	/** 頭文字・枠線 (app.css の --theme-accent) */
	fg: string;
}

/** 未知のテーマ / テーマ未設定のときの既定配色 (pink) */
const DEFAULT_COLORS: AvatarColors = { bg: '#fff0f5', fg: '#e91e7b' };

/** app.css の [data-theme] と一致する配色 (背景 = --theme-50 / 文字 = --theme-accent) */
const THEME_COLORS: Record<string, AvatarColors> = {
	pink: DEFAULT_COLORS,
	blue: { bg: '#e1f5fe', fg: '#039be5' },
	green: { bg: '#e8f5e9', fg: '#388e3c' },
	orange: { bg: '#fff3e0', fg: '#f57c00' },
	purple: { bg: '#f3e5f5', fg: '#7b1fa2' },
};

/** SVG (XML) のテキストノードに埋めても壊れない形にする */
function escapeXmlText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * ニックネームの先頭 1 文字を取り出す。
 *
 * `charAt(0)` はサロゲートペア (絵文字を含むニックネーム) の上位サロゲートだけを返して
 * 文字化けするため、コードポイント単位で取る。
 */
function firstGrapheme(nickname: string): string {
	return [...nickname.trim()][0] ?? '';
}

/**
 * 子供のニックネームとテーマから、頭文字入りの円形アバター SVG を組み立てる。
 *
 * 純粋関数 — 外部通信も I/O も行わない。
 *
 * @param nickname 子供のニックネーム (先頭 1 文字のみ使う)
 * @param theme 子供のテーマ (`pink` / `blue` / `green` / `orange` / `purple`)
 */
export function buildPlaceholderAvatarSvg(nickname: string, theme: string): string {
	const { bg, fg } = THEME_COLORS[theme] ?? DEFAULT_COLORS;
	const initial = escapeXmlText(firstGrapheme(nickname));

	return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img">
  <circle cx="128" cy="128" r="128" fill="${bg}"/>
  <circle cx="128" cy="100" r="50" fill="${fg}" opacity="0.2"/>
  <text x="128" y="140" font-size="80" font-family="sans-serif" font-weight="bold" fill="${fg}" text-anchor="middle" dominant-baseline="central">${initial}</text>
  <circle cx="128" cy="128" r="124" fill="none" stroke="${fg}" stroke-width="4" opacity="0.3"/>
</svg>`;
}
