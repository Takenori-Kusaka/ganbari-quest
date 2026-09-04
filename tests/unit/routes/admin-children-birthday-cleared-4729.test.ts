// tests/unit/routes/admin-children-birthday-cleared-4729.test.ts
//
// PO 回答 (2026-09-03、PR #4729 コメント): 誕生日クリアの意味論 (「降格」) は維持する —
// 誕生日を消したら推定誕生日に戻り、誕生日ボーナスの対象外になる (間違った日に祝う方が体験を壊す)。
// ただし **顧客に降格が起きたことが見えること**。黙って降格は不可。
//
// **PO 決定 (2026-09-04、PR #4729 コメント)**: 「一度入れたら消せない」は仕様にしない。
// 誕生日は任意入力であり、訂正手段が「別の日付に直す」しかないのは説明と矛盾する
// (プライバシーポリシー第 5 / 6 条の削除・訂正請求とも整合しない)。`BirthdayInput` の未設定
// option を選べるようにして保護者が消せるようにし、**確認 → 保存 → Alert の 3 点セット**にする。
// 降格の意味論 (推定扱いに降格 = 誕生日ボーナス / 🎂 表示の対象外) は変えない。
// 消せるのは保護者の明示操作だけで、import 復元は今も `birthDate: null` を渡さない。
//
// 固定する不変条件:
//   [A] /admin/children の editChild action は「実誕生日があった子の誕生日欄を空にして保存した」
//       ときだけ `birthdayCleared: true` を返す (誕生日を入れ直した / 元から無い / 触っていない は false)
//   [B] 降格の保存契約 (`birthDate: null` を service に渡す) は変えていない (#4729 の決まった挙動)
//   [C] 画面は `birthdayCleared` を受け取ると、選択中のお子さまの詳細の直上に
//       「誕生日を消したため、誕生日のお祝いは行われません」を Alert (role="status") で出す
//   [D] 誕生日を消す保存は確認ダイアログを挟み、**キャンセルすると消えない** (action を実行しない)
//   [E] 消したあとのカードに「誕生日: 未設定」が出て、年齢は引き継がれ、推定誕生日 (1/1) は出ない
//
// route action は child-service を mock せず、repo だけ mock して実経路を通す
// (placeholder-avatar test と同型)。画面は +page.svelte を render し、action 結果 (form) → 表示 を見る。

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_CHILDREN_PAGE_LABELS, CHILD_PROFILE_CARD_LABELS } from '$lib/domain/labels';

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
//
// [D] は「保存を押したら action が実行されるか / 確認で止まるか」を見るため、`enhance` を
// no-op ではなく **submit を実際に捕まえる薄い実装**にする (fetch はせず、submit callback を呼ぶ
// ところまで再現する)。`cancel()` が呼ばれた submit = action が実行されなかった、と読める。
const { submitAttempts } = vi.hoisted(() => ({
	submitAttempts: [] as Array<{ action: string; birthDate: string | null; canceled: boolean }>,
}));

vi.mock('$app/forms', () => ({
	enhance: (formElement: HTMLFormElement, submitFn?: (arg: Record<string, unknown>) => unknown) => {
		const onSubmit = (event: Event) => {
			event.preventDefault();
			const formData = new FormData(formElement);
			const attempt = {
				action: formElement.getAttribute('action') ?? '',
				birthDate: (formData.get('birthDate') as string | null) ?? null,
				canceled: false,
			};
			submitAttempts.push(attempt);
			submitFn?.({
				formElement,
				formData,
				action: new URL('http://localhost/admin/children'),
				controller: new AbortController(),
				submitter: null,
				cancel: () => {
					attempt.canceled = true;
				},
			});
		};
		formElement.addEventListener('submit', onSubmit);
		return { destroy: () => formElement.removeEventListener('submit', onSubmit) };
	},
}));
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
	submitAttempts.length = 0;
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

