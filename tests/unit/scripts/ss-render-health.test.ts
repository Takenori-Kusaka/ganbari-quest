import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	checkSsRenderHealth,
	ERROR_PAGE_INTENDED_LABEL,
	findExemptLabel,
	findImagesMissingDomPair,
	INTERNAL_REFACTOR_LABEL,
	judgeDomSnapshots,
} from '../../../scripts/check-ss-render-health.mjs';
import {
	checkRenderHealth,
	detectErrorMarkersInHtml,
	evaluateRenderHealth,
	INFRA_ERROR_TITLE_MARKER,
} from '../../../scripts/lib/screenshot-helpers.mjs';

// ============================================================
// fixture: src/routes/+error.svelte の実レンダリング相当 (Svelte scoping class 付き)
// ============================================================

const APP_ERROR_PAGE_HTML = `<!DOCTYPE html><html lang="ja"><head><title>500エラー - がんばりクエスト</title></head><body>
<div class="error-page svelte-1abc23" data-role="parent">
	<div class="error-container svelte-1abc23">
		<p class="error-status svelte-1abc23">500</p>
		<h1 class="error-title svelte-1abc23">エラーが はっせいしました</h1>
		<p class="error-description svelte-1abc23">予期しないエラーが発生しました。時間をおいて再度お試しください。</p>
	</div>
</div>
</body></html>`;

const APP_404_PAGE_HTML = APP_ERROR_PAGE_HTML.replace(/500/g, '404');

const HEALTHY_ADMIN_HTML = `<!DOCTYPE html><html lang="ja"><head><title>活動管理 - がんばりクエスト</title></head><body>
<header class="admin-resource-header"><h1>活動管理</h1></header>
<main><ul class="activity-list"><li>あさのしたく</li></ul></main>
</body></html>`;

// infra/error-pages/500.html の実ファイルを fixture として読む (marker と実装の同期を保証)
const INFRA_500_HTML = readFileSync(
	join(process.cwd(), 'infra', 'error-pages', '500.html'),
	'utf8',
);

// ============================================================
// evaluateRenderHealth (#3012 — 撮影時 assert の純粋判定)
// ============================================================

describe('evaluateRenderHealth (#3012)', () => {
	it('HTTP 500 応答は unhealthy', () => {
		const result = evaluateRenderHealth({ httpStatus: 500 });
		expect(result.healthy).toBe(false);
		expect(result.reason).toContain('HTTP 500');
	});

	it('HTTP 503 応答は unhealthy', () => {
		expect(evaluateRenderHealth({ httpStatus: 503 }).healthy).toBe(false);
	});

	it('HTTP 200 + marker なしは healthy', () => {
		const result = evaluateRenderHealth({ httpStatus: 200 });
		expect(result.healthy).toBe(true);
		expect(result.reason).toBe('');
	});

	it('HTTP 404 単独 (DOM marker なし) は HTTP 層では fail しない (DOM marker 層が担当)', () => {
		expect(evaluateRenderHealth({ httpStatus: 404 }).healthy).toBe(true);
	});

	it('アプリ error ページ marker (status 500) は unhealthy', () => {
		const result = evaluateRenderHealth({ httpStatus: 200, appErrorStatus: '500' });
		expect(result.healthy).toBe(false);
		expect(result.reason).toContain('+error.svelte');
		expect(result.reason).toContain('500');
	});

	it('アプリ error ページ marker (status 404、SPA レンダリングで HTTP 200) も unhealthy', () => {
		const result = evaluateRenderHealth({ httpStatus: 200, appErrorStatus: '404' });
		expect(result.healthy).toBe(false);
		expect(result.reason).toContain('404');
	});

	it('appErrorStatus が 3 桁数値でない文字列は false positive にしない', () => {
		expect(evaluateRenderHealth({ httpStatus: 200, appErrorStatus: 'こんにちは' }).healthy).toBe(
			true,
		);
	});

	it('infra error ページの <p class="code">Error 502</p> は unhealthy', () => {
		const result = evaluateRenderHealth({ httpStatus: 200, infraCode: 'Error 502' });
		expect(result.healthy).toBe(false);
		expect(result.reason).toContain('infra/error-pages');
	});

	it('p.code が無関係なテキストなら false positive にしない', () => {
		expect(evaluateRenderHealth({ httpStatus: 200, infraCode: 'ABC-123' }).healthy).toBe(true);
	});

	it('title に infra error マーカー文言を含むと unhealthy', () => {
		const result = evaluateRenderHealth({
			httpStatus: 200,
			title: `${INFRA_ERROR_TITLE_MARKER} - がんばりクエスト`,
		});
		expect(result.healthy).toBe(false);
	});

	it('facts 全省略 (httpStatus 不明) は healthy 扱い', () => {
		expect(evaluateRenderHealth({}).healthy).toBe(true);
		expect(evaluateRenderHealth().healthy).toBe(true);
	});
});

