// tests/unit/routes/setup-wizard-walkthrough-4863.test.ts
//
// cspell:ignore mktemp
// ↑ 下の再現手順で使う POSIX コマンド名。既存の開発 DB を消さずに空 DB を作るために
//   必要なので、綴りを変えたり global words に足したりしない (file scope に閉じる)。
//
// ウィザードの**印の立ち下がり** (立つ / 残る / 降りる) を、実際の route を通して固定する。
//
// **この test が通す route は 2 本だけ** (`/setup/children?/addChild` と `/setup/complete` の
// load)。step 2〜8 の各画面は通していない。本 test の `setupGateBlocks()` は hooks と同じ
// 2 つの問いを同じ順で投げるが、hooks 自体は import していない — その結線は
// `tests/unit/services/hooks-integration.test.ts` の担当。
//
// **「通しで歩ける」ことを保証している test は、この repo に無い** (誇張しないために書く):
//
//   - 本 test        … 印が「立つ / 残る / 降りる」ことだけ
//   - hooks 結合 test … 実物の `handle` が 9 path を**塞いでいない**ことだけ。
//                       各 step の `load` も action の連鎖も通していないので、たとえば
//                       `/setup/rewards` の load が例外を投げるようになっても緑のまま
//   - CI             … `e2e-test` / `e2e-matrix` / `e2e-demo-lambda` / `storybook-test` は
//                       本 PR の変更範囲では全て skipping
//
// つまり 9 step の通し歩行を確かめているのは**実機計測だけ**。PR body §検証に結果を載せて
// あるが、それは repo の外なので**やり直せる手順をここに書く** (1 年後に読む人が到達できる形):
//
//   1. **手元の開発 DB には触れず**、使い捨ての空 DB で起動する (既定の DB は
//      `./data/ganbari-quest.db` = `src/lib/server/db/client.ts` の `DATABASE_URL` 既定値。
//      **これを消す手順にしない** — その開発機のローカル開発データが消える):
//        DATABASE_URL=$(mktemp -d)/setup.db AUTH_MODE=local npx vite dev --port 5399
//   2. `/` を開く → `/setup/children` に着く
//   3. 名前と年齢を入れて「追加」→ **「次へ」が描画されること** (旧実装ではここが 0 個)
//   4. 「次へ」から complete まで進む。実測した順は
//      children → questionnaire → packs → rewards → rules → activities-defaults →
//      challenges → first-adventure → complete
//   5. 完了後に `/setup/children` `/setup/packs` 等を直接開く → gate は `/` へ 302 し、
//      `/` がさらに送るので最終的に `/switch` に着く (**Location は `/switch` ではなく `/`**)
//   6. `select * from settings where key='setup_wizard_in_progress'` → 1 行 / 値は false
//
// なぜ真理値表 test (`tests/unit/services/setup-wizard-reachability-4860.test.ts`) だけでは
// 足りないか: あれは `shouldBlockSetupAccess` が正しいことしか言っていない。**その判定に
// 正しい入力が届くか**は別問題で、初版はまさにそこで壊れていた — 印を立てる呼び出しを
// step 1 の `next` action に置いたが、`addChild` で子供が 1 人できた瞬間に gate が
// その POST 自体を弾くため 1 度も走らず、settings は空のまま (adversarial reviewer 実測:
// settings 0 行)。判定は旧条件と数学的に等価に潰れ、**PR head と develop の実機挙動は
// 完全に同一**だった。unit は 27 件すべて緑のまま。
//
// したがって本 test は「判定関数」ではなく **route の呼び出しの連鎖**を歩く:
//   /setup/children?/addChild (POST) → gate → /setup/complete (load) → gate
//
// 固定する不変条件:
//   [W1] 子供 0 人: gate は開いている (ウィザードに入れる)
//   [W2] step 1 の addChild を通したあと、**gate は開いたままである** (step 2〜9 が歩ける)
//        ← 本 PR が直した欠陥そのもの。印を立てる呼び出しを消すとここが落ちる
//   [W3] /setup/complete に到達すると gate が閉じる (完了後の再突入を防ぐ従来の意図)
//        ← 降ろす呼び出しを消すとここが落ちる
//   [W4] 画面を**見ただけ** (GET = load) では印は立たない
//        `src/app.html` の `data-sveltekit-preload-data="hover"` により、load に書き込みを
//        置くとリンクにカーソルを載せただけで印が立つ。印は「子供を 1 人作った」に紐づく
//   [W5] 既存テナント (子供が居て印なし) は従来どおりブロックされる

import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeChild = { id: string; nickname: string; age: number; uiMode: string };

