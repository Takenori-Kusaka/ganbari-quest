// src/lib/ui/actions/image-error.ts
// <img> の読み込み失敗を拾う Svelte attachment。`onerror={...}` の代わりに `{@attach imageError(...)}` で使う。
//
// Svelte 5 は `onerror` / `onload` 属性か `use:` action を持つ <img> の SSR 出力に
// `onload="this.__e=event" onerror="this.__e=event"` というインライン属性を付ける (hydration 前の
// イベントを後で再生するため)。アプリの CSP は script-src を hash で絞っているので、この属性は
// 実行されない。Chrome 156 以降は「実行されない」だけでなく、属性を持つ要素ごとに script-src-attr の
// CSP 違反を報告する (画像が正常に読めても出る)。attachment ではこの属性が出ない。
//
// 再生が無い代わりに、hydration 前に失敗していた場合 (complete なのに描画できる中身が無い) は
// attach 時に decode() で確かめてから handler を呼ぶ。naturalWidth だけで判定すると、寸法を
// 持たない正常な SVG まで失敗扱いになるため。

import type { Attachment } from 'svelte/attachments';

export function imageError(handler: () => void): Attachment<HTMLImageElement> {
	return (img) => {
		img.addEventListener('error', handler);

		if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
			img.decode().catch(handler);
		}

		return () => img.removeEventListener('error', handler);
	};
}
