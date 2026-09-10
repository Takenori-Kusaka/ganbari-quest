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
	getChildSpecialRewards: vi.fn(async () => []),
	grantSpecialReward: vi.fn(async () => ({ id: 'sr-1' })),
}));
// #4866 系 2 周目: AI 提案 3 経路 + OCR + 特別なごほうび
// (応援メッセージの AI 提案は本 PR で機能ごと撤去。PO 決裁 2026-09-10 決定 9)
vi.mock('$lib/server/services/activity-suggest-service', () => ({
	suggestActivity: vi.fn(async () => ({})),
}));
vi.mock('$lib/server/services/checklist-suggest-service', () => ({
	suggestChecklist: vi.fn(async () => ({})),
}));
vi.mock('$lib/server/services/reward-suggest-service', () => ({
	suggestReward: vi.fn(async () => ({})),
}));
vi.mock('$lib/server/services/receipt-ocr-service', () => ({
	ocrReceipt: vi.fn(async () => ({ items: [] })),
	RECEIPT_MAX_IMAGE_BYTES: 5_000_000,
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
// PO 決裁 2026-09-10 決定 6 で親限定にした 5 経路が触るもの
vi.mock('$lib/server/db/image-repo', () => ({
	updateChildAvatarUrl: vi.fn(async () => undefined),
}));
vi.mock('$lib/server/services/point-service', () => ({
	convertPoints: vi.fn(async () => ({ converted: true, message: 'ok' })),
}));
vi.mock('$lib/server/services/voice-service', () => ({
	listVoices: vi.fn(async () => []),
	uploadVoice: vi.fn(async () => ({ id: 'v-1' })),
	activateVoice: vi.fn(async () => true),
	deleteVoice: vi.fn(async () => true),
}));

type Role = 'owner' | 'parent' | 'child';

function ctx(role: Role) {
	return { context: { tenantId: 't-1', role, licenseStatus: 'active' } };
}

/** multipart を受ける route 用。role gate を抜けた先で formData() が落ちないようにする。 */
function formReq(method: string, fields: Record<string, string> = {}): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/api/v1/x', { method, body: form });
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
const activityVisibility = await import(
	'../../../src/routes/api/v1/activities/[id]/visibility/+server'
);
const activitySuggest = await import('../../../src/routes/api/v1/activities/suggest/+server');
const checklistSuggest = await import('../../../src/routes/api/v1/checklists/suggest/+server');
const rewardSuggest = await import('../../../src/routes/api/v1/special-rewards/suggest/+server');
const ocrReceiptRoute = await import('../../../src/routes/api/v1/points/ocr-receipt/+server');
const specialRewardGrant = await import(
	'../../../src/routes/api/v1/special-rewards/[childId]/+server'
);
const decay = await import('../../../src/routes/api/v1/settings/decay/+server');
const rewardTemplates = await import(
	'../../../src/routes/api/v1/special-rewards/templates/+server'
);
// PO 決裁 2026-09-10 決定 6 の 5 経路
const childAvatar = await import('../../../src/routes/api/v1/children/[id]/avatar/+server');
const childVoices = await import('../../../src/routes/api/v1/children/[id]/voices/+server');
const childVoiceById = await import(
	'../../../src/routes/api/v1/children/[id]/voices/[voiceId]/+server'
);
const pointsConvert = await import('../../../src/routes/api/v1/points/convert/+server');
const pinGateOnboarding = await import(
	'../../../src/routes/api/v1/settings/pin-gate-onboarding/+server'
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
		name: 'PATCH /api/v1/activities/[id]/visibility',
		why: 'DELETE と同じ「非表示にする」を別 route から行う (第 2 の入口)',
		call: (role: Role) =>
			activityVisibility.PATCH({
				params: { id: 'a-1' },
				request: req('PATCH', { isVisible: false }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/activities/suggest',
		why: 'AI に活動を提案させる (LLM を叩く = ベンダーコスト)',
		call: (role: Role) =>
			activitySuggest.POST({
				request: req('POST', { text: 'はみがき' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/checklists/suggest',
		why: 'AI にチェックリストを提案させる',
		call: (role: Role) =>
			checklistSuggest.POST({
				request: req('POST', { text: 'あさのしたく' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/special-rewards/suggest',
		why: 'AI にごほうびを提案させる',
		call: (role: Role) =>
			rewardSuggest.POST({
				request: req('POST', { text: 'おやつ' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/points/ocr-receipt',
		why: '領収書画像 (氏名・住所が写り込む) を OCR にかける',
		call: (role: Role) =>
			ocrReceiptRoute.POST({
				request: req('POST', { image: 'x', mimeType: 'image/png' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/special-rewards/[childId]',
		why: '特別なごほうびを付与する (子供が**自分自身に**付与できた)',
		call: (role: Role) =>
			specialRewardGrant.POST({
				params: { childId: 'c-1' },
				request: req('POST', { rewardId: 'r-1' }),
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
	// --- PO 決裁 2026-09-10 決定 6 (線引き: 子供が「自分の記録・自分の画面の並び」を
	// 触るのは child 可。家族の設定・お金・PII・他人に届くものは親限定) ---
	{
		name: 'POST /api/v1/children/[id]/avatar',
		why: '子供の顔写真をアップロードする (候補選択ではなく PII そのもの)',
		call: (role: Role) =>
			childAvatar.POST({
				params: { id: 'c-1' },
				request: formReq('POST'),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/children/[id]/voices',
		why: '録音した声を登録する (PII、しかも再生されるのはきょうだいの画面)',
		call: (role: Role) =>
			childVoices.POST({
				params: { id: 'c-1' },
				request: formReq('POST'),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'PATCH /api/v1/children/[id]/voices/[voiceId]',
		why: '登録済みの声を差し替える',
		call: (role: Role) =>
			childVoiceById.PATCH({
				params: { id: 'c-1', voiceId: 'v-1' },
				request: req('PATCH', { label: 'x' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'DELETE /api/v1/children/[id]/voices/[voiceId]',
		why: '登録済みの声を消す',
		call: (role: Role) =>
			childVoiceById.DELETE({
				params: { id: 'c-1', voiceId: 'v-1' },
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/points/convert',
		why: 'ポイントを現金・金券に換える (家庭のお金が動く)',
		call: (role: Role) =>
			pointsConvert.POST({
				request: req('POST', { childId: 'c-1', amount: 500, mode: 'preset' }),
				locals: ctx(role),
			} as never) as Promise<Response>,
	},
	{
		name: 'POST /api/v1/settings/pin-gate-onboarding',
		why: '保護者向け案内の既読フラグを tenant 全体に立てる',
		call: (role: Role) =>
			pinGateOnboarding.POST({
				request: req('POST'),
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

/**
 * 「403 かどうか」だけを取り出す。
 *
 * gate を抜けた先で入力不足の 400 を **throw** する route があるため
 * (`error(400, …)` は Response ではなく HttpError を投げる)、返り値と throw の
 * 両方から status を拾う。**403 でないこと**を見るのが目的で、その先の妥当性は
 * それぞれの route の test が見る。
 */
async function statusOf(call: () => Promise<Response>): Promise<number> {
	try {
		return (await call()).status;
	} catch (e) {
		const status = (e as { status?: unknown })?.status;
		if (typeof status === 'number') return status;
		throw e;
	}
}

describe('[A2] 閉じすぎていない (owner / parent は通る)', () => {
	for (const entry of PARENT_ONLY_WRITES) {
		for (const role of ['owner', 'parent'] as const) {
			it(`${entry.name} は ${role} で 403 にならない`, async () => {
				const status = await statusOf(() => entry.call(role));
				expect(status, `${role} まで閉じている = 親が自分の設定を触れない`).not.toBe(403);
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

describe('[A5] child 可の経路でも、宛先の妥当性は seam が見ている', () => {
	// PO 決裁 2026-09-10 決定 6:「`POST /messages/[childId]` は child 可。
	// **`requireChildAccess` が配線済みであることを確認する**」。
	// child 可 = 誰の childId でもよい、ではない。きょうだい間は許すが、
	// **別テナントの子**や**自分と無関係な child scope**は seam が止める。
	it('POST /api/v1/messages/[childId] は requireChildAccess を通る', async () => {
		const { readFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		const src = readFileSync(
			join(__dirname, '../../..', 'src/routes/api/v1/messages/[childId]/+server.ts'),
			'utf8',
		);
		expect(
			src.includes('requireChildAccess(locals, asChildId(params.childId))'),
			'child 可のまま requireChildAccess が外れると、tenant 跨ぎの childId に送れる',
		).toBe(true);
	});
});

describe('[A4] 子供が記録する経路は閉じない', () => {
	// 閉じすぎの回帰は source で見る (この経路を呼ぶには記録 service の mock が要り、
	// 「閉じていないこと」の確認に対して釣り合わないため)。
	//
	// PO 決裁 2026-09-10 決定 6: 「子供が自分の記録・自分の画面の並びを触る」経路は
	// **現状維持 (child 可)** と決まった。決まったものは決まったまま動かないよう、
	// ここに載せて**閉じすぎの回帰**を検出する。
	const CHILD_ALLOWED = [
		// 子供が自分のがんばりを記録する = この製品の中核体験そのもの
		'src/routes/api/v1/activity-logs/+server.ts',
		// 自分のホームの並び (おきにいり)
		'src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server.ts',
		// 自分の利用時間の記録
		'src/routes/api/v1/usage/+server.ts',
		// きょうだい間のメッセージ (宛先の妥当性は requireChildAccess が見る)
		'src/routes/api/v1/messages/[childId]/+server.ts',
		// 自分が見たチュートリアルの既読
		'src/routes/api/v1/settings/tutorial/+server.ts',
	];
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
