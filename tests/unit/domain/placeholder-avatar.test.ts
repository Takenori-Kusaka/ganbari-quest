// tests/unit/domain/placeholder-avatar.test.ts
// #4413: 仮アバター SVG の組み立て（純粋関数）のテスト。
//
// この関数は子供の登録時に自動で呼ばれ、ニックネームの頭文字とテーマ色だけで
// アバター画像を作る。外部通信は一切しない（その保証は
// tests/unit/architecture/placeholder-avatar-offline.test.ts が機械で表明する）。

import { describe, expect, it } from 'vitest';
import {
	buildPlaceholderAvatarSvg,
	PLACEHOLDER_AVATAR_CONTENT_TYPE,
} from '$lib/domain/placeholder-avatar';

describe('buildPlaceholderAvatarSvg (#4413)', () => {
	it('ニックネームの頭文字を SVG のテキストに埋める', () => {
		const svg = buildPlaceholderAvatarSvg('まさと', 'blue');

		expect(svg).toContain('<svg');
		expect(svg).toContain('</svg>');
		expect(svg).toContain('>ま<');
	});

	it('テーマ色は app.css の [data-theme] 実値と一致する', () => {
		// blue: --theme-50 = #e1f5fe (背景) / --theme-accent = --theme-600 = #039be5 (文字)
		const svg = buildPlaceholderAvatarSvg('たろう', 'blue');

		expect(svg).toContain('#e1f5fe');
		expect(svg).toContain('#039be5');
	});

	it('テーマごとに配色が変わる', () => {
		const blue = buildPlaceholderAvatarSvg('あ', 'blue');
		const green = buildPlaceholderAvatarSvg('あ', 'green');

		expect(blue).not.toEqual(green);
	});

	it('未知のテーマは pink にフォールバックする', () => {
		const unknown = buildPlaceholderAvatarSvg('あ', 'no-such-theme');
		const pink = buildPlaceholderAvatarSvg('あ', 'pink');

		expect(unknown).toEqual(pink);
	});

	it('サロゲートペア（絵文字）のニックネームでも 1 文字を壊さずに取り出す', () => {
		// String.prototype.charAt(0) だと上位サロゲートだけを取り出して文字化けする
		const svg = buildPlaceholderAvatarSvg('🐰うさぎ', 'pink');

		expect(svg).toContain('>🐰<');
		expect(svg).not.toContain('\uD83D<');
	});

	it('ニックネームに含まれる SVG/XML 特殊文字をエスケープする', () => {
		// 保護者が入力した文字列をそのまま SVG に埋めると、その SVG は
		// <img src> で配信されるとはいえ壊れた XML になる。エスケープを固定する。
		const svg = buildPlaceholderAvatarSvg('<script>', 'pink');

		expect(svg).not.toContain('><script><');
		expect(svg).toContain('&lt;');
	});

	it('空のニックネームでも壊れた SVG を返さない', () => {
		const svg = buildPlaceholderAvatarSvg('', 'pink');

		expect(svg).toContain('<svg');
		expect(svg).toContain('</svg>');
	});

	it('content type は SVG', () => {
		expect(PLACEHOLDER_AVATAR_CONTENT_TYPE).toBe('image/svg+xml');
	});
});
