// tests/unit/routes/admin-children-birthday-cleared-4729.test.ts
//
// PO 回答 (2026-09-03、PR #4729 コメント): 誕生日クリアの意味論 (「降格」) は維持する —
// 誕生日を消したら推定誕生日に戻り、誕生日ボーナスの対象外になる (間違った日に祝う方が体験を壊す)。
// ただし **顧客に降格が起きたことが見えること**。黙って降格は不可。
//
// 固定する不変条件:
//   [A] /admin/children の editChild action は「実誕生日があった子の誕生日欄を空にして保存した」
//       ときだけ `birthdayCleared: true` を返す (誕生日を入れ直した / 元から無い / 触っていない は false)
//   [B] 降格の保存契約 (`birthDate: null` を service に渡す) は変えていない (#4729 の決まった挙動)
//   [C] 画面は `birthdayCleared` を受け取ると、選択中のお子さまの詳細の直上に
//       「誕生日を消したため、誕生日のお祝いは行われません」を Alert (role="status") で出す
//
// route action は child-service を mock せず、repo だけ mock して実経路を通す
// (placeholder-avatar test と同型)。画面は +page.svelte を render し、action 結果 (form) → 表示 を見る。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_CHILDREN_PAGE_LABELS } from '$lib/domain/labels';

const mockFindChildById = vi.fn();
const mockUpdateChild = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: vi.fn(async () => []),
	findArchivedChildren: vi.fn(async () => []),
	findChildById: (...args: unknown[]) => mockFindChildById(...args),
	findChildByUserId: vi.fn(),
	insertChild: vi.fn(),
	updateChild: (...args: unknown[]) => mockUpdateChild(...args),
	deleteChild: vi.fn(),
}));

vi.mock('$lib/server/db/image-repo', () => ({
	findCachedImage: vi.fn(),
	findChildForImage: vi.fn(),
	insertCharacterImage: vi.fn(),
	updateChildAvatarUrl: vi.fn(),
	updateChildAvatarUrlIfMatches: vi.fn(async () => true),
}));

vi.mock('$lib/server/storage', () => ({
	saveFile: vi.fn(),
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

// --- 画面 (+page.svelte) が掴む SvelteKit runtime ---
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$lib/ui/primitives/Toast.svelte', () => ({ showToast: vi.fn(), default: () => {} }));

const route = await import('../../../src/routes/(parent)/admin/children/+page.server');
const ChildrenPage = (await import('../../../src/routes/(parent)/admin/children/+page.svelte'))
	.default;

const editChildAction = route.actions.editChild;
if (!editChildAction) {
	throw new Error('editChild action が見つからない (子供編集の action 名が変わった?)');
}

const CHILD_ID = 'c-1';

function existingChild(birthDate: string | null) {
	return {
		id: CHILD_ID,
		nickname: 'まさと',
		age: 7,
		theme: 'blue',
		uiMode: 'elementary',
		uiModeManuallySet: 0,
		avatarUrl: null,
		// 公開 entity の birthDate は実誕生日のときだけ非 null (推定値は null、`publicBirthDate`)
		birthDate,
	};
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

/** 誕生日欄を空にして保存したときのフォーム (age は画面が保持していた値をそのまま送る) */
function clearBirthdayForm() {
	return createEvent({
		childId: CHILD_ID,
		nickname: 'まさと',
		age: '7',
		theme: 'blue',
		birthDate: '',
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockUpdateChild.mockImplementation(async (_id: unknown, input: Record<string, unknown>) => ({
		...existingChild(null),
		...input,
	}));
});

afterEach(() => cleanup());

describe('#4729 [A] editChild action は降格が起きたときだけ birthdayCleared を返す', () => {
	it('実誕生日があった子の誕生日欄を空にして保存 → birthdayCleared: true', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild('2019-05-01'));

		const result = (await editChildAction(clearBirthdayForm())) as Record<string, unknown>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(true);
	});

	it('誕生日を入れ直した保存では出ない (降格ではない)', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild('2019-05-01'));

		const result = (await editChildAction(
			createEvent({
				childId: CHILD_ID,
				nickname: 'まさと',
				theme: 'blue',
				birthDate: '2019-06-15',
			}),
		)) as Record<string, unknown>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(false);
	});

	it('元から実誕生日が無い (推定誕生日だけの) 子の欄を空で保存しても出ない (降格は起きていない)', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(null));

		const result = (await editChildAction(clearBirthdayForm())) as Record<string, unknown>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(false);
	});

	it('誕生日欄を送らない編集 (年齢だけ) では出ない', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild('2019-05-01'));

		const result = (await editChildAction(createEvent({ childId: CHILD_ID, age: '8' }))) as Record<
			string,
			unknown
		>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(false);
	});
});

