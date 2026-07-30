// tests/unit/features/admin-resource-model-registry.test.ts
// #3134: admin リソース正準契約の no-silent-gap guard。
// DESIGN.md §10 の全 admin リソース管理画面が、正準 registry か明示除外リストの
// いずれかで必ず説明されること (= 契約が自身の網羅漏れを silent に見逃さない) を保証する。
// #3117 項目 3: registry の dataScope 宣言 ⇄ ADR-0055 SSOT doc
// (docs/design/data-model-resource-scope.md §3 表) の drift gate を併設する。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

import {
	ADMIN_RESOURCE_MODEL_REGISTRY,
	ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY,
	type AdminResourceDataScope,
	type AdminResourceKey,
	ALL_ADMIN_RESOURCE_PAGES,
	ALLOWED_NON_CANONICAL_SLOT_TESTIDS,
	classifyAdminPageRoute,
	NON_CANONICAL_ADMIN_RESOURCES,
	NON_RESOURCE_ADMIN_PAGE_ROUTES,
} from '../../../src/lib/features/admin/admin-resource-model-registry';

// #3164 / #3171: admin route の実 FS から「+page.* を持つ route dir」を導出する。
// 母数を手管理 literal でなく実 route に固定することで、新規 admin 画面の登録漏れを silent pass させない。
// #3171: **recursive 化**。旧実装は admin 直下 (top-level) のみ走査しており、nested route
// (settings/rules・rewards/requests・activities/[id]/edit 等) を母数から取りこぼしていた
// (= nested に新規 resource 管理画面を追加すると guard が検出せず silent-pass する理論的 gap)。
// 本実装は admin/ 配下の **全 dir** を再帰走査し、+page.* を持つ dir の相対 route path
// (admin/ からの相対、'/' 区切り) を返す。admin 直下の +page.* (admin ホーム) 自体は subdir でないため
// 旧実装と同様に対象外 (route dir = subdirectory のみを分類対象とする)。
const ADMIN_ROUTES_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../src/routes/(parent)/admin',
);

const PAGE_FILES = ['+page.svelte', '+page.server.ts', '+page.ts'] as const;

function hasPageFile(absDir: string): boolean {
	return PAGE_FILES.some((f) => existsSync(resolve(absDir, f)));
}

