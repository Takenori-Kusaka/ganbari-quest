// tests/unit/routes/activity-pin-route-4716.test.ts
//
// #4716 (QM #4802 adversarial 指摘): POST / DELETE /api/v1/children/[id]/activities/[activityId]/pin の
// route test が無く、「拒否理由 (ActivityPinError) は 400 で理由を返す / 想定外例外は 500 で内部 message を
// 顧客に出さない (ADR-0062)」の契約が固定されていなかった。
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

	it('未認証は 401', async () => {
		const res = await POST(makeEvent({ context: null }));
		expect(res.status).toBe(401);
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

	it('ActivityPinError (上限 / 不在 = 顧客に説明できる拒否) は 400 で理由を返す', async () => {
		mockToggle.mockRejectedValue(
			new ActivityPinError('PIN_LIMIT_EXCEEDED', 'おきにいりは 3こまでだよ'),
		);
		const res = await POST(makeEvent({}));
		expect(res.status).toBe(400);
		const b = await bodyOf(res);
		expect(b.error?.code).toBe('VALIDATION_ERROR');
		expect(b.error?.message).toBe('おきにいりは 3こまでだよ');
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
