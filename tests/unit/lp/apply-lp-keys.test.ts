/**
 * #1701 ADR-0025: applyLpKeys の innerHTML + DOMPurify 注入機構テスト
 *
 * 検証範囲:
 *  1. 許可 tag (<strong>, <em>, <a href>, <br>, <span class>, <sup>, <sub>, <small>, <b>, <i>)
 *     が保持される
 *  2. 不許可 tag (<script>, <iframe>, onerror= 属性) が escape / strip される
 *  3. <a target="_blank"> に rel="noopener noreferrer" が hook で強制付与される
 *  4. DOMPurify 不在時 textContent fallback + console.warn が呼ばれる
 *
 * テスト戦略:
 *   site/shared-labels.js は IIFE でラップされており、関数を直接 import できない。
 *   そのため、JSDOM (vitest 既定 environment) 上で生成済み shared-labels.js を読み込み、
 *   注入された DOMPurify (devDep) で applyLpKeys の挙動を検証する。
 *   ここではテンプレートと同一ロジックを test scope で再現し、ADR-0025 §決定の sanitize 設定値が
 *   要求される動作を満たしていることを assert する。
 */
import DOMPurify from 'dompurify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * scripts/generate-lp-labels.mjs L377-420 の applyLpKeys テンプレートと同一実装。
 * テンプレートが変更された場合は本実装も同期更新すること（手動同期）。
 *
 * window.DOMPurify を読みに行く点も含めてテンプレートと完全に一致させる。
 */
function applyLpKeys(LP_LABELS: Record<string, Record<string, string>>): void {
	const elements = document.querySelectorAll('[data-lp-key]');
	// biome-ignore lint/suspicious/noExplicitAny: window.DOMPurify は CDN 経由で注入されるため型は any
	const Purify = (typeof window !== 'undefined' && (window as any).DOMPurify) || null;
	const SANITIZE_CONFIG = {
		ALLOWED_TAGS: ['strong', 'em', 'a', 'br', 'span', 'sup', 'sub', 'small', 'b', 'i'],
		ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'aria-hidden', 'aria-label'],
		ALLOW_DATA_ATTR: false,
		ALLOW_UNKNOWN_PROTOCOLS: false,
		ADD_ATTR: ['target'],
	};
	if (Purify && !Purify.__gqHookInstalled) {
		// biome-ignore lint/suspicious/noExplicitAny: hook 内 node は DOMPurify 内部型
		Purify.addHook('afterSanitizeAttributes', (node: any) => {
			if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
				node.setAttribute('rel', 'noopener noreferrer');
			}
		});
		Purify.__gqHookInstalled = true;
	}
	elements.forEach((el) => {
		const key = el.getAttribute('data-lp-key');
		if (!key) return;
		const parts = key.split('.');
		if (parts.length !== 2) return;
		const [sectionKey, fieldKey] = parts as [string, string];
		const sectionData = LP_LABELS[sectionKey];
		if (!sectionData) return;
		const value = sectionData[fieldKey];
		if (value === undefined) return;
		if (Purify) {
			el.innerHTML = Purify.sanitize(value, SANITIZE_CONFIG);
		} else {
			el.textContent = value;
			console.warn('[applyLpKeys] DOMPurify unavailable, fell back to textContent for', key);
		}
	});
}

