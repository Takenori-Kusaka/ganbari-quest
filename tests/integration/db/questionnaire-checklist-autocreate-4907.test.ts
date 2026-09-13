// tests/integration/db/questionnaire-checklist-autocreate-4907.test.ts
//
// #4907: 初期セットアップ 2/9「チェックリストを自動作成する？」で Q3 に 5 件 ✓ したまま
// 送信しても、本番 (DSQL Lambda) だけ子供の /checklist にも /admin/checklists にも
// 0 件しか反映されない不具合の回帰テスト。
//
// 根本原因 (main e2a82f53 時点の `questionnaire-service.ts` `loadPreset`):
//   `fetch('/checklist-presets/<id>.json')` → Node の fetch は相対 URL を常に reject
//   (`TypeError: Failed to parse URL`) するため必ず catch に落ち、
//   `fs.readFileSync(resolve('static', 'checklist-presets', ...))` にフォールバックする。
//   この fallback は **process.cwd() 配下に `static/` が実在する場合のみ**成功する。
//
//   - `npm run dev` / `vitest` / CI の `vite preview` は cwd = repo root なので
//     `static/checklist-presets/*.json` を読めて「成功する」→ E2E は緑になる
//   - `Dockerfile.lambda` / `Dockerfile` (NUC) は `COPY --from=build /app/build/ ./` で
//     adapter-node の出力だけを `/app` に配置する。adapter-node は `static/` を
//     `build/client/` にマージするため `build/static/` は作られない
//     (実測: `npm run build` 後 `build/static/` は非存在、`build/client/checklist-presets/`
//     のみ存在)。よって本番コンテナの cwd (`/app`) には `static/` が無く、fetch も fs も
//     失敗し `loadPreset` は例外を投げずに `null` を返す (`if (!preset) continue;`) ため、
//     本番だけ「200 応答・エラーログ無し・作成 0 件」という症状になる
//
// PO 指示 (2026-09-11): sqlite の少量 fixture では再現しないため、活動 45 件・子供 2 人・
// bonus rule 5 セット相当の「本番相当データ量」を PGlite に実 migration で seed し、
// 加えて packaged-deploy 相当 (`static/` が cwd に存在しない) の条件で再現してから直す。

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChildId } from '../../../src/lib/domain/ids';
import { seedProductionScaleFixture } from '../../helpers/production-scale-fixture';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = '00000000-0000-4000-8000-0000000049a7';
const originalDataSource = process.env.DATA_SOURCE;
const originalDataDir = process.env.PGLITE_DATA_DIR;
const originalCwd = process.cwd();

const SELECTED_PRESET_IDS = [
	'morning-routine',
	'evening-routine',
	'after-school',
	'weekend-chores',
	'beyond-games',
];

type PgliteConn = typeof import('../../../src/lib/server/db/pglite/connection');
let pgliteConn: PgliteConn;
let repos: ReturnType<typeof import('../../../src/lib/server/db/factory').getRepos>;
let childIds: ChildId[];
let noStaticCwd: string;

function requireChild(ids: ChildId[], index: number): ChildId {
	const id = ids[index];
	if (!id) throw new Error(`[4907 test] childIds[${index}] が未定義 (fixture の子供数不足)`);
	return id;
}

beforeAll(async () => {
	vi.resetModules();
	process.env.DATA_SOURCE = 'pglite';
	delete process.env.PGLITE_DATA_DIR;
	pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
	await pgliteConn.resetPgliteConnectionForTesting();
	await pgliteConn.initPgliteConnection();
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	repos = getRepos();

	// PO 指示: 活動 45 件・子供 2 人・bonus rule 5 セット相当の「本番相当データ量」
	const fixture = await seedProductionScaleFixture(repos, { tenantId: TENANT });
	childIds = fixture.childIds;
	expect(childIds).toHaveLength(2);

	// packaged-deploy (Lambda / NUC Docker) 相当: cwd に static/ が存在しない状態を再現する。
	noStaticCwd = mkdtempSync(path.join(tmpdir(), 'gq-4907-no-static-'));
	process.chdir(noStaticCwd);
}, 120_000);

afterAll(async () => {
	process.chdir(originalCwd);
	if (noStaticCwd) rmSync(noStaticCwd, { recursive: true, force: true });
	await pgliteConn?.resetPgliteConnectionForTesting();
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	if (originalDataDir === undefined) delete process.env.PGLITE_DATA_DIR;
	else process.env.PGLITE_DATA_DIR = originalDataDir;
});

describe('#4907 setup questionnaire チェックリスト自動作成 (本番相当データ量 + packaged-deploy cwd)', () => {
	it('前提: このテストの cwd には static/ が存在しない (本番コンテナ相当)', () => {
		expect(existsSync(path.join(process.cwd(), 'static'))).toBe(false);
	});

	it('[AC1] Q3 で 5 preset ✓ のまま送信 → 5 template + 対象の子供への assignment が作られる', async () => {
		const { applyChecklistPresets } = await import(
			'../../../src/lib/server/services/questionnaire-service'
		);
		const targetChild = requireChild(childIds, 0);

		const created = await applyChecklistPresets(targetChild, SELECTED_PRESET_IDS, TENANT);

		expect(created).toBe(5);

		const { findTemplatesByChild, findTemplateItems } = await import(
			'../../../src/lib/server/db/checklist-repo'
		);
		const templates = await findTemplatesByChild(targetChild, TENANT);
		expect(templates).toHaveLength(5);
		expect(new Set(templates.map((t) => t.sourcePresetId))).toEqual(new Set(SELECTED_PRESET_IDS));

		// morning-routine.json は 5 item (src/lib/data/setup-checklist-presets/morning-routine.json 準拠)
		const morning = templates.find((t) => t.sourcePresetId === 'morning-routine');
		expect(morning).toBeDefined();
		const items = await findTemplateItems(morning?.id ?? '', TENANT);
		expect(items).toHaveLength(5);
		expect(items.map((i) => i.name)).toContain('はみがき');
	});

	it('[AC2] 未知の presetId は作成 0 件で例外を投げず継続する (fallback の安全側)', async () => {
		const { applyChecklistPresets } = await import(
			'../../../src/lib/server/services/questionnaire-service'
		);
		const created = await applyChecklistPresets(
			requireChild(childIds, 1),
			['not-a-real-preset'],
			TENANT,
		);
		expect(created).toBe(0);
	});

	it('[AC1 傍証] getRecommendedPresets の fallback は checklistPresets 0 件でも必ず ≥1 件を返す (ADR-0062、無言の 0 件を作らない)', async () => {
		const { getRecommendedPresets } = await import(
			'../../../src/lib/server/services/questionnaire-service'
		);
		expect(getRecommendedPresets([]).length).toBeGreaterThanOrEqual(1);
	});
});