// ============================================================
// checkRenderHealth (#3012 — duck-typed page で facts 抽出経路を検証)
// ============================================================

describe('checkRenderHealth (#3012)', () => {
	it('error ページ facts を返す page は unhealthy (撮影が拒否される)', async () => {
		const fakePage = {
			evaluate: async () => ({ appErrorStatus: '500', infraCode: null, title: '500エラー' }),
		};
		const result = await checkRenderHealth(fakePage, { httpStatus: 200 });
		expect(result.healthy).toBe(false);
		expect(result.reason).toContain('500');
	});

	it('healthy facts を返す page は healthy', async () => {
		const fakePage = {
			evaluate: async () => ({ appErrorStatus: null, infraCode: null, title: '活動管理' }),
		};
		const result = await checkRenderHealth(fakePage, { httpStatus: 200 });
		expect(result.healthy).toBe(true);
	});

	it('HTTP 500 は DOM facts が healthy でも unhealthy', async () => {
		const fakePage = {
			evaluate: async () => ({ appErrorStatus: null, infraCode: null, title: '活動管理' }),
		};
		const result = await checkRenderHealth(fakePage, { httpStatus: 500 });
		expect(result.healthy).toBe(false);
	});
});

// ============================================================
// detectErrorMarkersInHtml (#3012 — CI 側 .dom.html scan の SSOT)
// ============================================================

describe('detectErrorMarkersInHtml (#3012)', () => {
	it('アプリ error ページ (Svelte scoping class 付き) を検出する', () => {
		const reasons = detectErrorMarkersInHtml(APP_ERROR_PAGE_HTML);
		expect(reasons.length).toBeGreaterThan(0);
		expect(reasons.join('\n')).toContain('status 500');
	});

	it('アプリ 404 error ページも検出する', () => {
		const reasons = detectErrorMarkersInHtml(APP_404_PAGE_HTML);
		expect(reasons.join('\n')).toContain('status 404');
	});

	it('infra/error-pages/500.html (実ファイル) を検出する — marker と実装の同期回帰', () => {
		const reasons = detectErrorMarkersInHtml(INFRA_500_HTML);
		expect(reasons.length).toBeGreaterThan(0);
		expect(reasons.join('\n')).toContain('Error 5xx');
	});

	it('正常な admin 画面 HTML では何も検出しない', () => {
		expect(detectErrorMarkersInHtml(HEALTHY_ADMIN_HTML)).toEqual([]);
	});

	it('.error-page class 単独 (error-status なし) では false positive にしない', () => {
		const html = '<div class="error-page-like">error-page という語を含むだけの本文</div>';
		expect(detectErrorMarkersInHtml(html)).toEqual([]);
	});
});

// ============================================================
// check-ss-render-health.mjs (#3012 — CI gate 本体)
// ============================================================

describe('check-ss-render-health.mjs — findExemptLabel', () => {
	it('exempt ラベル定数が workflow / capture.mjs と整合する固定値', () => {
		expect(INTERNAL_REFACTOR_LABEL).toBe('refactor:internal-no-doc-impact');
		expect(ERROR_PAGE_INTENDED_LABEL).toBe('ss:error-page-intended');
	});

	it('refactor:internal-no-doc-impact で exempt', () => {
		expect(findExemptLabel(['type:fix', 'refactor:internal-no-doc-impact']).exempt).toBe(true);
	});

	it('ss:error-page-intended で exempt', () => {
		const result = findExemptLabel(['SS:Error-Page-Intended']);
		expect(result.exempt).toBe(true);
		expect(result.label).toBe(ERROR_PAGE_INTENDED_LABEL);
	});

	it('無関係なラベルのみでは exempt しない', () => {
		expect(findExemptLabel(['type:infra', 'priority:high']).exempt).toBe(false);
		expect(findExemptLabel([]).exempt).toBe(false);
	});
});

describe('check-ss-render-health.mjs — judgeDomSnapshots', () => {
	it('error ページ dom.html を violation として返す', () => {
		const violations = judgeDomSnapshots([
			{ name: 'admin-rewards-mobile.dom.html', html: APP_ERROR_PAGE_HTML },
			{ name: 'admin-activities-mobile.dom.html', html: HEALTHY_ADMIN_HTML },
		]);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.name).toBe('admin-rewards-mobile.dom.html');
		expect(violations[0]?.reasons.length).toBeGreaterThan(0);
	});

	it('全件 healthy なら空配列', () => {
		expect(judgeDomSnapshots([{ name: 'a.dom.html', html: HEALTHY_ADMIN_HTML }])).toEqual([]);
	});
});

