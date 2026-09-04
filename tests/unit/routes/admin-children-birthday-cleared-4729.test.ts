// tests/unit/routes/admin-children-birthday-cleared-4729.test.ts
//
// **PO 決定 (2026-09-04、PR #4729 コメント)**: 「一度入れたら消せない」は仕様にしない。
// 誕生日は任意入力であり、訂正手段が「別の日付に直す」しかないのは説明と矛盾する
// (プライバシーポリシー第 5 / 6 条の削除・訂正請求とも整合しない)。`BirthdayInput` の未設定
// option を選べるようにして保護者が消せるようにし、**確認 → 保存 → Alert の 3 点セット**にする。
// 消せるのは保護者の明示操作だけで、import 復元は今も `birthDate: null` を渡さない。
//
// **消したときに保存値がどうなるか (実測)**。以前この位置には「消しても月日は DB に残る」と
// 書かれていたが誤りだった (顧客が通らない分岐の説明を、通る経路の説明として書いていた):
// 編集フォームは年齢欄を `readonly` で常に送るため、action は `birthDate: null` + `age` を渡す。
// `resolveBirthDateForUpdate` はその形を受けると **その年齢の推定誕生日 (1/1) で保存値を置き換える**
// ので、実誕生日の月日は残らない。「保存値が残る」非破壊分岐は `age` が来ないときだけの経路で、
// 顧客はそこを通らない。誤操作の出口は保存前の確認ダイアログが引き受ける (PO 決定が条件として明記)。
//
// 固定する不変条件:
//   [A] /admin/children の editChild action は「実誕生日があった子の誕生日欄を空にして保存した」
//       ときだけ `birthdayCleared: true` を返す (誕生日を入れ直した / 元から無い / 触っていない は false)
//   [B] 消した保存で DB に何が書かれるか — service に渡る input と、それを実際の書き込み変換に
//       通した結果 (実誕生日は破棄され 1/1 に置換 / 年齢は保たれる / 1/1 は公開 entity に出ない)
//   [C] 画面は `birthdayCleared` を受け取ると、選択中のお子さまの詳細の直上に
//       「誕生日を消したため、誕生日のお祝いは行われません」を Alert (role="status") で出す
//   [D] 誕生日を消す保存は確認ダイアログを挟み、**キャンセルすると消えない** (action を実行しない)
//   [E] 消したあとのカードに「誕生日: 未設定」が出て、年齢は引き継がれ、推定誕生日 (1/1) は出ない
//   [F] 消したあとの状態は「年齢だけで登録した子供」と**同一**である (保存値 / 年齢の導出 /
//       年齢帯の解決 / publicBirthDate)。加齢が毎年 1/1 に起きるのは消したことで生まれた挙動
//       ではなく、年齢のみ登録の子供がもともと持っている挙動 (#4718 の推定誕生日規約)
//
// route action は child-service を mock せず、repo だけ mock して実経路を通す
// (placeholder-avatar test と同型)。画面は +page.svelte を render し、action 結果 (form) → 表示 を見る。

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	deriveChildAge,
	publicBirthDate,
	resolveBirthDateForInsert,
	resolveBirthDateForUpdate,
} from '$lib/domain/child-age';
import { ADMIN_CHILDREN_PAGE_LABELS, CHILD_PROFILE_CARD_LABELS } from '$lib/domain/labels';
import { getDefaultUiMode, recalcUiMode } from '$lib/domain/validation/age-tier';

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

/** 保存値の検証を暦に依存させないための固定日 (JST SSOT、#4015)。7 歳 -> 推定 2019-01-01 */
const TODAY_JST = '2026-09-04';
/** 変更前の行が持つ実誕生日。`existingChild()` と書き込み変換の `current` を同じ値から導く */
const EXISTING_BIRTH_DATE = '2019-05-01';
const STORED_ROW_BEFORE_CLEAR = {
	birthDate: EXISTING_BIRTH_DATE,
	birthDateEstimated: false,
} as const;

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

