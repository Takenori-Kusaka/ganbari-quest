// tests/unit/routes/consent-action.test.ts
// #708: consent ページ POST action の契約テスト
// - 未認証 → 401
// - 規約未同意 → 400
// - プライバシー未同意 → 400
// - 両方同意 → recordConsent 呼び出し + /admin へリダイレクト
// - recordConsent 失敗 → 500

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckConsent = vi.fn();
const mockRecordConsent = vi.fn();
const mockGetAuthMode = vi.fn().mockReturnValue('cognito');

vi.mock('$lib/server/services/consent-service', () => ({
	checkConsent: mockCheckConsent,
	recordConsent: mockRecordConsent,
	CURRENT_TERMS_VERSION: '2026-04-09',
	CURRENT_PRIVACY_VERSION: '2026-04-09',
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: mockGetAuthMode,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { actions } = await import('../../../src/routes/consent/+page.server');

function createFormData(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) {
		fd.set(k, v);
	}
	return fd;
}

function createRequest(data: Record<string, string>): Request {
	return {
		formData: () => Promise.resolve(createFormData(data)),
		headers: { get: (name: string) => (name === 'user-agent' ? 'test-ua' : null) },
	} as unknown as Request;
}

function createEvent(
	formData: Record<string, string>,
	opts: { authenticated?: boolean; tenantId?: string | null } = {},
) {
	return {
		request: createRequest(formData),
		locals: {
			authenticated: opts.authenticated ?? true,
			identity: { type: 'cognito', userId: 'user-1' },
			context: opts.tenantId !== null ? { tenantId: opts.tenantId ?? 'tenant-1' } : undefined,
		},
		getClientAddress: () => '127.0.0.1',
	};
}

async function captureRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	try {
		await fn();
		throw new Error('Expected redirect but action returned normally');
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return e as { status: number; location: string };
		}
		throw e;
	}
}

describe('consent action (#708)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAuthMode.mockReturnValue('cognito');
		mockRecordConsent.mockResolvedValue([]);
	});

	it('未認証ユーザーは 401 を返す', async () => {
		const result = await actions.default!(
			createEvent(
				{ agreedTerms: 'on', agreedPrivacy: 'on' },
				{ authenticated: false },
			) as unknown as Parameters<NonNullable<typeof actions.default>>[0],
		);
		// fail() は例外ではなく ActionFailure を返す
		expect(result).toMatchObject({ status: 401 });
	});

	it('利用規約未同意で 400 を返す（リンク閲覧なしで submit された想定）', async () => {
		const result = await actions.default!(
			createEvent({ agreedPrivacy: 'on' }) as unknown as Parameters<
				NonNullable<typeof actions.default>
			>[0],
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('プライバシーポリシー未同意で 400 を返す', async () => {
		const result = await actions.default!(
			createEvent({ agreedTerms: 'on' }) as unknown as Parameters<
				NonNullable<typeof actions.default>
			>[0],
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('両方同意 → recordConsent 呼び出し + /admin リダイレクト', async () => {
		const r = await captureRedirect(() =>
			actions.default!(
				createEvent({ agreedTerms: 'on', agreedPrivacy: 'on' }) as unknown as Parameters<
					NonNullable<typeof actions.default>
				>[0],
			),
		);
		expect(r.location).toBe('/admin');
		expect(mockRecordConsent).toHaveBeenCalledOnce();
		expect(mockRecordConsent).toHaveBeenCalledWith(
			'tenant-1',
			'user-1',
			['terms', 'privacy'],
			'127.0.0.1',
			'test-ua',
		);
	});

	it('recordConsent 失敗時は 500 を返す', async () => {
		mockRecordConsent.mockRejectedValueOnce(new Error('DynamoDB error'));
		const result = await actions.default!(
			createEvent({ agreedTerms: 'on', agreedPrivacy: 'on' }) as unknown as Parameters<
				NonNullable<typeof actions.default>
			>[0],
		);
		expect(result).toMatchObject({ status: 500 });
	});
});