describe('#4729 [B] 降格の保存契約は変えていない', () => {
	it('誕生日欄を空にした保存は service に birthDate: null を渡す (月日の破棄ではなく推定扱いへの降格)', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild('2019-05-01'));

		await editChildAction(clearBirthdayForm());

		expect(mockUpdateChild).toHaveBeenCalledTimes(1);
		const [, input] = mockUpdateChild.mock.calls[0] as [unknown, Record<string, unknown>];
		expect(input.birthDate).toBeNull();
		// 年齢は画面が送った値を引き継ぐ (0 歳に戻さない、#4718)
		expect(input.age).toBe(7);
	});
});

describe('#4729 [C] 画面は降格が起きたことを保護者に見せる', () => {
	const pointSettings = { mode: 'point' as const, currency: 'JPY' as const, rate: 1 };
	const selectedChild = {
		id: CHILD_ID,
		nickname: 'まさと',
		age: 7,
		uiMode: 'elementary',
		theme: 'blue',
		avatarUrl: null,
		// 降格後の公開値 (推定扱い → null)
		birthDate: null,
		birthdayBonusMultiplier: 2,
		balance: { balance: 0 },
		status: null,
		recentLogs: [],
		logSummary: null,
		achievements: [],
		voices: [],
	};
	const data = {
		children: [
			{
				id: CHILD_ID,
				nickname: 'まさと',
				age: 7,
				uiMode: 'elementary',
				theme: 'blue',
				avatarUrl: null,
				balance: { balance: 0 },
			},
		],
		archivedChildren: [],
		selectedChild,
		childLimit: { allowed: true, current: 1, max: null },
		categoryDefs: [],
		archiveInfo: { hasArchived: false, retentionDays: null },
		pointSettings,
	};

	it('action が birthdayCleared を返すと、詳細カードの直上に Alert (role=status) で文言が出る', () => {
		render(ChildrenPage, {
			props: {
				data,
				form: { success: true, editedChildId: CHILD_ID, birthdayCleared: true },
				// biome-ignore lint/suspicious/noExplicitAny: PageData / ActionData の型は generated
			} as any,
		});

		const notice = screen.getByTestId('child-birthday-cleared-notice');
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.textContent).toContain(ADMIN_CHILDREN_PAGE_LABELS.birthdayClearedNotice);
		// PO 回答の文言そのもの (SSOT 経由)
		expect(ADMIN_CHILDREN_PAGE_LABELS.birthdayClearedNotice).toContain(
			'誕生日を消したため、誕生日のお祝いは行われません',
		);
		// 詳細カード (選択中のお子さま) の領域に出る = 編集した場所の近くで見える
		expect(notice.closest('[data-tutorial="child-detail"]')).not.toBeNull();
	});

	it('降格が起きていない結果 (birthdayCleared: false / action 無し) では出ない', () => {
		const { unmount } = render(ChildrenPage, {
			props: {
				data,
				form: { success: true, editedChildId: CHILD_ID, birthdayCleared: false },
				// biome-ignore lint/suspicious/noExplicitAny: PageData / ActionData の型は generated
			} as any,
		});
		expect(screen.queryByTestId('child-birthday-cleared-notice')).toBeNull();
		unmount();

		render(ChildrenPage, {
			// biome-ignore lint/suspicious/noExplicitAny: PageData / ActionData の型は generated
			props: { data, form: null } as any,
		});
		expect(screen.queryByTestId('child-birthday-cleared-notice')).toBeNull();
	});
});