function discoverAdminPageRoutes(): string[] {
	if (!existsSync(ADMIN_ROUTES_DIR)) {
		throw new Error(`admin routes dir not found: ${ADMIN_ROUTES_DIR}`);
	}
	const routes: string[] = [];
	// admin/ 配下を再帰走査。各 subdir で +page.* を持てば相対 path を route として記録する。
	const walk = (absDir: string, relPath: string): void => {
		for (const e of readdirSync(absDir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			const childAbs = resolve(absDir, e.name);
			const childRel = relPath ? `${relPath}/${e.name}` : e.name;
			if (hasPageFile(childAbs)) routes.push(childRel);
			walk(childAbs, childRel);
		}
	};
	walk(ADMIN_ROUTES_DIR, '');
	return routes.sort();
}

describe('#3134 admin リソース正準契約の網羅性 (no silent gap)', () => {
	const registryKeys = Object.keys(ADMIN_RESOURCE_MODEL_REGISTRY);
	const nonCanonicalKeys = Object.keys(NON_CANONICAL_ADMIN_RESOURCES);

	it('§10 の全 admin リソース画面が registry か明示除外のいずれかで説明される', () => {
		const accounted = new Set([...registryKeys, ...nonCanonicalKeys]);
		for (const page of ALL_ADMIN_RESOURCE_PAGES) {
			expect(
				accounted.has(page),
				`admin リソース画面 "${page}" が registry にも NON_CANONICAL_ADMIN_RESOURCES にも無い ` +
					'(暗黙の網羅漏れ = fitness function blind spot)。registry 登録か除外理由の記載が必要',
			).toBe(true);
		}
	});

	it('registry と明示除外は二重定義しない (同一 key が両方に無い)', () => {
		for (const key of registryKeys) {
			expect(nonCanonicalKeys, `${key} が registry と除外リストの両方に存在する`).not.toContain(
				key,
			);
		}
	});

	it('明示除外の各エントリは route と reason を持つ (silent 除外を作らない)', () => {
		for (const [key, entry] of Object.entries(NON_CANONICAL_ADMIN_RESOURCES)) {
			expect(entry.route, `${key} の除外理由に route が無い`).toBeTruthy();
			expect(entry.reason.length, `${key} の除外理由 (reason) が空`).toBeGreaterThan(0);
		}
	});

	it('registry / 除外を合わせると §10 既知集合と過不足なく一致する', () => {
		const accounted = [...registryKeys, ...nonCanonicalKeys].sort();
		const known = [...ALL_ADMIN_RESOURCE_PAGES].sort();
		expect(accounted).toEqual(known);
	});
});

describe('#3164 母数を実 route FS から導出する (literal 未更新の silent pass を封殺)', () => {
	const discovered = discoverAdminPageRoutes();

	it('admin の page route が実在し空でない (FS 走査が機能している sanity)', () => {
		expect(discovered.length).toBeGreaterThan(0);
		// 既知の代表 route が含まれること (走査ロジックが壊れていない確認)
		expect(discovered).toContain('activities');
		expect(discovered).toContain('settings');
		// #3171: recursive 化で nested route も母数に入る (top-level only だと取りこぼしていた)
		expect(discovered).toContain('settings/rules');
		expect(discovered).toContain('rewards/requests');
	});

	it('実在する全 admin page route が resource / non-resource のいずれかで説明される (unclassified 0)', () => {
		const unclassified = discovered.filter((r) => classifyAdminPageRoute(r) === 'unclassified');
		expect(
			unclassified,
			`admin 直下の page route ${JSON.stringify(unclassified)} が ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY ` +
				'にも NON_RESOURCE_ADMIN_PAGE_ROUTES にも無い (新規画面の登録漏れ = fitness function blind spot)。' +
				'resource-list 管理画面なら ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY + registry/除外へ、そうでなければ ' +
				'NON_RESOURCE_ADMIN_PAGE_ROUTES へ reason 付きで登録する',
		).toEqual([]);
	});

	it('分類定数が実 FS と過不足なく一致する (stale エントリ / 走査漏れの双方向検出)', () => {
		const classified = [
			...Object.keys(ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY),
			...Object.keys(NON_RESOURCE_ADMIN_PAGE_ROUTES),
		].sort();
		expect(classified).toEqual(discovered);
	});

	it('resource page route の map 先 key が registry か明示除外に存在する (#3134 整合)', () => {
		const accounted = new Set([
			...Object.keys(ADMIN_RESOURCE_MODEL_REGISTRY),
			...Object.keys(NON_CANONICAL_ADMIN_RESOURCES),
		]);
		for (const [route, key] of Object.entries(ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY)) {
			expect(
				accounted.has(key),
				`resource route "${route}" の map 先 key "${key}" が registry にも除外にも無い`,
			).toBe(true);
		}
	});

	it('未知の admin route は unclassified に分類される (新規登録漏れを guard が fail させる固定)', () => {
		// 実在しない仮の新規画面名 → どの分類定数にも無いので unclassified。
		// これにより「新規 admin 画面を登録せず追加 → FS 走査 test が fail」を unit で固定する (AC2)。
		expect(classifyAdminPageRoute('badges-not-registered-yet')).toBe('unclassified');
		expect(classifyAdminPageRoute('activities')).toBe('resource');
		expect(classifyAdminPageRoute('settings')).toBe('non-resource');
	});
});

// ---------------------------------------------------------------------------
// #3117 項目 3: registry ⇄ ADR-0055 SSOT doc の drift gate
// ---------------------------------------------------------------------------
// `ADMIN_RESOURCE_MODEL_REGISTRY` の `dataScope` 宣言 (ADR-0055 の code 化) と、ADR-0055 の
// 設計 doc SSOT `docs/design/data-model-resource-scope.md` §3「6 type の scope 適用表」の
// 「採択 scope」列を機械照合する。doc 側だけ scope を変える / registry 側だけ変える、の
// 片側更新 (3-way drift) を CI で検出する fitness test (新規 script は作らない、tests/unit/ 内で完結)。
//
// parse 方式: doc §3 表の行は `| **<type>** | <採択 scope> | ...` 形式 (太字 type 名) で
// 安定しているため、doc 側に machine-readable マーカーを追加せず既存表を直接 parse する
// (最小コスト、check-doc-code-references と同じ「doc 実体を読む」方式)。見出し・行形式が
// 変わった場合は parser 側 assert が fail する (fails-closed、silent pass しない)。

const DATA_MODEL_SCOPE_DOC = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../docs/design/data-model-resource-scope.md',
);

/** registry key → doc §3 表の Type 列 (太字内の literal)。 */
const REGISTRY_KEY_TO_DOC_TYPE: Record<AdminResourceKey, string> = {
	activity: 'activity',
	reward: 'reward (exchange)',
	checklist: 'checklist',
};

