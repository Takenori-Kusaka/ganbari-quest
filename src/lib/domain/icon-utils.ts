// src/lib/domain/icon-utils.ts
// 複合アイコン（2絵文字組み合わせ）のユーティリティ

export interface ParsedIcon {
	main: string;
	sub: string | null;
}

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/**
 * アイコン文字列をメイン+サブに分割する。
 * - "🤸" → { main: "🤸", sub: null }
 * - "🛁🧹" → { main: "🛁", sub: "🧹" }
 * ZWJ結合絵文字（👨‍👩‍👧等）は1 graphemeとして正しく扱う。
 */
export function splitIcon(icon: string): ParsedIcon {
	if (!icon) return { main: '', sub: null };
	const segments = [...segmenter.segment(icon)];
	return {
		main: segments[0]?.segment ?? '',
		sub: segments.length >= 2 ? (segments[1]?.segment ?? null) : null,
	};
}

/** メイン+サブアイコンを1つの文字列に結合する。 */
export function joinIcon(main: string, sub: string | null): string {
	if (!sub) return main;
	return main + sub;
}