let children: FakeChild[] = [];
let settings: Map<string, string> = new Map();

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: vi.fn(async (key: string, tenantId: string) => settings.get(`${tenantId}:${key}`)),
	setSetting: vi.fn(async (key: string, value: string, tenantId: string) => {
		settings.set(`${tenantId}:${key}`, value);
	}),
	getSettings: vi.fn(async () => ({})),
}));

vi.mock('$lib/server/services/child-service', () => ({
	addChild: vi.fn(async (input: { nickname: string; age: number }) => {
		const child = {
			id: `c-${children.length + 1}`,
			nickname: input.nickname,
			age: input.age,
			uiMode: 'elementary',
		};
		children.push(child);
		return child;
	}),
	getAllChildren: vi.fn(async () => children),
	getArchivedChildren: vi.fn(async () => []),
}));

vi.mock('$lib/server/services/setup-funnel-service', () => ({ trackSetupFunnel: vi.fn() }));
vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 't-wizard',
	getAuthMode: () => 'local',
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { isSetupRequired, isSetupWizardInProgress, shouldBlockSetupAccess } = await import(
	'../../../src/lib/server/services/setup-service'
);
const childrenRoute = await import('../../../src/routes/setup/children/+page.server');
const completeRoute = await import('../../../src/routes/setup/complete/+page.server');

const addChildAction = childrenRoute.actions.addChild;
if (!addChildAction) throw new Error('addChild action が見つからない (action 名が変わった?)');

/**
 * `src/hooks.server.ts` の /setup gate と同じ 2 つの問いを、同じ順で実際に投げる。
 * true = /setup が閉じている (302 `/`)。
 */
async function setupGateBlocks(): Promise<boolean> {
	const [setupRequired, wizardInProgress] = await Promise.all([
		isSetupRequired('t-wizard'),
		isSetupWizardInProgress('t-wizard'),
	]);
	return shouldBlockSetupAccess({ setupRequired, wizardInProgress });
}

function formEvent(values: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(values)) fd.set(k, v);
	return {
		request: { formData: () => Promise.resolve(fd) },
		locals: { context: { tenantId: 't-wizard', licenseStatus: 'none', role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: route action の event 型は route ごとに異なる
	} as any;
}

function loadEvent(path: string) {
	return {
		locals: { context: { tenantId: 't-wizard', licenseStatus: 'none', role: 'owner' } },
		url: new URL(`http://localhost${path}`),
		// biome-ignore lint/suspicious/noExplicitAny: route load の event 型は route ごとに異なる
	} as any;
}

beforeEach(() => {
	children = [];
	settings = new Map();
	vi.clearAllMocks();
});

describe('セットアップウィザードを step 1 から complete まで歩ける (#4863)', () => {
	it('[W1][W2][W3] addChild のあとも gate は開いたままで、complete で閉じる', async () => {
		expect(await setupGateBlocks(), '[W1] 子供 0 人なのに /setup が閉じている').toBe(false);

		// step 1: 最初の子供を登録する (この POST は子供 0 人の時点で処理されるので gate を通る)
		const result = await addChildAction(formEvent({ nickname: 'まさと', age: '7', theme: 'blue' }));
		expect(result).toEqual({ success: true });
		expect(children).toHaveLength(1);

		expect(
			await setupGateBlocks(),
			'[W2] 子供を 1 人登録した瞬間に step 2〜9 が閉まっている — 本 PR が直した欠陥そのもの',
		).toBe(false);

		// step 9: 完了画面に到達する
		await completeRoute.load(loadEvent('/setup/complete?imported=3&skipped=0'));

		expect(
			await setupGateBlocks(),
			'[W3] 歩き終えたのに /setup が開いたまま = 完了後の再突入を防げていない',
		).toBe(true);
	});

	it('[W4] 画面を見ただけ (GET) では印は立たない', async () => {
		await childrenRoute.load(loadEvent('/setup/children'));

		expect(
			await isSetupWizardInProgress('t-wizard'),
			'[W4] load (GET) で印が立っている — hover 先読みだけでウィザードが開く',
		).toBe(false);
		// 子供を作る前は setupRequired 側で開いているので、gate 自体は開いていてよい
		expect(await setupGateBlocks()).toBe(false);
	});

	it('[W5] 既存テナント (子供が居て印なし) は従来どおりブロックされる', async () => {
		children = [{ id: 'c-legacy', nickname: 'れい', age: 9, uiMode: 'elementary' }];

		expect(
			await setupGateBlocks(),
			'[W5] 既存テナントの挙動を変えている (本 PR は新規に印が立つ人だけを対象にする)',
		).toBe(true);
	});
});