/** doc の「採択 scope」自然文セルを registry の dataScope enum に正規化する。未知の文言は null (= fail)。 */
function normalizeDocScope(cell: string): AdminResourceDataScope | null {
	if (cell.startsWith('per-child instance')) return 'per-child-instance';
	if (cell.startsWith('family master template')) return 'family-master-template';
	return null;
}

/** doc §3 の scope 適用表から `Type (太字) → 採択 scope セル` の Map を得る。 */
function parseDocScopeTable(): Map<string, string> {
	const md = readFileSync(DATA_MODEL_SCOPE_DOC, 'utf-8');
	const start = md.indexOf('## 3. 6 type の scope 適用表');
	expect(
		start,
		`data-model-resource-scope.md に見出し「## 3. 6 type の scope 適用表」が見つからない ` +
			'(doc 再構成時は本 drift gate の parser も同期更新すること)',
	).toBeGreaterThanOrEqual(0);
	// §3.1 以降のサブ表 (dedup scope 表) を除外し、§3 本表のみを対象にする。
	const section = md.slice(start).split('### 3.1')[0] ?? '';
	const rows = new Map<string, string>();
	for (const line of section.split('\n')) {
		// 例: | **activity** | per-child instance | `ChildActivity` | ...
		const m = /^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|/.exec(line);
		if (m?.[1] && m[2]) rows.set(m[1], m[2]);
	}
	return rows;
}

describe('#3117 registry dataScope ⇄ data-model-resource-scope.md §3 (ADR-0055 SSOT) drift gate', () => {
	const docRows = parseDocScopeTable();

	it('doc §3 表が parse でき、registry 対象 3 type の行が存在する (parser sanity、fails-closed)', () => {
		for (const [key, docType] of Object.entries(REGISTRY_KEY_TO_DOC_TYPE)) {
			expect(
				docRows.has(docType),
				`doc §3 表に registry resource "${key}" に対応する行 "**${docType}**" が無い ` +
					'(doc の type 名変更時は REGISTRY_KEY_TO_DOC_TYPE を同期更新すること)',
			).toBe(true);
		}
	});

	it('registry の dataScope が doc §3「採択 scope」列と一致する (片側更新 = drift を検出)', () => {
		for (const model of Object.values(ADMIN_RESOURCE_MODEL_REGISTRY)) {
			const docType = REGISTRY_KEY_TO_DOC_TYPE[model.resource];
			const cell = docRows.get(docType);
			expect(cell, `doc §3 表に "${docType}" 行が無い`).toBeTruthy();
			const docScope = normalizeDocScope(cell as string);
			expect(
				docScope,
				`doc §3 "${docType}" の採択 scope セル "${cell}" を既知の scope に正規化できない ` +
					'(scope 表現の変更時は normalizeDocScope と registry を同時更新すること)',
			).not.toBeNull();
			expect(
				model.dataScope,
				`registry "${model.resource}" の dataScope (${model.dataScope}) が doc §3 の採択 scope ` +
					`(${docScope}) と乖離している (ADR-0055 SSOT drift)。doc と registry を同一 PR で同期すること`,
			).toBe(docScope);
		}
	});

	it('registry の organizingModel は UI 表示軸としてデータ scope と独立に per-child-tabs で統一されている (#3098)', () => {
		// data-model-resource-scope.md は「データ scope」の SSOT であり UI 表示軸は宣言しない。
		// UI 表示軸の統一 (3 資源とも child 主軸) は DESIGN.md §10 の宣言で、checklist が
		// family-master-template (データ) でも per-child-tabs (UI) である「別レイヤー」原則 (#3096) を
		// ここで固定する (dataScope に引きずられて organizingModel を書き換える誤同期の防止)。
		for (const model of Object.values(ADMIN_RESOURCE_MODEL_REGISTRY)) {
			expect(
				model.organizingModel,
				`registry "${model.resource}" の organizingModel が per-child-tabs でない (DESIGN.md §10 逸脱)`,
			).toBe('per-child-tabs');
		}
	});

	it('intruder allowlist (ALLOWED_NON_CANONICAL_SLOT_TESTIDS) は registry の全 resource key を網羅する', () => {
		// #3117 項目 1 の allowlist が resource 追加時に定義漏れで undefined アクセスにならないよう
		// (Record 型で強制されるが、satisfies 崩れ等の退行を runtime でも固定)。
		for (const key of Object.keys(ADMIN_RESOURCE_MODEL_REGISTRY)) {
			expect(
				Array.isArray(ALLOWED_NON_CANONICAL_SLOT_TESTIDS[key as AdminResourceKey]),
				`ALLOWED_NON_CANONICAL_SLOT_TESTIDS に resource "${key}" のエントリが無い`,
			).toBe(true);
		}
	});
});
