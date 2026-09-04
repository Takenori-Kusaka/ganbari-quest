// tests/unit/routes/activity-pin-route-4716.test.ts
//
// #4716 (QM #4802 adversarial 指摘): POST / DELETE /api/v1/children/[id]/activities/[activityId]/pin の
// route test が無く、「拒否理由 (ActivityPinError) は 400 で理由を返す / 想定外例外は 500 で内部 message を
// 顧客に出さない (ADR-0062)」の契約が固定されていなかった。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER_GATE_LABELS } from '../../../src/lib/domain/labels';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const mockToggle = vi.fn();
vi.mock('$lib/server/services/activity-pin-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/activity-pin-service')>(
		'$lib/server/services/activity-pin-service',
	);
	return { ...actual, toggleActivityPin: mockToggle };
});
const mockLoggerError = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: { error: mockLoggerError, info: vi.fn(), warn: vi.fn() },
}));

const { ActivityPinError } = await import('$lib/server/services/activity-pin-service');
const { DELETE, POST } = await import(
	'../../../src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server'
);

type Handler = typeof POST;

function makeEvent(opts: {
	context?: { tenantId: string } | null;
	id?: string;
	activityId?: string;
	body?: unknown;
}) {
	const { context = { tenantId: 't-1' }, id = '1', activityId = '10', body } = opts;
	return {
		params: { id, activityId },
		locals: { context },
		request: new Request('http://localhost/api/v1/children/1/activities/10/pin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	} as unknown as Parameters<Handler>[0];
}

async function bodyOf(
	res: Response,
): Promise<{ error?: { code: string; message: string } } & Record<string, unknown>> {
	return (await res.json()) as { error?: { code: string; message: string } } & Record<
		string,
		unknown
	>;
}

describe('#4716 activity pin route — 拒否理由と想定外例外の種別を取り違えない', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockToggle.mockResolvedValue({ pinned: true });
	});

	// PO 回答 (2026-09-03) §4 #2 / ADR-0062: 401 も他のエラーと同じ統一形で返す。
	// 旧実装は `json({ error: '認証が必要です' }, { status: 401 })` の独自形 (error が文字列) で、
	// client の `error.code` 分岐に乗らず、内部の文言も labels SSOT を経由していなかった。
	it('未認証 (identity 無し) は 401 で ADR-0062 統一形 (code / message / userMessage) を返し、service を呼ばない', async () => {
		for (const handler of [POST, DELETE]) {
			const res = await handler(makeEvent({ context: null }));
			expect(res.status).toBe(401);
			const b = await bodyOf(res);
			// 統一形: error はオブジェクトで、keys が apiError の出力と一致する (独自 key を足さない)
			expect(typeof b.error).toBe('object');
			expect(Object.keys(b.error ?? {}).sort()).toEqual(
				['action', 'code', 'message', 'severity', 'userMessage'].sort(),
			);
			expect(b.error?.code).toBe('UNAUTHORIZED');
			expect(b.error?.message).toBe(OWNER_GATE_LABELS.authRequired);
			expect((b.error as { userMessage?: string } | undefined)?.userMessage).toEqual(
				expect.any(String),
			);
			// 内部情報を出さない: params / tenant / stack 由来の文字列が body に無い
			const raw = JSON.stringify(b);
			expect(raw).not.toContain('tenantId');
			expect(raw).not.toContain('stack');
			expect(raw).not.toMatch(/at \w+ \(/);
		}
		expect(mockToggle).not.toHaveBeenCalled();
	});

	it('他 tenant の context でも 401 にはならず、service には context の tenantId だけを渡す (tenant 分離は service 側の述語が担う)', async () => {
		mockToggle.mockRejectedValueOnce(
			new ActivityPinError('ACTIVITY_NOT_FOUND', '活動が見つかりません'),
		);
		const res = await POST(makeEvent({ context: { tenantId: 't-other' } }));
		expect(mockToggle).toHaveBeenCalledWith(expect.anything(), expect.anything(), true, 't-other');
		// 他 tenant の活動は service が「不在」として拒否 → 統一形の 404。tenant id は body に出ない
		expect(res.status).toBe(404);
		const b = await bodyOf(res);
		expect(b.error?.code).toBe('NOT_FOUND');
		expect(JSON.stringify(b)).not.toContain('t-other');
	});

	it('route 内に ADR-0062 helper を通らない独自 json エラー形が無い (再導入 guard)', () => {
		const src = readFileSync(
			join(REPO_ROOT, 'src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server.ts'),
			'utf-8',
		);
		// `json({ error: '…' }, { status: NNN })` (error が文字列の独自形) を書かせない。
		// 正常応答の `json(result)` は当たらない。
		expect(src).not.toMatch(/json\(\s*\{\s*error\s*:/);
		expect(src).not.toMatch(/status:\s*401/);
	});

	it('ID 欠落は 400 (VALIDATION_ERROR)。書式は backend (sqlite 数値 / dsql uuid) に依存するため route では空だけを弾く', async () => {
		const res = await POST(makeEvent({ activityId: '' }));
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error?.code).toBe('VALIDATION_ERROR');
		expect(mockToggle).not.toHaveBeenCalled();
	});

	it('POST は body の pinned=false を尊重し、body 無しは pinned=true', async () => {
		await POST(makeEvent({ body: { pinned: false } }));
		expect(mockToggle).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), false, 't-1');
		await POST(makeEvent({}));
		expect(mockToggle).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), true, 't-1');
	});

	// PO 回答 (2026-09-03) §4 #2 follow-up: 旧実装は ActivityPinError を code に関わらず
	// VALIDATION_ERROR (400) に畳んでいたため、この endpoint は NOT_FOUND を返せず、client は
	// 顧客向け文言の部分一致 (message.includes('上限')) でしか種別を見分けられなかった。
	// service の拒否理由 → API の code の 1:1 写像を固定する (畳み直した瞬間に落ちる)。
	it.each([
		['PIN_LIMIT_EXCEEDED', 'おきにいりは 3こまでだよ', 'PIN_LIMIT_EXCEEDED', 409],
		['ACTIVITY_NOT_FOUND', 'その かつどうが みつからなかったよ', 'NOT_FOUND', 404],
	] as const)('ActivityPinError(%s) は API code %s / status %d に写像され、理由の message を返す', async (serviceCode, message, apiCode, status) => {
		for (const handler of [POST, DELETE]) {
			mockToggle.mockRejectedValueOnce(new ActivityPinError(serviceCode, message));
			const res = await handler(makeEvent({}));
			expect(res.status).toBe(status);
			const b = await bodyOf(res);
			expect(b.error?.code).toBe(apiCode);
			// 顧客に説明できる拒否理由はそのまま返す (汎用文言に潰さない)
			expect(b.error?.message).toBe(message);
		}
	});

	// 2 つの拒否理由が同じ code に潰れていないこと (どちらか一方だけを見る test では検出できない)
	it('上限と不在は異なる API code / status になる (畳み込みの再導入 guard)', async () => {
		mockToggle.mockRejectedValueOnce(new ActivityPinError('PIN_LIMIT_EXCEEDED', 'x'));
		const limit = await bodyOf(await POST(makeEvent({})));
		mockToggle.mockRejectedValueOnce(new ActivityPinError('ACTIVITY_NOT_FOUND', 'y'));
		const notFound = await bodyOf(await POST(makeEvent({})));
		expect(limit.error?.code).not.toBe(notFound.error?.code);
	});

	// 上限は「プラン由来」ではないので、アップグレード導線を出す code を使ってはいけない
	it('上限拒否に PLAN_LIMIT_EXCEEDED を使わない (契約済みの顧客にアップグレードを促さない)', async () => {
		mockToggle.mockRejectedValueOnce(
			new ActivityPinError('PIN_LIMIT_EXCEEDED', 'おきにいりは 3こまでだよ'),
		);
		const b = await bodyOf(await POST(makeEvent({})));
		expect(b.error?.code).not.toBe('PLAN_LIMIT_EXCEEDED');
		expect(JSON.stringify(b)).not.toContain('アップグレード');
	});

	it('想定外例外 (DB 障害等) は 500 (INTERNAL_ERROR) で、内部 message を顧客に出さない', async () => {
		mockToggle.mockRejectedValue(new Error('connection refused: dsql-endpoint'));
		for (const handler of [POST, DELETE]) {
			const res = await handler(makeEvent({}));
			expect(res.status).toBe(500);
			const b = await bodyOf(res);
			expect(b.error?.code).toBe('INTERNAL_ERROR');
			expect(JSON.stringify(b)).not.toContain('connection refused');
			expect(JSON.stringify(b)).not.toContain('dsql-endpoint');
		}
		// 顧客に出さない代わりに、運用側の log には原因 (cause) が残ること (adv-4831 指摘: 両方消える改修を止める)
		expect(mockLoggerError).toHaveBeenCalled();
		const logged = JSON.stringify(mockLoggerError.mock.calls);
		expect(logged).toContain('connection refused');
	});

	it('DELETE は pinned=false で service を呼ぶ', async () => {
		const res = await DELETE(makeEvent({}));
		expect(res.status).toBe(200);
		expect(mockToggle).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, 't-1');
	});
});