describe('check-ss-render-health.mjs — findImagesMissingDomPair (#3006 744dc5c3a パターン)', () => {
	it('dom pair が揃っていれば空配列', () => {
		expect(
			findImagesMissingDomPair(
				['admin-home-mobile.png', 'admin-home-desktop.webp'],
				['admin-home-mobile.dom.html', 'admin-home-desktop.dom.html'],
			),
		).toEqual([]);
	});

	it('#3006 実事故 push (PNG 6 件 / dom.html 0 件) は全件 missing として列挙する', () => {
		const incidentPngs = [
			'admin-activities-desktop.png',
			'admin-activities-mobile.png',
			'admin-checklists-desktop.png',
			'admin-checklists-mobile.png',
			'admin-rewards-desktop.png',
			'admin-rewards-mobile.png',
		];
		expect(findImagesMissingDomPair(incidentPngs, [])).toEqual(incidentPngs);
	});

	it('*-flow.webp (FlowRecorder 合成) は legit な dom なしケースとして除外する', () => {
		expect(findImagesMissingDomPair(['add-activity-flow.webp'], [])).toEqual([]);
	});

	it('一部欠落のみを列挙する', () => {
		expect(
			findImagesMissingDomPair(['a-mobile.png', 'b-mobile.png'], ['a-mobile.dom.html']),
		).toEqual(['b-mobile.png']);
	});
});

describe('check-ss-render-health.mjs — checkSsRenderHealth (fetcher DI)', () => {
	const repo = 'Takenori-Kusaka/ganbari-quest';

	/** GitHub contents API + raw download の mock fetcher を作る */
	function makeFetcher(entries: Array<{ name: string; html: string }>) {
		return async (url: string) => {
			if (url.includes('/contents/pr-')) {
				return {
					ok: true,
					status: 200,
					json: async () =>
						entries.map((e) => ({
							type: 'file',
							name: e.name,
							download_url: `https://raw.example/${e.name}`,
						})),
				};
			}
			const entry = entries.find((e) => url.endsWith(e.name));
			return {
				ok: !!entry,
				status: entry ? 200 : 404,
				text: async () => entry?.html ?? '',
			};
		};
	}

	it('error ページ dom.html 混入で fail (PR #3006 再発パターン)', async () => {
		const fetcher = makeFetcher([
			{ name: 'admin-rewards-mobile.dom.html', html: APP_ERROR_PAGE_HTML },
			{ name: 'admin-checklists-mobile.dom.html', html: INFRA_500_HTML },
		]);
		const result = await checkSsRenderHealth({
			repo,
			prNumber: '3006',
			labels: [],
			fetcher: fetcher as unknown as typeof fetch,
		});
		expect(result.status).toBe('fail');
		expect(result.violations).toHaveLength(2);
	});

	it('全件 healthy なら pass', async () => {
		const fetcher = makeFetcher([{ name: 'admin-home-mobile.dom.html', html: HEALTHY_ADMIN_HTML }]);
		const result = await checkSsRenderHealth({
			repo,
			prNumber: '3012',
			labels: [],
			fetcher: fetcher as unknown as typeof fetch,
		});
		expect(result.status).toBe('pass');
	});

	it('pr ディレクトリ 404 (SS 未 push) は skip', async () => {
		const fetcher = async () => ({ ok: false, status: 404, json: async () => ({}) });
		const result = await checkSsRenderHealth({
			repo,
			prNumber: '9999',
			labels: [],
			fetcher: fetcher as unknown as typeof fetch,
		});
		expect(result.status).toBe('skip');
	});

	it('.dom.html 0 件は skip だが、dom pair 欠落画像を missingDomPairs として返す (#3006 replay)', async () => {
		const fetcher = async (url: string) => {
			if (url.includes('/contents/pr-')) {
				return {
					ok: true,
					status: 200,
					json: async () => [
						{ type: 'file', name: 'admin-rewards-mobile.png', download_url: 'x' },
						{ type: 'file', name: 'admin-rewards-desktop.png', download_url: 'x' },
					],
				};
			}
			return { ok: true, status: 200, text: async () => '' };
		};
		const result = await checkSsRenderHealth({
			repo,
			prNumber: '3006',
			labels: [],
			fetcher: fetcher as unknown as typeof fetch,
		});
		expect(result.status).toBe('skip');
		expect(result.missingDomPairs).toEqual([
			'admin-rewards-mobile.png',
			'admin-rewards-desktop.png',
		]);
	});

	it('ss:error-page-intended ラベルで skip (エラーページ SS が正当な PR)', async () => {
		const result = await checkSsRenderHealth({
			repo,
			prNumber: '3012',
			labels: ['ss:error-page-intended'],
			// fetcher が呼ばれないことを保証 (呼ばれたら throw)
			fetcher: (async () => {
				throw new Error('fetcher should not be called');
			}) as unknown as typeof fetch,
		});
		expect(result.status).toBe('skip');
	});

	it('PR_NUMBER 未指定は skip', async () => {
		const result = await checkSsRenderHealth({ repo, prNumber: '', labels: [] });
		expect(result.status).toBe('skip');
	});
});