describe('#4729 [A] editChild action は誕生日が消えたときだけ birthdayCleared を返す', () => {
	it('実誕生日があった子の誕生日欄を空にして保存 → birthdayCleared: true', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));

		const result = (await editChildAction(clearBirthdayForm())) as Record<string, unknown>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(true);
	});

	it('誕生日を入れ直した保存では出ない (消えていない)', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));

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

	it('元から実誕生日が無い (推定誕生日だけの) 子の欄を空で保存しても出ない (消えるものが無い)', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(null));

		const result = (await editChildAction(clearBirthdayForm())) as Record<string, unknown>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(false);
	});

	it('誕生日欄を送らない編集 (年齢だけ) では出ない', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));

		const result = (await editChildAction(createEvent({ childId: CHILD_ID, age: '8' }))) as Record<
			string,
			unknown
		>;

		expect(result.success).toBe(true);
		expect(result.birthdayCleared).toBe(false);
	});
});

describe('#4729 [B] 誕生日を消した保存で DB に何が書かれるか', () => {
	it('service には birthDate: null と画面が送った年齢が渡る', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));

		await editChildAction(clearBirthdayForm());

		expect(mockUpdateChild).toHaveBeenCalledTimes(1);
		const [, input] = mockUpdateChild.mock.calls[0] as [unknown, Record<string, unknown>];
		expect(input.birthDate).toBeNull();
		// 年齢は画面が送った値を引き継ぐ (0 歳に戻さない、#4718)
		expect(input.age).toBe(7);
	});

	// action が repo に渡した input を **実際の書き込み変換** (`resolveBirthDateForUpdate`、
	// sqlite / dsql 両 repo の唯一の書き込み規約) に通して、保存値がどうなるかまで固定する。
	// 上の test は mock された repo の引数までしか見ておらず、その 1 層下で起きることを
	// 一度も検証していなかった (adversarial review must 1)。
	it('実誕生日は破棄され、その年齢の推定誕生日 (1/1) に置き換わる', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));

		await editChildAction(clearBirthdayForm());
		const [, input] = mockUpdateChild.mock.calls[0] as [unknown, Record<string, unknown>];

		const written = resolveBirthDateForUpdate(
			input as { age?: number; birthDate?: string | null },
			STORED_ROW_BEFORE_CLEAR,
			TODAY_JST,
		);

		// 月日 (05-01) は DB に残らない — 消したあとから元の誕生日は復元できない。
		// 誤操作の出口は「保存前の確認ダイアログ」が引き受けている (PO 決定 2026-09-04)。
		expect(written.birthDate).toBe('2019-01-01');
		expect(written.birthDateEstimated).toBe(true);
		expect(written.birthDate).not.toBe(EXISTING_BIRTH_DATE);
	});

	it('置き換わった保存値でも年齢は保たれ、1/1 は顧客に出ない', async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));

		await editChildAction(clearBirthdayForm());
		const [, input] = mockUpdateChild.mock.calls[0] as [unknown, Record<string, unknown>];
		const written = resolveBirthDateForUpdate(
			input as { age?: number; birthDate?: string | null },
			STORED_ROW_BEFORE_CLEAR,
			TODAY_JST,
		);
		const row = {
			birthDate: written.birthDate ?? null,
			birthDateEstimated: written.birthDateEstimated ?? false,
		};

		// 年齢は保存値から導出しても 7 のまま (0 歳に戻らない、#4718)
		expect(deriveChildAge(row, TODAY_JST)).toBe(7);
		// 公開 entity は null = カード / export / 誕生日ボーナスのどこにも 1/1 が出ない
		// (DESIGN.md §6 内部コード露出禁止)
		expect(publicBirthDate(row)).toBeNull();
	});
});

