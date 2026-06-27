// tests/unit/architecture/page-guide-coverage.test.ts
// #3262 (EPIC #3260 F1): ページガイドの (1) 親パス フォールバック + (2) 顧客接点ルートの
// 登録漏れ網羅 gate。
//
// (1) getPageGuide の親パスフォールバック (guideCandidatePaths) を unit 検証。
// (2) 顧客接点ルート (admin + marketplace、ops/child は対象外) を列挙し、各ルートが
//     REGISTERED (dedicated guide 登録済) / PENDING (C1〜C7 で付与予定の backlog) /
//     EXEMPT (dedicated guide 不要、fallback で十分) のいずれかに必ず属すことを assert する。
//     どれにも属さない新規ルート = 登録漏れ → hard-fail (registration leak 検出)。
//     C2〜C7 が dedicated guide を付与したら、その route を PENDING から外す (REGISTERED へ移行)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	filterGuideStepsByTier,
	filterGuideStepsToOverview,
	getPageGuide,
	guideCandidatePaths,
	REGISTERED_GUIDE_PATHS,
	resolvePageGuide,
} from '../../../src/lib/ui/tutorial/page-guide-registry';
import type { PageGuide } from '../../../src/lib/ui/tutorial/page-guide-types';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// C1〜C7 で dedicated guide を付与予定の顧客接点ルート (未登録 backlog)。
// dedicated guide を実装したら該当 route を本 PENDING から削除する (REGISTERED へ移行)。
// 全 C1〜C7 が REGISTERED へ移行済のため現状は空。新規 backlog ルート追加時に列挙する
// (空配列は型注釈が無いと implicitly any[] になり svelte-check warning=error で fail するため string[] 明示)。
const PENDING_GUIDE_PATHS: string[] = [
	// C2: settings サブ 6 → #3266 で REGISTERED へ移行済
	// C3: プラン・課金 + billing → #3267 で REGISTERED へ移行済
	// C4: members + packs → #3268 で REGISTERED へ移行済
	// C5: marketplace → #3263 (F2) で /marketplace は REGISTERED へ移行済
	//   (/marketplace/[type]/[itemId] は親フォールバックで十分なため EXEMPT へ移動)
	// C7: 低頻度顧客接点 → #3271 で certificates / growth-book / rewards/requests を REGISTERED へ移行済
];

// dedicated guide 不要 (親フォールバックで十分) なルート。各々理由を明記。
const EXEMPT_GUIDE_PATHS: Record<string, string> = {
	'/admin/activities/[id]/edit':
		'活動編集フォーム (transient)。親 /admin/activities にフォールバック',
	'/admin/certificates/[id]': '証明書詳細 (transient)。親 /admin/certificates にフォールバック',
	'/admin/billing/cancel': '解約フロー途中 (transient)。/admin/billing にフォールバック',
	'/admin/billing/cancel/graduation': '卒業フロー (transient)。/admin/billing にフォールバック',
	'/admin/billing/cancel/thanks': '解約完了 (transient)。/admin/billing にフォールバック',
	// #3269 (EPIC #3260 C5): marketplace 詳細は dedicated guide（MARKETPLACE_DETAIL_GUIDE）へ昇格済。
	//   registry に /marketplace/[type]/[itemId] が登録され、PARAMETERIZED_GUIDE_MATCHERS で
	//   実パスから解決される（EXEMPT → REGISTERED へ移行）。
};

function listRoutePaths(): string[] {
	const out: string[] = [];
	const walk = (dir: string, routePrefix: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) {
				// (parent) 等の group ルートは URL に出ないので prefix に足さない
				const seg = e.name.startsWith('(') && e.name.endsWith(')') ? '' : `/${e.name}`;
				walk(resolve(dir, e.name), routePrefix + seg);
			} else if (e.name === '+page.svelte') {
				out.push(routePrefix || '/');
			}
		}
	};
	walk(resolve(REPO_ROOT, 'src/routes/(parent)/admin'), '/admin');
	walk(resolve(REPO_ROOT, 'src/routes/marketplace'), '/marketplace');
	return out;
}

