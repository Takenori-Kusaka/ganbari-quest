// tests/unit/routes/consent-action.test.ts
// #708: consent ページ POST action の契約テスト
// - 未認証 → 401
// - 規約未同意 → 400
// - プライバシー未同意 → 400
// - 越境移転未同意 → 400 (#4497)
// - 全て同意 → recordConsent 呼び出し + /admin へリダイレクト
// - recordConsent 失敗 → 500

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckConsent = vi.fn();
const mockRecordConsent = vi.fn();
const mockGetAuthMode = vi.fn().mockReturnValue('cognito');

vi.mock('$lib/server/services/consent-service', () => ({
	checkConsent: mockCheckConsent,
	recordConsent: mockRecordConsent,
	CURRENT_TERMS_VERSION: '2026-04-28',
	CURRENT_PRIVACY_VERSION: '2026-08-07',
	CURRENT_CROSS_BORDER_VERSION: '2026-08-07',
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
			// #4643: consents.user_id は users.user_id (context.userId)。identity.userId は IdP の sub
			identity: { type: 'cognito', userId: 'cognito-sub-user-1' },
			context:
				opts.tenantId !== null
					? { tenantId: opts.tenantId ?? 'tenant-1', userId: 'user-1' }
					: undefined,
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
		// action は「画面に出していない文書の同意を捏造しない」ため、記録前に現況を読み直す (#4497)
		mockCheckConsent.mockResolvedValue({
			termsAccepted: false,
			privacyAccepted: false,
			crossBorderAccepted: false,
			needsReconsent: true,
		});
	});

	it('未認証ユーザーは 401 を返す', async () => {
		const result = await actions.default!(
			createEvent(
				{ agreedTerms: 'on', agreedPrivacy: 'on', agreedCrossBorder: 'on' },
				{ authenticated: false },
			) as unknown as Parameters<NonNullable<typeof actions.default>>[0],
		);
		// fail() は例外ではなく ActionFailure を返す
		expect(result).toMatchObject({ status: 401 });
	});

	it('利用規約未同意で 400 を返す（リンク閲覧なしで submit された想定）', async () => {
		const result = await actions.default!(
			createEvent({ agreedPrivacy: 'on', agreedCrossBorder: 'on' }) as unknown as Parameters<
				NonNullable<typeof actions.default>
			>[0],
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('プライバシーポリシー未同意で 400 を返す', async () => {
		const result = await actions.default!(
			createEvent({ agreedTerms: 'on', agreedCrossBorder: 'on' }) as unknown as Parameters<
				NonNullable<typeof actions.default>
			>[0],
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	// #4497: OAuth 経由の登録は signup フォームを通らないため、越境移転同意 (§28) の
	// 取得点はこの画面しかない。ここで素通りすると全経路で証跡が残らなくなる。
	it('越境移転未同意で 400 を返す', async () => {
		const result = await actions.default!(
			createEvent({ agreedTerms: 'on', agreedPrivacy: 'on' }) as unknown as Parameters<
				NonNullable<typeof actions.default>
			>[0],
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockRecordConsent).not.toHaveBeenCalled();
	});

	it('全て同意 → recordConsent 呼び出し + /admin リダイレクト', async () => {
		const r = await captureRedirect(() =>
			actions.default!(
				createEvent({
					agreedTerms: 'on',
					agreedPrivacy: 'on',
					agreedCrossBorder: 'on',
				}) as unknown as Parameters<NonNullable<typeof actions.default>>[0],
			),
		);
		expect(r.location).toBe('/admin');
		expect(mockRecordConsent).toHaveBeenCalledOnce();
		expect(mockRecordConsent).toHaveBeenCalledWith(
			'tenant-1',
			'user-1',
			['terms', 'privacy', 'cross-border'],
			'127.0.0.1',
			'test-ua',
		);
	});

	// #4497: 同意記録は監査証跡 (append-only)。画面に出していない = 利用者が同意操作を
	// していない文書について「いま同意した」行を作ってはならない。
	it('既に最新版へ同意済みの種別は記録し直さない', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: true,
			privacyAccepted: true,
			crossBorderAccepted: false,
			needsReconsent: true,
		});
		await captureRedirect(() =>
			actions.default!(
				createEvent({
					agreedTerms: 'on',
					agreedPrivacy: 'on',
					agreedCrossBorder: 'on',
				}) as unknown as Parameters<NonNullable<typeof actions.default>>[0],
			),
		);
		expect(mockRecordConsent).toHaveBeenCalledWith(
			'tenant-1',
			'user-1',
			['cross-border'],
			'127.0.0.1',
			'test-ua',
		);
	});

	it('recordConsent 失敗時は 500 を返す', async () => {
		mockRecordConsent.mockRejectedValueOnce(new Error('DB error'));
		const result = await actions.default!(
			createEvent({
				agreedTerms: 'on',
				agreedPrivacy: 'on',
				agreedCrossBorder: 'on',
			}) as unknown as Parameters<NonNullable<typeof actions.default>>[0],
		);
		expect(result).toMatchObject({ status: 500 });
	});
});