describe('#4729 [C] 画面は誕生日が消えたことを保護者に見せる', () => {
	const pointSettings = { mode: 'point' as const, currency: 'JPY' as const, rate: 1 };
	const selectedChild = {
		id: CHILD_ID,
		nickname: 'まさと',
		age: 7,
		uiMode: 'elementary',
		theme: 'blue',
		avatarUrl: null,
		// 消したあとの公開値 (推定扱いになるので null)
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

	it('誕生日が消えていない結果 (birthdayCleared: false / action 無し) では出ない', () => {
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
		// 実装の事実 (保存で入力された誕生日が破棄され、取り消し操作が無い) を保存前に明言している。
		// ここが「入れ直せば戻る」だけの文面に緩むと、不可逆操作を可逆だと誤解させる。
		// 保存後の Alert と**同じ 2 点** (日付は消える / 入れ直せば再開する) を述べ、
		// 保存前と保存後で言うことが食い違わないようにする。
		expect(CHILD_PROFILE_CARD_LABELS.birthdayClearConfirmBody).toContain('アプリから消え');
		expect(CHILD_PROFILE_CARD_LABELS.birthdayClearConfirmBody).toContain(
			'取り消す操作はありません',
		);
		expect(CHILD_PROFILE_CARD_LABELS.birthdayClearConfirmBody).toContain('もう一度誕生日を入れて');
		expect(ADMIN_CHILDREN_PAGE_LABELS.birthdayClearedNotice).toContain('アプリに残っていません');
		expect(ADMIN_CHILDREN_PAGE_LABELS.birthdayClearedNotice).toContain('お祝いを再開します');
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

describe('#4729 [F] 消したあとは「年齢だけで登録した子供」と同一状態に収束する', () => {
	// QM 判断 (2026-09-04): 誕生日を消す操作は、その子を **「年齢だけで登録した子供」と同じ状態に戻す**
	// 操作である。消したあと加齢が毎年 1/1 に起きる (= 実誕生日より最大 1 年弱早く年齢帯が上がりうる)
	// のは本 PR が持ち込んだ挙動ではなく、年齢のみ登録の子供がもともと持っている挙動
	// (#4718 の推定誕生日規約: 誕生日が入力されなければ「今年 − 年齢」年の 1/1 を保存する)。
	//
	// **その等価性が成り立つ限りにおいてのみ**「既存挙動への収束」と言える。崩れたらそれは本 PR 固有の
	// 欠陥なので、4 つの面すべてで同一であることを機械的に固定する。
	//
	// (A) 年齢だけで登録した子供 = `resolveBirthDateForInsert({ age })` (insertChild が呼ぶ規約)
	// (B) 誕生日を消した子供 = action が渡した input を `resolveBirthDateForUpdate` に通した結果

	const AGE = 7;

	/** (A) 年齢だけで登録した子供の保存値 */
	const ageOnly = resolveBirthDateForInsert({ age: AGE }, TODAY_JST);

	/** (B) 実誕生日を持つ子の誕生日を消した保存値 (顧客が通る実経路を action ごと通す) */
	const clearedByParent = async () => {
		mockFindChildById.mockResolvedValueOnce(existingChild(EXISTING_BIRTH_DATE));
		await editChildAction(clearBirthdayForm());
		const [, input] = mockUpdateChild.mock.calls[0] as [unknown, Record<string, unknown>];
		const written = resolveBirthDateForUpdate(
			input as { age?: number; birthDate?: string | null },
			STORED_ROW_BEFORE_CLEAR,
			TODAY_JST,
		);
		return {
			input,
			row: {
				birthDate: written.birthDate ?? STORED_ROW_BEFORE_CLEAR.birthDate,
				birthDateEstimated:
					written.birthDateEstimated ?? STORED_ROW_BEFORE_CLEAR.birthDateEstimated,
			},
		};
	};

	it('保存値 (birth_date / birth_date_estimated) が一致する', async () => {
		const { row } = await clearedByParent();

		expect(row).toEqual({
			birthDate: ageOnly.birthDate,
			birthDateEstimated: ageOnly.birthDateEstimated,
		});
		// 念のため中身も固定 (7 歳 → 2019-01-01 / 推定扱い)
		expect(row.birthDate).toBe('2019-01-01');
		expect(row.birthDateEstimated).toBe(true);
	});

	// 「消したことで加齢が早まる」という懸念の本体。**両者が同じタイミングで同じ年齢になる**
	// ことを暦をまたいで比べる。実誕生日 (05-01) をまたぐ前後も含める。
	it.each([
		['消した当日', '2026-09-04'],
		['年末', '2026-12-31'],
		['年明け (1/1 で加齢)', '2027-01-01'],
		['実誕生日の前日', '2027-04-30'],
		['実誕生日', '2027-05-01'],
		['さらに翌年', '2028-01-01'],
	])('年齢の導出が一致する — %s', async (_name, today) => {
		const { row } = await clearedByParent();

		expect(deriveChildAge(row, today)).toBe(deriveChildAge(ageOnly, today));
	});

	it.each([
		['消した当日', '2026-09-04'],
		['年明け (1/1 で加齢)', '2027-01-01'],
		['3 年後 (年齢帯をまたぐ)', '2031-01-01'],
		['7 年後 (さらに年齢帯をまたぐ)', '2035-01-01'],
	])('年齢帯の解決が一致する (uiModeManuallySet=0) — %s', async (_name, today) => {
		const { row } = await clearedByParent();

		const clearedTier = recalcUiMode(
			{ uiMode: 'elementary', uiModeManuallySet: 0 },
			deriveChildAge(row, today),
		);
		const ageOnlyTier = recalcUiMode(
			{ uiMode: 'elementary', uiModeManuallySet: 0 },
			deriveChildAge(ageOnly, today),
		);

		expect(clearedTier).toBe(ageOnlyTier);
	});

	it('手動で年齢帯を固定している子は、どちらの経路でも固定が保たれる', async () => {
		const { row } = await clearedByParent();
		const pinned = { uiMode: 'junior' as const, uiModeManuallySet: 1 };

		expect(recalcUiMode(pinned, deriveChildAge(row, '2031-01-01'))).toBe('junior');
		expect(recalcUiMode(pinned, deriveChildAge(ageOnly, '2031-01-01'))).toBe('junior');
	});

	it('action が service に渡す uiMode は、年齢だけで登録したときの既定と同じ', async () => {
		const { input } = await clearedByParent();

		// insertChild は `input.uiMode ?? getDefaultUiMode(input.age)` を書く。
		// 消す保存では child-service が recalcUiMode で同じ値に落ち着く (手動固定していない子)。
		expect(input.uiMode ?? getDefaultUiMode(AGE)).toBe(getDefaultUiMode(AGE));
		expect(getDefaultUiMode(AGE)).toBe('elementary');
	});

	it('publicBirthDate はどちらも null (1/1 を顧客に見せない / 誕生日ボーナスの対象外)', async () => {
		const { row } = await clearedByParent();

		expect(publicBirthDate(row)).toBeNull();
		expect(publicBirthDate(ageOnly)).toBeNull();
	});

	// export / backup も顧客が見る面なので、そこに落ちる射影が一致することまで見る
	// (`export-service.ts` の ExportChild は birthDate = publicBirthDate / age = deriveChildAge /
	// uiMode / uiModeManuallySet を持ち、誕生日ボーナスの内部列は持たない)。
	//
	// **残差 (等価でない列)**: `lastBirthdayBonusYear` / `birthdayBonusMultiplier` は消しても
	// 消えないので、年齢だけで登録した子供 (どちらも初期値) とは行の中身が違う。ただし
	//   - export には出ない (上記のとおり ExportChild に含まれない)
	//   - 消している間は読めない (`getBirthdayBonusStatus` が publicBirthDate=null で NO_BIRTHDATE)
	//   - 誕生日を入れ直した後に初めて効くが、そのとき「同じ年のボーナスを二重に受け取らせない」
	//     という**正しい**方向に効く (消さずに入れ直した場合と同じ)
	// ので顧客に見える差にはならない。ここでは観測可能な面の一致だけを固定する。
	it('export に落ちる射影が一致する (birthDate / age / 年齢帯 / 手動フラグ)', async () => {
		const { row } = await clearedByParent();
		const today = '2027-06-15';

		const projection = (r: { birthDate: string; birthDateEstimated: boolean }) => ({
			birthDate: publicBirthDate(r),
			age: deriveChildAge(r, today),
			uiMode: recalcUiMode(
				{ uiMode: 'elementary', uiModeManuallySet: 0 },
				deriveChildAge(r, today),
			),
			uiModeManuallySet: 0,
		});

		expect(projection(row)).toEqual(projection(ageOnly));
	});
});