describe('#4729 [D]/[E] 保護者は誕生日を消せる (確認 → 保存 → 告知)', () => {
	const pointSettings = { mode: 'point' as const, currency: 'JPY' as const, rate: 1 };

	/** `birthDate` は publicBirthDate (実誕生日のみ)。null = 推定扱い (= 消したあと) */
	function pageData(birthDate: string | null) {
		const base = {
			id: CHILD_ID,
			nickname: 'まさと',
			age: 7,
			uiMode: 'elementary',
			theme: 'blue',
			avatarUrl: null,
			balance: { balance: 0 },
		};
		return {
			children: [base],
			archivedChildren: [],
			selectedChild: {
				...base,
				birthDate,
				birthdayBonusMultiplier: 2,
				status: null,
				recentLogs: [],
				logSummary: null,
				achievements: [],
				voices: [],
			},
			childLimit: { allowed: true, current: 1, max: null },
			categoryDefs: [],
			archiveInfo: { hasArchived: false, retentionDays: null },
			pointSettings,
		};
	}

	function renderPage(birthDate: string | null) {
		return render(ChildrenPage, {
			// biome-ignore lint/suspicious/noExplicitAny: PageData / ActionData の型は generated
			props: { data: pageData(birthDate), form: null } as any,
		});
	}

	// Ark UI Dialog の content は閉じていても Portal 内に `hidden` + `data-state="closed"` で
	// 残る (かつ Portal は document.body 直下なので testing-library の cleanup で消えない)。
	// 「出ている確認ダイアログ」だけを見るため open 状態で絞る。
	function openConfirmDialog(): HTMLElement | null {
		const nodes = Array.from(
			document.querySelectorAll<HTMLElement>('[data-testid="child-birthday-clear-confirm-dialog"]'),
		);
		return nodes.find((n) => n.getAttribute('data-state') === 'open') ?? null;
	}

	async function findOpenConfirmDialog(): Promise<HTMLElement> {
		let dialog: HTMLElement | null = null;
		await waitFor(() => {
			dialog = openConfirmDialog();
			expect(dialog).not.toBeNull();
		});
		return dialog as unknown as HTMLElement;
	}

	/** 編集モードに入り、誕生日欄を未設定に戻して「保存」を押す */
	async function clearBirthdayAndSave() {
		await fireEvent.click(screen.getByText(CHILD_PROFILE_CARD_LABELS.editButton));
		// 年を未設定に戻す → 月 / 日も連動して空になる (BirthdayInput、#4729)
		await fireEvent.change(screen.getByLabelText('生まれた年'), { target: { value: '' } });
		await fireEvent.click(screen.getByText(CHILD_PROFILE_CARD_LABELS.saveButton));
	}

	it('誕生日を消して保存すると確認ダイアログが出て、その時点では保存されない', async () => {
		renderPage('2019-05-01');

		await clearBirthdayAndSave();

		const dialog = await findOpenConfirmDialog();
		expect(dialog.textContent).toContain(CHILD_PROFILE_CARD_LABELS.birthdayClearConfirmBody);
		// お祝いが行われなくなることを保存前に伝えている (PO 指定)
		expect(CHILD_PROFILE_CARD_LABELS.birthdayClearConfirmBody).toContain(
			'誕生日のお祝いが行われなくなります',
		);
		// submit は捕まえたが action は実行していない (cancel 済)
		expect(submitAttempts).toHaveLength(1);
		expect(submitAttempts[0]).toMatchObject({ action: '?/editChild', canceled: true });
	});

	it('確認をキャンセルすると誕生日は消えない (action を実行しない)', async () => {
		renderPage('2019-05-01');
		await clearBirthdayAndSave();
		const dialog = await findOpenConfirmDialog();

		await fireEvent.click(within(dialog).getByTestId('child-birthday-clear-cancel'));

		await waitFor(() => expect(openConfirmDialog()).toBeNull());
		// 追加の submit は起きず、最初の submit も cancel されたまま = 保存されていない
		expect(submitAttempts).toHaveLength(1);
		expect(submitAttempts[0]?.canceled).toBe(true);
	});

	it('確認すると誕生日を空 (birthDate="") にして editChild が実行される', async () => {
		renderPage('2019-05-01');
		await clearBirthdayAndSave();
		const dialog = await findOpenConfirmDialog();

		await fireEvent.click(within(dialog).getByTestId('child-birthday-clear-accept'));

		expect(submitAttempts).toHaveLength(2);
		expect(submitAttempts[1]).toMatchObject({
			action: '?/editChild',
			birthDate: '',
			canceled: false,
		});
	});

	it('誕生日以外の編集 (誕生日を触らない保存) は確認を挟まずそのまま保存する', async () => {
		renderPage('2019-05-01');

		await fireEvent.click(screen.getByText(CHILD_PROFILE_CARD_LABELS.editButton));
		await fireEvent.click(screen.getByText(CHILD_PROFILE_CARD_LABELS.saveButton));

		expect(openConfirmDialog()).toBeNull();
		expect(submitAttempts).toHaveLength(1);
		expect(submitAttempts[0]).toMatchObject({ birthDate: '2019-05-01', canceled: false });
	});

	it('消したあとのカードは「誕生日: 未設定」を出し、年齢を引き継ぎ、推定誕生日 (1/1) を見せない', () => {
		const { container } = renderPage(null);

		const unset = screen.getByTestId('child-birthday-unset');
		expect(unset.textContent).toContain(CHILD_PROFILE_CARD_LABELS.headerBirthdayUnset);
		expect(CHILD_PROFILE_CARD_LABELS.headerBirthdayUnset).toContain('未設定');
		// 🎂 + 日付の表示には切り替わらない
		expect(screen.queryByTestId('child-birthday-value')).toBeNull();

		// 年齢は引き継がれている (0 歳に戻らない、#4718 / #4729)
		const meta = container.querySelector('.profile-header__meta');
		expect(meta?.textContent).toContain('7');

		// 推定誕生日 (1 月 1 日) は内部値なので画面に出ない (DESIGN.md §6 内部コード露出禁止)
		const shown = document.body.textContent ?? '';
		expect(shown).not.toContain('-01-01');
		expect(shown).not.toContain('1月1日');
	});
});