describe('applyLpKeys (#1701 ADR-0025)', () => {
	// biome-ignore lint/suspicious/noExplicitAny: window stub の型管理
	const originalDOMPurify = (window as any).DOMPurify;

	beforeEach(() => {
		document.body.innerHTML = '';
	});

	afterEach(() => {
		// biome-ignore lint/suspicious/noExplicitAny: window stub の cleanup
		(window as any).DOMPurify = originalDOMPurify;
		vi.restoreAllMocks();
	});

	describe('(1) 許可 tag は保持される', () => {
		beforeEach(() => {
			// biome-ignore lint/suspicious/noExplicitAny: CDN 経由注入を再現するための window stub
			(window as any).DOMPurify = DOMPurify;
		});

		it('<strong> / <em> を保持する', () => {
			document.body.innerHTML = '<p data-lp-key="x.a">fallback</p>';
			applyLpKeys({ x: { a: '<strong>強調</strong>と<em>斜体</em>' } });
			const el = document.querySelector('[data-lp-key="x.a"]') as HTMLElement;
			expect(el.querySelector('strong')?.textContent).toBe('強調');
			expect(el.querySelector('em')?.textContent).toBe('斜体');
		});

		it('<a href> / <span class> を保持する', () => {
			document.body.innerHTML = '<p data-lp-key="x.b">fallback</p>';
			applyLpKeys({
				x: { b: '<a href="/pricing.html">料金</a>と<span class="hl">注釈</span>' },
			});
			const el = document.querySelector('[data-lp-key="x.b"]') as HTMLElement;
			const a = el.querySelector('a') as HTMLAnchorElement;
			expect(a.getAttribute('href')).toBe('/pricing.html');
			expect(a.textContent).toBe('料金');
			const span = el.querySelector('span') as HTMLElement;
			expect(span.getAttribute('class')).toBe('hl');
			expect(span.textContent).toBe('注釈');
		});

		it('<br> / <sup> / <sub> / <small> / <b> / <i> を保持する', () => {
			document.body.innerHTML = '<p data-lp-key="x.c">fallback</p>';
			applyLpKeys({
				x: {
					c: 'A<br>B<sup>1</sup><sub>2</sub><small>注</small><b>太字</b><i>イタ</i>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.c"]') as HTMLElement;
			expect(el.querySelector('br')).not.toBeNull();
			expect(el.querySelector('sup')?.textContent).toBe('1');
			expect(el.querySelector('sub')?.textContent).toBe('2');
			expect(el.querySelector('small')?.textContent).toBe('注');
			expect(el.querySelector('b')?.textContent).toBe('太字');
			expect(el.querySelector('i')?.textContent).toBe('イタ');
		});
	});

	describe('(2) XSS payload は escape / strip される', () => {
		beforeEach(() => {
			// biome-ignore lint/suspicious/noExplicitAny: window stub
			(window as any).DOMPurify = DOMPurify;
		});

		it('<script> tag を strip する', () => {
			document.body.innerHTML = '<p data-lp-key="x.s">fallback</p>';
			applyLpKeys({
				x: { s: 'safe<script>alert("xss")</script>tail' },
			});
			const el = document.querySelector('[data-lp-key="x.s"]') as HTMLElement;
			expect(el.querySelector('script')).toBeNull();
			expect(el.innerHTML).not.toContain('<script');
			expect(el.innerHTML).not.toContain('alert');
		});

		it('onerror= 属性付き <img> を strip する', () => {
			document.body.innerHTML = '<p data-lp-key="x.i">fallback</p>';
			applyLpKeys({
				x: { i: '<img src=x onerror="alert(1)">' },
			});
			const el = document.querySelector('[data-lp-key="x.i"]') as HTMLElement;
			expect(el.querySelector('img')).toBeNull();
			expect(el.innerHTML).not.toContain('onerror');
			expect(el.innerHTML).not.toContain('alert');
		});

		it('<iframe> を strip する', () => {
			document.body.innerHTML = '<p data-lp-key="x.f">fallback</p>';
			applyLpKeys({
				x: { f: '<iframe src="https://evil.example.com"></iframe>safe' },
			});
			const el = document.querySelector('[data-lp-key="x.f"]') as HTMLElement;
			expect(el.querySelector('iframe')).toBeNull();
			expect(el.innerHTML).not.toContain('<iframe');
		});

		it('javascript: URL を escape する', () => {
			document.body.innerHTML = '<p data-lp-key="x.j">fallback</p>';
			applyLpKeys({
				x: { j: '<a href="javascript:alert(1)">click</a>' },
			});
			const el = document.querySelector('[data-lp-key="x.j"]') as HTMLElement;
			const a = el.querySelector('a');
			// DOMPurify は javascript: protocol を href から削除（または anchor を strip）する
			if (a) {
				expect(a.getAttribute('href')?.startsWith('javascript:')).toBeFalsy();
			}
			expect(el.innerHTML).not.toContain('javascript:');
		});
	});

	describe('(3) target=_blank に rel=noopener noreferrer を強制する', () => {
		beforeEach(() => {
			// biome-ignore lint/suspicious/noExplicitAny: window stub
			(window as any).DOMPurify = DOMPurify;
		});

		it('<a target="_blank"> に rel が自動付与される', () => {
			document.body.innerHTML = '<p data-lp-key="x.t">fallback</p>';
			applyLpKeys({
				x: { t: '<a href="https://example.com" target="_blank">外部</a>' },
			});
			const el = document.querySelector('[data-lp-key="x.t"]') as HTMLElement;
			const a = el.querySelector('a') as HTMLAnchorElement;
			expect(a.getAttribute('target')).toBe('_blank');
			expect(a.getAttribute('rel')).toBe('noopener noreferrer');
		});

		it('target が無いリンクには rel を付与しない', () => {
			document.body.innerHTML = '<p data-lp-key="x.n">fallback</p>';
			applyLpKeys({
				x: { n: '<a href="/internal">内部</a>' },
			});
			const el = document.querySelector('[data-lp-key="x.n"]') as HTMLElement;
			const a = el.querySelector('a') as HTMLAnchorElement;
			expect(a.getAttribute('target')).toBeNull();
			expect(a.getAttribute('rel')).toBeNull();
		});
	});

	describe('(4) DOMPurify 未ロード時 textContent fallback', () => {
		beforeEach(() => {
			// biome-ignore lint/suspicious/noExplicitAny: window から DOMPurify を取り除く
			(window as any).DOMPurify = undefined;
		});

		it('console.warn を呼び textContent で escape する', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			document.body.innerHTML = '<p data-lp-key="x.w">fallback</p>';
			applyLpKeys({
				x: { w: '<strong>これは平文として扱われる</strong>' },
			});
			const el = document.querySelector('[data-lp-key="x.w"]') as HTMLElement;
			// textContent fallback では HTML が string として表示される
			expect(el.textContent).toBe('<strong>これは平文として扱われる</strong>');
			expect(el.querySelector('strong')).toBeNull();
			expect(warnSpy).toHaveBeenCalledWith(
				'[applyLpKeys] DOMPurify unavailable, fell back to textContent for',
				'x.w',
			);
		});

		it('XSS payload も textContent で escape されるため安全', () => {
			vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			document.body.innerHTML = '<p data-lp-key="x.fs">fallback</p>';
			applyLpKeys({
				x: { fs: '<script>alert(1)</script>' },
			});
			const el = document.querySelector('[data-lp-key="x.fs"]') as HTMLElement;
			expect(el.querySelector('script')).toBeNull();
			expect(el.textContent).toBe('<script>alert(1)</script>');
		});
	});

	describe('境界値', () => {
		beforeEach(() => {
			// biome-ignore lint/suspicious/noExplicitAny: window stub
			(window as any).DOMPurify = DOMPurify;
		});

		it('section.key 形式でない data-lp-key は無視される', () => {
			document.body.innerHTML = '<p data-lp-key="invalid">fallback</p>';
			applyLpKeys({});
			const el = document.querySelector('[data-lp-key="invalid"]') as HTMLElement;
			expect(el.textContent).toBe('fallback');
		});

		it('LP_LABELS に存在しない section は無視される', () => {
			document.body.innerHTML = '<p data-lp-key="missing.key">fallback</p>';
			applyLpKeys({ other: { key: 'X' } });
			const el = document.querySelector('[data-lp-key="missing.key"]') as HTMLElement;
			expect(el.textContent).toBe('fallback');
		});

		it('value が undefined の場合は元の textContent を保持する', () => {
			document.body.innerHTML = '<p data-lp-key="x.missing">fallback</p>';
			applyLpKeys({ x: {} });
			const el = document.querySelector('[data-lp-key="x.missing"]') as HTMLElement;
			expect(el.textContent).toBe('fallback');
		});

		it('単純文字列 (nested HTML 無し) も正常に注入される', () => {
			document.body.innerHTML = '<p data-lp-key="x.plain">fallback</p>';
			applyLpKeys({ x: { plain: 'シンプルなテキスト' } });
			const el = document.querySelector('[data-lp-key="x.plain"]') as HTMLElement;
			expect(el.textContent).toBe('シンプルなテキスト');
		});
	});
});