describe('#3262 F1: getPageGuide 親パス フォールバック', () => {
	it('guideCandidatePaths は自身→親→祖先を最も具体的な順で返す', () => {
		expect(guideCandidatePaths('/admin/settings/account')).toEqual([
			'/admin/settings/account',
			'/admin/settings',
			'/admin',
		]);
		expect(guideCandidatePaths('/admin')).toEqual(['/admin']);
	});

	it('未登録サブパスは登録済の親候補に到達する (= ? が空にならない)', () => {
		// /admin/settings/account は未登録だが、候補に登録済の /admin/settings を含む
		const candidates = guideCandidatePaths('/admin/settings/account');
		expect(candidates.some((c) => REGISTERED_GUIDE_PATHS.includes(c))).toBe(true);
		// /admin 配下は最終的に必ず /admin (登録済) にフォールバックできる
		expect(guideCandidatePaths('/admin/members').includes('/admin')).toBe(true);
	});
});

describe('#3262 F1: 顧客接点ルートの登録漏れ網羅 gate', () => {
	it('全顧客接点ルートが REGISTERED / PENDING / EXEMPT のいずれかに属す (新規登録漏れ 0)', () => {
		const routes = listRoutePaths();
		const accounted = new Set([
			...REGISTERED_GUIDE_PATHS,
			...PENDING_GUIDE_PATHS,
			...Object.keys(EXEMPT_GUIDE_PATHS),
		]);
		const unaccounted = routes.filter((r) => !accounted.has(r));
		expect(
			unaccounted,
			`ガイド未対応の顧客接点ルートが追加された (REGISTERED/PENDING/EXEMPT いずれにも不在)。\n` +
				`dedicated guide を付与し registry 登録するか、PENDING / EXEMPT に分類すること:\n` +
				`${unaccounted.map((r) => `  ${r}`).join('\n')}`,
		).toEqual([]);
	});

	it('PENDING の route はまだ REGISTERED になっていない (dedicated guide 実装後は PENDING から外す)', () => {
		const stale = PENDING_GUIDE_PATHS.filter((p) => REGISTERED_GUIDE_PATHS.includes(p));
		expect(
			stale,
			`PENDING に挙げた route が registry 登録済 (dedicated guide 完成)。本 PENDING リストから削除して ratchet を締める:\n${stale.map((r) => `  ${r}`).join('\n')}`,
		).toEqual([]);
	});
});

describe('#3269 C5: marketplace 詳細の dedicated guide 解決', () => {
	it('一覧 /marketplace は一覧ガイド (marketplace) を解決する', async () => {
		const guide = await getPageGuide('/marketplace');
		expect(guide?.pageId).toBe('marketplace');
	});

	it('詳細 /marketplace/<type>/<itemId> は dedicated 詳細ガイド (marketplace-detail) を解決する (親へ degrade しない)', async () => {
		const guide = await getPageGuide('/marketplace/activity-pack/kinder-starter');
		expect(guide?.pageId).toBe('marketplace-detail');
		// 取込 CUJ 終盤を案内する 3 部構成 (#3269)
		expect(guide?.steps.length).toBe(3);
		// 取込 CTA を selector に持つ step が含まれる (dead-end 防止 / 取り込みへ誘導)
		expect(guide?.steps.some((s) => s.selector === '[data-testid="marketplace-detail-cta"]')).toBe(
			true,
		);
	});

	it('クエリ付き詳細パスでも詳細ガイドに解決する', async () => {
		const guide = await getPageGuide('/marketplace/checklist/event-pool?import=event-pool');
		expect(guide?.pageId).toBe('marketplace-detail');
	});
});

describe('#3304: resolvePageGuide の viaFallback 判定', () => {
	it('完全一致 (/admin/activities) は viaFallback=false', async () => {
		const r = await resolvePageGuide('/admin/activities');
		expect(r?.guide.pageId).toBe('admin-activities');
		expect(r?.viaFallback).toBe(false);
	});

	it('未登録の子ルート (/admin/activities/123/edit) は親 /admin/activities へ viaFallback=true', async () => {
		const r = await resolvePageGuide('/admin/activities/123/edit');
		expect(r?.guide.pageId).toBe('admin-activities');
		expect(r?.viaFallback).toBe(true);
	});

	it('EXEMPT 遷移ルート (/admin/billing/cancel) は親 /admin/billing へ viaFallback=true', async () => {
		const r = await resolvePageGuide('/admin/billing/cancel');
		expect(r?.guide.pageId).toBe('admin-billing');
		expect(r?.viaFallback).toBe(true);
	});

	it('marketplace 詳細は PARAMETERIZED dedicated 解決のため viaFallback=false (親へ degrade しない)', async () => {
		const r = await resolvePageGuide('/marketplace/activity-pack/kinder-starter');
		expect(r?.guide.pageId).toBe('marketplace-detail');
		expect(r?.viaFallback).toBe(false);
	});

	it('未登録 top-level (/admin/members 以外の架空パス) は /admin へ viaFallback=true', async () => {
		const r = await resolvePageGuide('/admin/nonexistent-xyz');
		expect(r?.guide.pageId).toBe('admin-home');
		expect(r?.viaFallback).toBe(true);
	});
});

