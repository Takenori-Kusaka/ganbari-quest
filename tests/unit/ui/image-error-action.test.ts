// tests/unit/ui/image-error-action.test.ts
// `{@attach imageError(...)}` — <img> の読み込み失敗で handler を呼び、SSR 出力にインラインの onerror 属性を出さないこと。
// (Chrome 156 は CSP 下のインライン onerror 属性ごとに script-src-attr 違反を報告する)

import { readFileSync } from 'node:fs';
import { render } from '@testing-library/svelte';
import { compile } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';
import { imageError } from '../../../src/lib/ui/actions/image-error';
import AvatarDisplay from '../../../src/lib/ui/components/AvatarDisplay.svelte';

function makeImg(opts: { complete: boolean; naturalWidth: number; src?: string }) {
	const img = document.createElement('img');
	if (opts.src) img.setAttribute('src', opts.src);
	Object.defineProperty(img, 'complete', { value: opts.complete });
	Object.defineProperty(img, 'naturalWidth', { value: opts.naturalWidth });
	return img;
}

describe('imageError attachment', () => {
	it('error イベントで handler を呼び、cleanup 後は呼ばない', () => {
		const img = makeImg({ complete: false, naturalWidth: 0, src: '/a.png' });
		const handler = vi.fn();
		const cleanup = imageError(handler)(img);

		img.dispatchEvent(new Event('error'));
		expect(handler).toHaveBeenCalledTimes(1);

		if (typeof cleanup === 'function') cleanup();
		img.dispatchEvent(new Event('error'));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('mount 前に失敗していた画像は decode() の失敗で handler を呼ぶ', async () => {
		const img = makeImg({ complete: true, naturalWidth: 0, src: '/broken.png' });
		img.decode = () => Promise.reject(new Error('broken'));
		const handler = vi.fn();
		imageError(handler)(img);

		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
	});

	it('寸法を持たないが decode できる画像 (SVG 等) は失敗扱いしない', async () => {
		const img = makeImg({ complete: true, naturalWidth: 0, src: '/no-size.svg' });
		const decode = vi.fn(() => Promise.resolve());
		img.decode = decode;
		const handler = vi.fn();
		imageError(handler)(img);

		await Promise.resolve();
		await Promise.resolve();
		expect(decode).toHaveBeenCalledTimes(1);
		expect(handler).not.toHaveBeenCalled();
	});

	it('読み込み中 / 読み込み済みの画像では decode しない', () => {
		for (const state of [
			{ complete: false, naturalWidth: 0 },
			{ complete: true, naturalWidth: 256 },
		]) {
			const img = makeImg({ ...state, src: '/a.png' });
			const decode = vi.fn(() => Promise.resolve());
			img.decode = decode;
			imageError(vi.fn())(img);
			expect(decode).not.toHaveBeenCalled();
		}
	});
});

// avatar の <img> を描く component。onerror を持つ <img> を足したら、ここにも足す。
const AVATAR_IMG_COMPONENTS = [
	'src/lib/ui/components/AvatarDisplay.svelte',
	'src/lib/features/admin/components/ChildListCard.svelte',
	'src/lib/features/admin/components/ChildProfileCard.svelte',
	'src/routes/switch/+page.svelte',
];

describe('avatar <img> の SSR 出力', () => {
	it.each(
		AVATAR_IMG_COMPONENTS,
	)('%s: インラインのイベント属性 (this.__e=event) を出さない', (file) => {
		const { js } = compile(readFileSync(file, 'utf-8'), { generate: 'server', filename: file });
		expect(js.code).toContain('<img');
		expect(js.code).not.toContain('__e=event');
	});
});

describe('AvatarDisplay', () => {
	it('画像の読み込みに失敗したら 👤 に切り替わる', async () => {
		const { container } = render(AvatarDisplay, {
			props: { nickname: 'たろう', avatarUrl: '/missing.png' },
		});
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		img?.dispatchEvent(new Event('error'));

		await vi.waitFor(() => expect(container.querySelector('img')).toBeNull());
		expect(container.textContent).toContain('👤');
	});
});
