// tests/unit/routes/child-registration-placeholder-avatar.test.ts
// #4413 AC1 / AC2: 子供の登録経路は 2 つある。
//   - /setup/children        (初期セットアップ)
//   - /admin/children        (後から追加)
// **どちらで登録しても**仮アバターが付くことを、route の action から実際に通して固定する。
//
// child-service は mock せず、repo / storage だけ mock する。片方の route が
// addChild を経由しない実装に書き換わったら本 test が落ちる（= 「片方だけ付く」を構造的に防ぐ）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsertChild = vi.fn();
const mockUpdateChildAvatarUrl = vi.fn();
const mockSaveFile = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: vi.fn(async () => []),
	findArchivedChildren: vi.fn(async () => []),
	findChildById: vi.fn(),
	findChildByUserId: vi.fn(),
	insertChild: (...args: unknown[]) => mockInsertChild(...args),
	updateChild: vi.fn(),
	deleteChild: vi.fn(),
}));

vi.mock('$lib/server/db/image-repo', () => ({
	findCachedImage: vi.fn(),
	findChildForImage: vi.fn(),
	insertCharacterImage: vi.fn(),
	updateChildAvatarUrl: (...args: unknown[]) => mockUpdateChildAvatarUrl(...args),
}));

vi.mock('$lib/server/storage', () => ({
	saveFile: (...args: unknown[]) => mockSaveFile(...args),
	readFile: vi.fn(),
	fileExists: vi.fn(),
	deleteFile: vi.fn(),
	listFiles: vi.fn(async () => []),
	deleteByPrefix: vi.fn(async () => 0),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 't-test',
}));

vi.mock('$lib/server/services/setup-funnel-service', () => ({
	trackSetupFunnel: vi.fn(),
}));

// --- /admin/children が module 読み込み時に掴む周辺 service ---

vi.mock('$lib/server/services/plan-limit-service', () => ({
	applyRetentionFilter: vi.fn((rows: unknown) => rows),
	checkChildLimit: vi.fn(async () => ({ allowed: true, max: null })),
	getPlanLimits: vi.fn(() => ({ historyRetentionDays: null })),
	hasArchivedData: vi.fn(async () => false),
	resolveFullPlanTier: vi.fn(async () => 'free'),
}));

vi.mock('$lib/server/services/activity-log-service', () => ({ getActivityLogs: vi.fn() }));
vi.mock('$lib/server/services/point-service', () => ({ getPointBalance: vi.fn() }));
vi.mock('$lib/server/services/status-service', () => ({
	getChildStatus: vi.fn(),
	updateStatus: vi.fn(),
}));
vi.mock('$lib/server/services/voice-service', () => ({
	activateVoice: vi.fn(),
	deleteVoice: vi.fn(),
	listVoices: vi.fn(),
	uploadVoice: vi.fn(),
}));

const setupRoute = await import('../../../src/routes/setup/children/+page.server');
const adminRoute = await import('../../../src/routes/(parent)/admin/children/+page.server');

const setupAddChild = setupRoute.actions.addChild;
const adminAddChild = adminRoute.actions.addChild;
if (!setupAddChild || !adminAddChild) {
	throw new Error('addChild action が見つからない (登録経路の action 名が変わった?)');
}

function createEvent(formValues: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		request: { formData: () => Promise.resolve(fd) },
		locals: { context: { tenantId: 't-test', licenseStatus: 'none', role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: route action の event 型は route ごとに異なる
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockInsertChild.mockResolvedValue({
		id: 'c-1',
		nickname: 'まさと',
		age: 7,
		theme: 'blue',
		uiMode: 'elementary',
		avatarUrl: null,
	});
});

/** 仮アバターが「テナント配下の SVG として保存され、avatarUrl に反映された」ことを確認する */
function expectPlaceholderAvatarAttached() {
	expect(mockSaveFile, '仮アバターの SVG が storage に保存されていない').toHaveBeenCalledTimes(1);

	const [key, data, contentType] = mockSaveFile.mock.calls[0] as [string, Buffer, string];
	expect(key.startsWith('tenants/t-test/'), 'storage key が tenant scope 外').toBe(true);
	expect(key.endsWith('.svg')).toBe(true);
	expect(contentType).toBe('image/svg+xml');

	const svg = data.toString('utf-8');
	expect(svg).toContain('<svg');
	expect(svg, 'ニックネームの頭文字が入っていない').toContain('>ま<');

	expect(mockUpdateChildAvatarUrl, 'children.avatar_url が更新されていない').toHaveBeenCalledWith(
		'c-1',
		`/${key}`,
		't-test',
	);
}

describe('子供の登録で仮アバターが自動で付く (#4413)', () => {
	it('AC1: /setup/children?/addChild (初期セットアップ)', async () => {
		const result = await setupAddChild(
			createEvent({ nickname: 'まさと', age: '7', theme: 'blue' }),
		);

		expect(result).toEqual({ success: true });
		expectPlaceholderAvatarAttached();
	});

	it('AC2: /admin/children?/addChild (後から追加)', async () => {
		const result = (await adminAddChild(
			createEvent({ nickname: 'まさと', age: '7', theme: 'blue' }),
		)) as { success: boolean; addedChild: { avatarUrl: string | null } };

		expect(result.success).toBe(true);
		expectPlaceholderAvatarAttached();

		// 追加直後に一覧へ返す child にも avatarUrl が載っている
		// (載っていないと画面上は 👤 のままで、再読込するまで反映されない)
		expect(result.addedChild.avatarUrl).toMatch(/^\/tenants\/t-test\/.*\.svg$/);
	});

	it('AC5: 仮アバターの保存に失敗しても子供の登録自体は成功する', async () => {
		mockSaveFile.mockRejectedValue(new Error('storage down'));

		const result = await setupAddChild(
			createEvent({ nickname: 'まさと', age: '7', theme: 'blue' }),
		);

		expect(result).toEqual({ success: true });
		expect(mockInsertChild).toHaveBeenCalledTimes(1);
		expect(mockUpdateChildAvatarUrl).not.toHaveBeenCalled();
	});
});