describe('#3304: filterGuideStepsToOverview', () => {
	const makeGuide = (steps: PageGuide['steps']): PageGuide => ({
		pageId: 'x',
		title: 't',
		icon: '❓',
		steps,
	});

	it('selector 付き step を除外し selector-less な概要 step のみ残す', () => {
		const g = makeGuide([
			{ id: 'intro', title: '概要', what: 'a', how: 'b', goal: 'c' },
			{ id: 'sel', selector: '[data-tutorial="x"]', title: '操作', what: 'a', how: 'b', goal: 'c' },
		]);
		const out = filterGuideStepsToOverview(g);
		expect(out?.steps.map((s) => s.id)).toEqual(['intro']);
	});

	it('全 step が selector 付きなら null (呼び出し側が元ガイドへ degrade 判断)', () => {
		const g = makeGuide([
			{ id: 'a', selector: '[data-tutorial="a"]', title: 'A', what: 'a', how: 'b', goal: 'c' },
			{ id: 'b', selector: '[data-tutorial="b"]', title: 'B', what: 'a', how: 'b', goal: 'c' },
		]);
		expect(filterGuideStepsToOverview(g)).toBeNull();
	});
});

describe('#3307 Part 1: settings/data エクスポート step の tier 条件付き整合', () => {
	it('free では settings-data-export (canExport gate) が除外され、概要/見方 step が残る', async () => {
		const guide = await getPageGuide('/admin/settings/data');
		expect(guide?.pageId).toBe('admin-settings-data');
		const free = filterGuideStepsByTier(guide!, 'free');
		const ids = free?.steps.map((s) => s.id) ?? [];
		expect(ids).not.toContain('settings-data-export');
		expect(ids).toContain('settings-data-intro');
		expect(ids).toContain('settings-data-management');
	});

	it('standard 以上では settings-data-export が表示される', async () => {
		const guide = await getPageGuide('/admin/settings/data');
		const standard = filterGuideStepsByTier(guide!, 'standard');
		expect(standard?.steps.map((s) => s.id)).toContain('settings-data-export');
	});
});

