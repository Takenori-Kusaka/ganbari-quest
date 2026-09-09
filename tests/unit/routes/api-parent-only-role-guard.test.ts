// tests/unit/routes/api-parent-only-role-guard.test.ts
//
// **親だけが触ってよい `/api/v1/**` の書き込みを、child セッションで実際に叩いて 403 を確かめる**
// (QM 監査 security [S2] / PO 決裁 2026-09-09「明らかに親限定の 5 経路を先に閉じる」)。
//
// なぜ route ごとの責務なのか: `authorization.ts` の `ROUTE_RULES` は `/api/v1` を
// `['owner','parent','child']` に開けている (既存 test が固定している仕様)。つまり
// **child セッションは `/api/v1/**` に到達できる**ので、「ここは親だけ」は各 route が言う以外にない。
//
// 監査の実測: `/api/v1/**` (非 admin / 非 parent-gate) の mutation ハンドラ **31 本すべて**が
// `requireRole` も inline の role 判定も持っていなかった。子供が親の設定した活動の
// `basePoints` を書き換えたり、家族全体のポイント減少強度を `none` にできる状態で、
// **この製品の中核 (親が決め、子が記録する) が子供側から書き換えられる** (ADR-0012 の前提が崩れる)。
//
// 31 本すべてを親限定にするのは誤り (`POST /api/v1/activity-logs` は子供が記録する経路で
// child 可が正しい)。**明らかに親限定の 5 経路だけを先に閉じ、残りは製品判断として PO へ上げる。**
//
// **なぜ source 検査ではなく振る舞いか**: 初版は file 内の `forbiddenForNonParent(` の
// **出現数を数えるだけ**で、どのハンドラに付いているかを見ていなかった。そのため
// **guard が 4 file すべてで GET に付き、書き込み側 (POST / PATCH / DELETE / PUT) には
// 1 つも付いていない**状態を緑で通していた —— 直したはずの欠陥がそのまま残り、
// 代わりに読み取りだけが塞がっていた。**実際に child で叩いて 403 を見る。**
//
// 固定する不変条件:
//   [A1] 親限定と決めた**書き込み**を child で叩くと 403
//   [A2] 同じ経路を owner / parent で叩くと 403 ではない (閉じすぎていない)
//   [A3] 読み取り (GET) は child でも閉じない (PO 決裁「判断が要るものは私へ」)
//   [A4] 子供が記録する経路は閉じない (閉じすぎの回帰も見る)

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// route が触る service / repo は最小限だけ返す (403 に到達する前に落ちないため)
vi.mock('$lib/server/services/activity-service', () => ({
	getActivities: vi.fn(async () => []),
	createActivity: vi.fn(async () => ({ id: 'a-1' })),
	getActivityById: vi.fn(async () => ({ id: 'a-1', name: 'はみがき' })),
	updateActivity: vi.fn(async () => ({ id: 'a-1' })),
	deleteActivity: vi.fn(async () => undefined),
	setActivityVisibility: vi.fn(async () => undefined),
}));
vi.mock('$lib/server/services/plan-limit-service', () => ({
	checkActivityLimit: vi.fn(async () => ({ ok: true })),
	resolveFullPlanTier: vi.fn(async () => 'family'),
}));
vi.mock('$lib/server/services/special-reward-service', () => ({
	getRewardTemplates: vi.fn(async () => []),
	saveRewardTemplates: vi.fn(async () => undefined),
}));
vi.mock('$lib/server/db/activity-repo', () => ({
	findChildById: vi.fn(async () => ({ id: 'c-1', nickname: 'まさと' })),
}));
vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: vi.fn(async () => 'normal'),
	setSetting: vi.fn(async () => undefined),
}));
vi.mock('$lib/server/auth/factory', () => ({
	requireChildAccess: vi.fn(),
	requireTenantId: () => 't-1',
	requireRole: vi.fn(),
}));

type Role = 'owner' | 'parent' | 'child';

function ctx(role: Role) {
	return { context: { tenantId: 't-1', role, licenseStatus: 'active' } };
}

