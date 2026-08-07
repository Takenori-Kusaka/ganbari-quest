// tests/unit/components/avatar-display-image-error-fallback.test.ts
// #4429: アバター画像の取得に失敗したら 👤 に落ちることを固定する。
//
// なぜ必要か: `{#if avatarUrl}` だけの分岐は「URL は非 null だが取得できない」状態
// (オフライン / 実体欠落 / 権限失効後) を拾えず、ブラウザ既定の壊れ画像アイコンが描画される。
// 本 PR は service worker から `/tenants/*` を外してオフライン時にフェッチが失敗し得る状態を
// 作るため、その時の描画を「壊れ画像」ではなく 👤 に確定させる。文字の読めない年齢帯
// (baby / preschool、docs/DESIGN.md §8) では壊れ画像は 👤 より情報量が少ない。

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AvatarDisplay from '../../../src/lib/ui/components/AvatarDisplay.svelte';

describe('AvatarDisplay — 画像取得失敗時の 👤 フォールバック (#4429)', () => {
	afterEach(() => {
		cleanup();
	});

	it('avatarUrl が非 null なら通常は img を描画する (前提)', () => {
		render(AvatarDisplay, { nickname: 'たろう', avatarUrl: '/tenants/t-1/avatars/3/x.png' });
		expect(screen.getByRole('img', { name: 'たろう' })).toBeTruthy();
		expect(screen.queryByText('👤')).toBeNull();
	});

	it('img が error を発火したら 👤 に落ちる (壊れ画像アイコンを出さない)', async () => {
		render(AvatarDisplay, { nickname: 'たろう', avatarUrl: '/tenants/t-1/avatars/3/x.png' });
		const img = screen.getByRole('img', { name: 'たろう' });

		await fireEvent.error(img);

		expect(
			screen.getByText('👤'),
			'取得失敗時は 👤 にフォールバックする (ブラウザ既定の壊れ画像を出さない)',
		).toBeTruthy();
		expect(screen.queryByRole('img', { name: 'たろう' })).toBeNull();
	});

	it('avatarUrl が null のときは従来どおり 👤 (回帰なし)', () => {
		render(AvatarDisplay, { nickname: 'たろう', avatarUrl: null });
		expect(screen.getByText('👤')).toBeTruthy();
	});
});