// #3307 Part 2 (selector-miss 静的 gate): 各 step の selector が指す anchor
// (data-tutorial / data-testid) が「描画側マークアップ」に実在することを build 時に保証する。
// e2e は selector 不在時に driver.js が中央表示へ degrade し silent skip (backdrop visible で PASS)
// するため空 spotlight を検出できない (検証安全網の穴)。本 unit gate は「step が存在しない anchor を
// 参照する」authoring 退行を runtime 環境非依存で hard-fail させる (#3314 class の早期検知)。
//
// #3323 BLOCK 是正 (タウトロジー除去): 旧実装は src/ 全 .ts/.svelte (selector 定義の _guide.ts 含む) を
// 連結し `!srcText.includes('"' + anchor + '"')` で判定したため、selector 文字列リテラル自身 (例
// `selector: '[data-tutorial="add-activity-btn"]'`) に必ずマッチして常時 PASS = 実 page の属性有無を
// 検出できなかった。是正の核心は「selector 定義ファイルを連結から除外する」こと:
//   selector 定義ファイル (_guide.ts / page-guide-registry.ts / tutorial-chapters.ts) を除外し、
//   anchor を「描画」する側 (.svelte + 通常 .ts) だけを連結する。これで anchor が描画側に実在しなければ
//   (typo / 削除 / 純 center-modal step への移行漏れ) gate が FAIL する (タウトロジー解消)。
// 判定形は「描画側で anchor が quote 付きトークン ("anchor" / 'anchor') として現れるか」を見る。
// 純粋な `data-tutorial="anchor"` 静的属性のみへの厳格化は不可: 本 product の anchor は
//   (a) 静的属性  : <div data-testid="data-export-section">
//   (b) prop 経由 : <AdminResourceHeader addMenuDataTutorial="add-activity-btn" />
//                   (component 内部で data-tutorial={addMenuDataTutorial} に適用)
//   (c) 動的束縛  : data-tutorial={i === 0 ? 'settings-first-card' : undefined}
// の 3 形態で wiring され、(b)(c) は literal `data-tutorial="x"` の形を取らない (prop 間接 / 三項)。
// quote 付きトークン一致は定義ファイル除外後は (b)(c) を正しく拾いつつ、どこにも存在しない anchor
// (genuine 空 spotlight) を FAIL させる (kebab ID は具体的で偶発衝突なし)。
// 既知 blind spot: id 形 selector (例 `#point-settings`) は extractAnchor が拾わないため本 gate の
// scope 外。id selector を新規採用する場合は別途検証する (本 gate は data-tutorial / data-testid 限定)。
// 注: runtime 別 (nuc/cognito/anonymous) の e2e 網羅は CI コスト大のため ADR-0010 Pre-PMF で別途。
describe('#3307: ガイド step の selector anchor が描画側 src に実在する (selector-miss 静的 gate)', () => {
	// selector を「定義」しているファイル群。これらを連結に含めると anchor 文字列自身に
	// マッチしてタウトロジー化するため除外し、anchor を「描画」する側だけを残す。
	const isSelectorDefinitionFile = (path: string): boolean => {
		const normalized = path.replace(/\\/g, '/');
		return (
			normalized.endsWith('/_guide.ts') ||
			normalized.endsWith('/page-guide-registry.ts') ||
			normalized.endsWith('/tutorial-chapters.ts')
		);
	};

	const readRenderSrcText = (): string => {
		let buf = '';
		const walk = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = resolve(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (/\.(svelte|ts)$/.test(e.name) && !isSelectorDefinitionFile(p))
					buf += readFileSync(p, 'utf8');
			}
		};
		walk(resolve(REPO_ROOT, 'src'));
		return buf;
	};

	const extractAnchor = (selector: string): string | null =>
		selector.match(/\[data-(?:tutorial|testid)="([^"]+)"\]/)?.[1] ?? null;

	// anchor が描画側マークアップに wiring されているか。静的属性 (data-testid="x") / prop 経由
	// (addMenuDataTutorial="x") / 動的束縛 ({cond ? 'x' : undefined}) いずれも quote 付きトークンで
	// 現れるため、"x" / 'x' の完全トークン存在で判定する (定義ファイル除外済のため非タウトロジー)。
	const isRenderedAnchor = (srcText: string, anchor: string): boolean =>
		srcText.includes(`"${anchor}"`) || srcText.includes(`'${anchor}'`);

	// 動的セグメント key は実パス例で解決する (PARAMETERIZED_GUIDE_MATCHERS)。
	const sampleUrlFor = (path: string): string =>
		path.includes('[') ? '/marketplace/activity-pack/kinder-starter' : path;

	it('全 REGISTERED ガイドの selector anchor が描画側マークアップに属性形で存在する (typo / 削除 anchor / 空 spotlight を検出)', async () => {
		const srcText = readRenderSrcText();
		const guides = await Promise.all(
			REGISTERED_GUIDE_PATHS.map((p) => getPageGuide(sampleUrlFor(p))),
		);
		const missing = guides
			.filter((g): g is NonNullable<typeof g> => g !== null)
			.flatMap((g) =>
				g.steps
					.map((step) => ({ step, anchor: step.selector ? extractAnchor(step.selector) : null }))
					.filter(({ anchor }) => anchor !== null && !isRenderedAnchor(srcText, anchor))
					.map(({ step }) => `${g.pageId}/${step.id} → ${step.selector}`),
			);
		expect(
			missing,
			`ガイド step の selector が描画側に存在しない anchor を参照している (空 spotlight になる)。` +
				`描画要素に data-tutorial / data-testid を追加するか step を center-modal (selector 省略) へ再分類すること:\n${missing.join('\n')}`,
		).toEqual([]);
	});
});
