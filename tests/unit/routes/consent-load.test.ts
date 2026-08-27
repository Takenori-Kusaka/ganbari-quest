// tests/unit/routes/consent-load.test.ts
// #616: consent ページ load 関数の hasExistingConsent 分岐テスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---
const mockCheckConsent = vi.fn();
const mockGetAuthMode = vi.fn();

vi.mock('$lib/server/services/consent-service', () => ({
	checkConsent: mockCheckConsent,
	recordConsent: vi.fn(),
	CURRENT_TERMS_VERSION: '2026-04-01',
	CURRENT_PRIVACY_VERSION: '2026-04-01',
	CURRENT_CROSS_BORDER_VERSION: '2026-04-01',
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: mockGetAuthMode,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { load } = await import('../../../src/routes/consent/+page.server');

async function captureRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	try {
		await fn();
		throw new Error('Expected redirect but load() returned normally');
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return e as { status: number; location: string };
		}
		throw e;
	}
}

function makeLocals(opts: { authenticated?: boolean; tenantId?: string | null } = {}) {
	return {
		authenticated: opts.authenticated ?? true,
		context: opts.tenantId !== null ? { tenantId: opts.tenantId ?? 'tenant-1' } : undefined,
		identity: { type: 'cognito', userId: 'user-1' },
	};
}

describe('consent load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAuthMode.mockReturnValue('cognito');
	});

	it('local モードでは / にリダイレクト', async () => {
		mockGetAuthMode.mockReturnValue('local');
		const r = await captureRedirect(() =>
			load({ locals: makeLocals() } as Parameters<typeof load>[0]),
		);
		expect(r.location).toBe('/');
	});

	it('未認証ユーザーは /auth/login にリダイレクト', async () => {
		const r = await captureRedirect(() =>
			load({
				locals: makeLocals({ authenticated: false }),
			} as Parameters<typeof load>[0]),
		);
		expect(r.location).toBe('/auth/login');
	});

	it('最新同意済みユーザーは /admin にリダイレクト', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: true,
			privacyAccepted: true,
			needsReconsent: false,
			termsVersion: '2026-04-01',
			privacyVersion: '2026-04-01',
		});
		const r = await captureRedirect(() =>
			load({ locals: makeLocals() } as Parameters<typeof load>[0]),
		);
		expect(r.location).toBe('/admin');
	});

	it('新規ユーザー（同意レコードなし）は hasExistingConsent: false', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: false,
			privacyAccepted: false,
			crossBorderAccepted: false,
			needsReconsent: true,
			termsVersion: undefined,
			privacyVersion: undefined,
			crossBorderVersion: undefined,
		});
		const result = await load({ locals: makeLocals() } as Parameters<typeof load>[0]);
		expect(result).toBeDefined();
		if (!result) return;
		expect(result.hasExistingConsent).toBe(false);
		expect(result.previousTermsVersion).toBeNull();
		expect(result.previousPrivacyVersion).toBeNull();
		expect(result.previousCrossBorderVersion).toBeNull();
	});

	it('既存ユーザー（旧バージョン同意あり）は hasExistingConsent: true', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: false,
			privacyAccepted: false,
			crossBorderAccepted: false,
			needsReconsent: true,
			termsVersion: '2026-03-01',
			privacyVersion: '2026-03-01',
			crossBorderVersion: '2026-03-01',
		});
		const result = await load({ locals: makeLocals() } as Parameters<typeof load>[0]);
		expect(result).toBeDefined();
		if (!result) return;
		expect(result.hasExistingConsent).toBe(true);
		expect(result.previousTermsVersion).toBe('2026-03-01');
		expect(result.previousPrivacyVersion).toBe('2026-03-01');
		expect(result.previousCrossBorderVersion).toBe('2026-03-01');
	});

	it('terms のみ同意済み・privacy 未同意の mixed state', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: true,
			privacyAccepted: false,
			crossBorderAccepted: true,
			needsReconsent: true,
			termsVersion: '2026-04-01',
			privacyVersion: undefined,
			crossBorderVersion: '2026-04-01',
		});
		const result = await load({ locals: makeLocals() } as Parameters<typeof load>[0]);
		expect(result).toBeDefined();
		if (!result) return;
		expect(result.hasExistingConsent).toBe(true);
		expect(result.termsAccepted).toBe(true);
		expect(result.privacyAccepted).toBe(false);
		expect(result.previousTermsVersion).toBe('2026-04-01');
		expect(result.previousPrivacyVersion).toBeNull();
	});

	// #4497: terms/privacy は現行版だが越境移転同意だけ無い状態 = Google OAuth で登録した
	// 既存ユーザーの実際の姿。この画面が唯一の取得点なので、必ず未同意として出ること。
	it('越境移転のみ未同意（OAuth 登録済みユーザー）は再同意対象として返る', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: true,
			privacyAccepted: true,
			crossBorderAccepted: false,
			needsReconsent: true,
			termsVersion: '2026-04-01',
			privacyVersion: '2026-04-01',
			crossBorderVersion: undefined,
		});
		const result = await load({ locals: makeLocals() } as Parameters<typeof load>[0]);
		expect(result).toBeDefined();
		if (!result) return;
		expect(result.crossBorderAccepted).toBe(false);
		expect(result.previousCrossBorderVersion).toBeNull();
		expect(result.currentCrossBorderVersion).toBe('2026-04-01');
	});

	it('返却値に必要なフィールドが全て含まれる', async () => {
		mockCheckConsent.mockResolvedValue({
			termsAccepted: false,
			privacyAccepted: false,
			crossBorderAccepted: false,
			needsReconsent: true,
			termsVersion: undefined,
			privacyVersion: undefined,
			crossBorderVersion: undefined,
		});
		const result = await load({ locals: makeLocals() } as Parameters<typeof load>[0]);
		expect(result).toBeDefined();
		if (!result) return;
		expect(result).toHaveProperty('termsAccepted');
		expect(result).toHaveProperty('privacyAccepted');
		expect(result).toHaveProperty('currentTermsVersion');
		expect(result).toHaveProperty('currentPrivacyVersion');
		expect(result).toHaveProperty('hasExistingConsent');
		expect(result).toHaveProperty('previousTermsVersion');
		expect(result).toHaveProperty('previousPrivacyVersion');
		expect(result).toHaveProperty('crossBorderAccepted');
		expect(result).toHaveProperty('currentCrossBorderVersion');
		expect(result).toHaveProperty('previousCrossBorderVersion');
	});
});
