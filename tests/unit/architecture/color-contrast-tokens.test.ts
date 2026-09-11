// tests/unit/architecture/color-contrast-tokens.test.ts
// #4645: 「文字色トークン × その上に載る背景トークン」の組み合わせが WCAG 1.4.3 AA (4.5:1) を
// 満たすことを app.css から実値で検証する fitness function。
//
// なぜ必要か: Lighthouse 実測で子供ホーム / ショップ / 親ダッシュボード / LP の 4 画面が
// color-contrast で fail していた (最悪 1.51:1)。原因は個別 component ではなく **トークンの値**
// で、`--theme-primary` を白文字の塗りにも白背景の文字にも使い回していたこと。値を直したあと
// 「誰かがブランド色を明るく戻す」「新テーマを足すときに strong 系を書き忘れる」で静かに戻るため、
// 組み合わせを列挙して数値で固定する (ADR-0061 same-class-N→guard)。
//
// 本 test は **app.css の値そのもの**を読む。component 側でどのトークンを使っているかは
// Lighthouse / axe (tests/e2e/a11y-critical-cuj.spec.ts) が担う二層構成。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = path.resolve(process.cwd(), 'src/lib/ui/styles/app.css');
// コメントを落としてから宣言をパースする (宣言値の中に /* ... */ が挟まると値が汚れる)。
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** WCAG 相対輝度。 */
function channel(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
	const r = Number.parseInt(full.slice(0, 2), 16);
	const g = Number.parseInt(full.slice(2, 4), 16);
	const b = Number.parseInt(full.slice(4, 6), 16);
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
	const l1 = luminance(a);
	const l2 = luminance(b);
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * `[data-theme="<name>"]` ブロック (name 省略時は最初の `:root` + `@theme`) の宣言を読む。
 * CSS カスタムプロパティの `var()` は **宣言された要素**で解決されるため、テーマ配下の値を
 * 見るときはそのブロック → :root/@theme の順に辿る (本番のカスケードと同じ順序)。
 */
function readBlock(selector: string): Record<string, string> {
	const start = css.indexOf(selector);
	if (start === -1) throw new Error(`app.css に ${selector} が無い`);
	const open = css.indexOf('{', start);
	const end = css.indexOf('\n}', open);
	const body = css.slice(open + 1, end);
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		const key = m[1];
		const value = m[2];
		if (key && value) out[key] = value.trim();
	}
	return out;
}

const themeBlock = '@theme';
const rootBlock = '\n:root {';
const globals = { ...readBlock(themeBlock), ...readBlock(rootBlock) };

/** トークン名を hex まで解決する (テーマブロック → :root/@theme の順)。 */
function resolve(token: string, themeVars: Record<string, string> = {}): string {
	const initial = themeVars[token] ?? globals[token];
	if (!initial) throw new Error(`app.css に ${token} が無い`);
	let value: string = initial;
	let guard = 0;
	while (value.startsWith('var(')) {
		if (guard++ > 12) throw new Error(`${token} の var() 解決が循環している`);
		const inner = value.slice(4, value.indexOf(')')).trim();
		const next = themeVars[inner] ?? globals[inner];
		if (!next) throw new Error(`${token} → ${inner} が解決できない`);
		value = next.trim();
	}
	if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) {
		throw new Error(`${token} が hex に解決されない: ${value}`);
	}
	return value;
}

const THEMES = ['pink', 'blue', 'green', 'orange', 'purple', 'admin'] as const;
const WHITE = '#ffffff';
const AA = 4.5;

describe('カラートークンの WCAG AA コントラスト (#4645)', () => {
	describe.each(THEMES)('[data-theme="%s"]', (theme) => {
		const vars = readBlock(`[data-theme="${theme}"]`);

		it('--theme-primary-strong は白に対して AA を満たす (白文字の塗り / 白背景の文字の両用)', () => {
			const strong = resolve('--theme-primary-strong', vars);
			expect(contrastRatio(strong, WHITE), `${theme}: ${strong}`).toBeGreaterThanOrEqual(AA);
		});

		it('--color-action-primary-strong がテーマ内で再宣言され、テーマ色に解決される', () => {
			// :root だけで宣言すると var() が :root で解決され、テーマ配下でもブランド色が
			// 継承される (実測でピンクのはずの子供ヘッダーが青くなった)。
			expect(
				vars['--color-action-primary-strong'],
				`${theme}: テーマブロックで --color-action-primary-strong を再宣言すること`,
			).toBe('var(--theme-primary-strong)');
			expect(resolve('--color-action-primary-strong', vars)).toBe(
				resolve('--theme-primary-strong', vars),
			);
		});

		it('--theme-nav の上のテキスト色 (通常 / 選択中) が AA を満たす', () => {
			const nav = resolve('--theme-nav', vars);
			const muted = resolve('--color-text-on-theme-nav', vars);
			const accent = resolve('--color-text-accent-on-theme-nav', vars);
			expect(contrastRatio(muted, nav), `${theme}: ${muted} on ${nav}`).toBeGreaterThanOrEqual(AA);
			expect(contrastRatio(accent, nav), `${theme}: ${accent} on ${nav}`).toBeGreaterThanOrEqual(
				AA,
			);
		});
	});

	it('ポイント残高などのゴールド文字は白 / gold-100 の上で AA を満たす', () => {
		const gold = resolve('--color-text-gold');
		expect(contrastRatio(gold, WHITE)).toBeGreaterThanOrEqual(AA);
		expect(contrastRatio(gold, resolve('--color-gold-100'))).toBeGreaterThanOrEqual(AA);
	});

	it('暖色強調テキストは白 / orange-100 の上で AA を満たす', () => {
		const warm = resolve('--color-text-warning-strong');
		expect(contrastRatio(warm, WHITE)).toBeGreaterThanOrEqual(AA);
		expect(contrastRatio(warm, resolve('--color-orange-100'))).toBeGreaterThanOrEqual(AA);
	});

	it('プランバッジは文字と背景の組みで AA を満たす', () => {
		// [data-plan="family"] / [data-plan="standard"] 相当のブロックを直接読む。
		for (const block of [
			'--plan-badge-bg: var(--color-gold-100)',
			'--plan-badge-bg: var(--color-premium-50)',
		]) {
			const at = css.indexOf(block);
			expect(at, `app.css に ${block} が無い`).toBeGreaterThan(-1);
			const segment = css.slice(at, css.indexOf('}', at));
			const bgToken = segment.match(/--plan-badge-bg:\s*var\((--[\w-]+)\)/)?.[1];
			const textToken = segment.match(/--plan-badge-text:\s*var\((--[\w-]+)\)/)?.[1];
			expect(bgToken).toBeTruthy();
			expect(textToken).toBeTruthy();
			const bg = resolve(bgToken as string);
			const fg = resolve(textToken as string);
			expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
		}
	});

	it('非トートロジー証明: 明らかに AA を満たさない組みは fail 判定される', () => {
		// 修正前に実際に本番へ出ていた組み合わせ (ピンク #ff69b4 に白文字 = 2.64:1)。
		expect(contrastRatio('#ff69b4', WHITE)).toBeLessThan(AA);
	});
});