function req(method: string, body?: unknown): Request {
	return new Request('http://localhost/api/v1/x', {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const activities = await import('../../../src/routes/api/v1/activities/+server');
const activityById = await import('../../../src/routes/api/v1/activities/[id]/+server');
const decay = await import('../../../src/routes/api/v1/settings/decay/+server');
const rewardTemplates = await import(
	'../../../src/routes/api/v1/special-rewards/templates/+server'
);

/** 親限定と決めた**書き込み**。読み取りは含めない (PO 決裁の線)。 */
const PARENT_ONLY_WRITES = [
	{
		name: 'POST /api/v1/activities',
		why: '活動を新規作成する',
		call: (role: Role) =>
			activities.POST({
				request: req('POST', { childId: 'c-1', name: 'x', categoryId: 'study', basePoints: 1 }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'PATCH /api/v1/activities/[id]',
		why: '親が設定した活動の basePoints を書き換える',
		call: (role: Role) =>
			activityById.PATCH({
				params: { id: 'a-1' },
				request: req('PATCH', { basePoints: 999 }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'DELETE /api/v1/activities/[id]',
		why: '活動を非表示にする',
		call: (role: Role) =>
			activityById.DELETE({
				params: { id: 'a-1' },
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'PUT /api/v1/settings/decay',
		why: '家族全体のポイント減少強度を none に変更する',
		call: (role: Role) =>
			decay.PUT({
				request: req('PUT', { intensity: 'none' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'PUT /api/v1/special-rewards/templates',
		why: 'ごほうびテンプレートを書き換える',
		call: (role: Role) =>
			rewardTemplates.PUT({
				request: req('PUT', { templates: [] }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
] as const;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('[A1] 親限定の書き込みは child で 403', () => {
	for (const entry of PARENT_ONLY_WRITES) {
		it(`${entry.name} — ${entry.why}`, async () => {
			const res = await entry.call('child');
			expect(
				res.status,
				`child が「${entry.why}」をできてしまう。/api/v1 は ROUTE_RULES が child を通すので、` +
					'この経路自身が role を見る以外に止める場所が無い',
			).toBe(403);
			const body = (await res.json()) as { error?: { code?: string } };
			expect(body.error?.code, '集約先 (forbiddenForNonParent) を経由していない').toBe('FORBIDDEN');
		});
	}
});

describe('[A2] 閉じすぎていない (owner / parent は通る)', () => {
	for (const entry of PARENT_ONLY_WRITES) {
		for (const role of ['owner', 'parent'] as const) {
			it(`${entry.name} は ${role} で 403 にならない`, async () => {
				const res = await entry.call(role);
				expect(res.status, `${role} まで閉じている = 親が自分の設定を触れない`).not.toBe(403);
			});
		}
	}
});

describe('[A3] 読み取りは閉じない (PO 決裁「判断が要るものは私へ」)', () => {
	it('GET /api/v1/settings/decay は child でも 403 にしない', async () => {
		const res = (await decay.GET({ locals: ctx('child') } as never)) as Response;
		expect(
			res.status,
			'読み取りまで閉じるのは「明らかに親限定」の線を越えている。閉じるなら PO 判断を経る',
		).not.toBe(403);
	});
});

describe('[A4] 子供が記録する経路は閉じない', () => {
	// 閉じすぎの回帰は source で見る (この経路を呼ぶには記録 service の mock が要り、
	// 「閉じていないこと」の確認に対して釣り合わないため)。
	const CHILD_ALLOWED = ['src/routes/api/v1/activity-logs/+server.ts'];
	for (const file of CHILD_ALLOWED) {
		it(`${file} は親限定にしない`, async () => {
			const { readFileSync } = await import('node:fs');
			const { join } = await import('node:path');
			const src = readFileSync(join(__dirname, '../../..', file), 'utf8');
			expect(
				src.includes('forbiddenForNonParent'),
				`${file} を親限定にすると、子供が自分の記録をつけられなくなる ` +
					'(この製品の中核体験そのもの)',
			).toBe(false);
		});
	}
});
