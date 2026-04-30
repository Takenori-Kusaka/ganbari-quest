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
 * scripts/generate-lp-labels.mjs L399 以降の applyLpKeys テンプレートと同一実装。
 * テンプレートが変更された場合は本実装も同期更新すること（手動同期）。
 *
 * window.DOMPurify を読みに行く点も含めてテンプレートと完全に一致させる。
 *
 * #1717: legal docs (privacy/terms/sla/tokushoho) が h1/h2/p/ul/ol/li/div/table 等の
 * 構造タグを必要とするため、ALLOWED_TAGS / ALLOWED_ATTR を構造タグ/属性まで拡張済み。
 * <table> 内の <tr> 等は HTML パーサのコンテキスト制約で strip されるため、
 * 親要素が table 系で値が <tr|<thead|<tbody> 始まりの場合は XHTML パーサに切替える
 * (PARSER_MEDIA_TYPE='application/xhtml+xml')。XHTML は void 要素 (<br>) 未閉じで
 * parse error になるので、事前に <br/> 形式へ正規化する。
 */
function applyLpKeys(LP_LABELS: Record<string, Record<string, string>>): void {
	const elements = document.querySelectorAll('[data-lp-key]');
	// biome-ignore lint/suspicious/noExplicitAny: window.DOMPurify は CDN 経由で注入されるため型は any
	const Purify = (typeof window !== 'undefined' && (window as any).DOMPurify) || null;
	const SANITIZE_CONFIG = {
		ALLOWED_TAGS: [
			// インライン装飾
			'strong',
			'em',
			'a',
			'br',
			'span',
			'sup',
			'sub',
			'small',
			'b',
			'i',
			// 構造（見出し・段落・リスト・コンテナ）
			'h1',
			'h2',
			'h3',
			'h4',
			'p',
			'ul',
			'ol',
			'li',
			'div',
			// テーブル
			'table',
			'tr',
			'th',
			'td',
			'thead',
			'tbody',
			// セマンティック / 定義リスト / コード
			'code',
			'header',
			'section',
			'dl',
			'dt',
			'dd',
			// 図版
			'figure',
			'figcaption',
		],
		ALLOWED_ATTR: [
			'href',
			'target',
			'rel',
			'class',
			'aria-hidden',
			'aria-label',
			'id',
			'data-contact-context',
		],
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
	const TABLE_ROW_PARENT_TAGS = ['TABLE', 'THEAD', 'TBODY', 'TR'];
	function needsXhtmlParse(parentEl: Element, value: string): boolean {
		if (TABLE_ROW_PARENT_TAGS.indexOf(parentEl.tagName) === -1) return false;
		return /^\s*<(tr|thead|tbody|th|td)\b/i.test(value);
	}
	function normalizeVoidElements(html: string): string {
		return html
			.replace(/<br(\s[^>]*?)?>/gi, '<br$1/>')
			.replace(/<hr(\s[^>]*?)?>/gi, '<hr$1/>')
			.replace(/<img(\s[^>]*?)?>/gi, '<img$1/>');
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
			const useXhtml = needsXhtmlParse(el, value);
			const input = useXhtml ? normalizeVoidElements(value) : value;
			const cfg = useXhtml
				? { ...SANITIZE_CONFIG, PARSER_MEDIA_TYPE: 'application/xhtml+xml' }
				: SANITIZE_CONFIG;
			el.innerHTML = Purify.sanitize(input, cfg);
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

		it.each([
			['javascript:', '<a href="javascript:alert(1)">click</a>'],
			['data:', '<a href="data:text/html,<script>alert(1)</script>">click</a>'],
			['vbscript:', '<a href="vbscript:alert(1)">click</a>'],
		])('危険な %s URL を escape する', (proto, payload) => {
			document.body.innerHTML = '<p data-lp-key="x.j">fallback</p>';
			applyLpKeys({ x: { j: payload } });
			const el = document.querySelector('[data-lp-key="x.j"]') as HTMLElement;
			const a = el.querySelector('a');
			// DOMPurify は dangerous protocol を href から削除（または anchor を strip）する
			if (a) {
				const href = a.getAttribute('href') ?? '';
				// URL parse して protocol を抽出する exhaustive check（CodeQL 推奨）
				let parsedProtocol = '';
				try {
					parsedProtocol = new URL(href, 'https://example.com').protocol.toLowerCase();
				} catch {
					// 相対 URL や空 href は base 経由で解決される
				}
				expect(parsedProtocol).not.toBe('javascript:');
				expect(parsedProtocol).not.toBe('data:');
				expect(parsedProtocol).not.toBe('vbscript:');
			}
			expect(el.innerHTML.toLowerCase()).not.toContain(proto);
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

	describe('(5) #1717 legal docs 構造タグの保持', () => {
		beforeEach(() => {
			// biome-ignore lint/suspicious/noExplicitAny: window stub
			(window as any).DOMPurify = DOMPurify;
		});

		it('<h1> / <h2> / <h3> / <p> が保持される (privacy/terms/sla の articleHeader / section)', () => {
			document.body.innerHTML = '<header data-lp-key="x.h">fallback</header>';
			applyLpKeys({
				x: {
					h: '<h1>プライバシーポリシー</h1><p class="meta">最終更新日: 2026年4月28日</p>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.h"]') as HTMLElement;
			expect(el.querySelector('h1')?.textContent).toBe('プライバシーポリシー');
			const meta = el.querySelector('p.meta');
			expect(meta?.textContent).toBe('最終更新日: 2026年4月28日');
		});

		it('<ul> / <ol> / <li> リスト構造が保持される', () => {
			document.body.innerHTML = '<section data-lp-key="x.l">fallback</section>';
			applyLpKeys({
				x: {
					l: '<h2>第2条</h2><ol><li>項目1</li><li>項目2</li></ol><ul><li>注釈A</li></ul>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.l"]') as HTMLElement;
			expect(el.querySelector('h2')?.textContent).toBe('第2条');
			expect(el.querySelectorAll('ol li').length).toBe(2);
			expect(el.querySelectorAll('ul li').length).toBe(1);
		});

		it('<table> 内の <tr> / <th> / <td> 構造が保持される (tokushoho.html 用)', () => {
			document.body.innerHTML = '<table data-lp-key="x.t">fallback</table>';
			applyLpKeys({
				x: {
					t: '<tr><th>販売業者</th><td>日下武紀</td></tr><tr><th>所在地</th><td>東京</td></tr>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.t"]') as HTMLElement;
			expect(el.querySelectorAll('tr').length).toBe(2);
			expect(el.querySelectorAll('th').length).toBe(2);
			expect(el.querySelectorAll('td').length).toBe(2);
			expect(el.querySelectorAll('th')[0]?.textContent).toBe('販売業者');
		});

		it('<table> 内に <br> を含む <tr><td> でも切り捨てなく保持される (XHTML void 正規化)', () => {
			document.body.innerHTML = '<table data-lp-key="x.tb">fallback</table>';
			applyLpKeys({
				x: {
					tb: '<tr><th>A</th><td>foo<br>bar</td></tr><tr><th>B</th><td>baz</td></tr><tr><th>C</th><td>qux</td></tr>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.tb"]') as HTMLElement;
			expect(el.querySelectorAll('tr').length).toBe(3);
		});

		it('id 属性 (#under-age 等の anchor) が保持される', () => {
			document.body.innerHTML = '<section data-lp-key="x.id">fallback</section>';
			applyLpKeys({
				x: { id: '<h2 id="under-age">第9条</h2><p>本文</p>' },
			});
			const el = document.querySelector('[data-lp-key="x.id"]') as HTMLElement;
			const h2 = el.querySelector('h2#under-age');
			expect(h2?.textContent).toBe('第9条');
		});

		it('data-contact-context 属性が保持される (mailto 文脈識別)', () => {
			document.body.innerHTML = '<section data-lp-key="x.mc">fallback</section>';
			applyLpKeys({
				x: {
					mc: '<a href="mailto:test@example.com" data-contact-context="プライバシー">問い合わせ</a>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.mc"]') as HTMLElement;
			const a = el.querySelector('a');
			expect(a?.getAttribute('data-contact-context')).toBe('プライバシー');
		});

		it('XSS 防御維持: 拡張後も <script> / <iframe> / <object> は strip される', () => {
			document.body.innerHTML = '<section data-lp-key="x.xss">fallback</section>';
			applyLpKeys({
				x: {
					xss: '<h2>Title</h2><script>alert(1)</script><iframe src="evil"></iframe><object data="evil"></object>',
				},
			});
			const el = document.querySelector('[data-lp-key="x.xss"]') as HTMLElement;
			expect(el.querySelector('script')).toBeNull();
			expect(el.querySelector('iframe')).toBeNull();
			expect(el.querySelector('object')).toBeNull();
			expect(el.querySelector('h2')?.textContent).toBe('Title');
		});
	});
});
