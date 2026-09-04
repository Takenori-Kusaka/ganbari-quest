// tests/unit/routes/settings-data-import-ux-states.test.ts
// #3749 (#3324 follow-up): import UX の条件付き UI 3 状態 + cloud import timeout の
// レンダリング証跡テスト。
//
// PR #3674 が追加した 3 つ (+1) の条件付き UI 要素は demo fixture の既定で全て非表示に
// なるため、SS にもテストにも DOM レンダリング証跡が無かった (QM Tier2 V-2/V-4 指摘):
//   1. cloud export status spinner (cloud export が pending/building の間のみ表示)
//   2. partial-backup 警告 (not-yet-exported baseline が非空のときのみ表示)
//   3. サイズ超過エラー / timeout エラー (ファイル未選択・正常応答では非表示)
//   4. cloud import 経路の timeout エラー (postCloudImport の isAbortError 分岐)
//
// 基盤ロジックは import-limit / import-size-limit 等の unit test で担保済だが、条件付き
// UI の spinner / role=status 警告 / エラー文言を「mount して assert」するテストが 0 件
// だった。本 test は各状態を @testing-library/svelte で mount し、
// tests/CLAUDE.md「interactive flow は操作 → 結果を必須検証 (render-only 禁止)」に従い
// act (ファイル選択 / PIN 入力 / cloud export fetch) → 結果 DOM を assert する。
// cloud export/import の一部は #3732 で local 検証困難 (auth repo / uuid 制約) のため、
// fetch を stub して条件付き UI の描画契約を component 層で検証する (二重防御の component 側)。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));

// $app/stores の page store を最小 store contract (subscribe + set) で mock する。
// component は `$page.data.authMode === 'cognito'` のみ参照するため、test ごとに
// authMode を set して cloud セクションの表示 / 非表示を切り替える。
const { pageStore } = vi.hoisted(() => {
	let value: { data: { authMode: string } } = { data: { authMode: 'local' } };
	const subs = new Set<(v: typeof value) => void>();
	return {
		pageStore: {
			subscribe(fn: (v: typeof value) => void) {
				subs.add(fn);
				fn(value);
				return () => subs.delete(fn);
			},
			set(v: typeof value) {
				value = v;
				for (const fn of subs) fn(value);
			},
		},
	};
});
vi.mock('$app/stores', () => ({ page: pageStore }));

// #4767 QM should: 削除完了の 2 層フィードバックのうち Toast 側を観測するための seam。
// Toast primitive は module-level $state を持つ .svelte で、page 側の import (alias) と
// test 側の import (相対) が別 instance になり DOM に出ない。showToast が **必ず** 通る
// `$lib/ui/toast-stack` (純 ts) を mock すると、呼び出し元が .svelte でも確実に観測できる。
const { reconcileToastStackSpy } = vi.hoisted(() => ({
	reconcileToastStackSpy: vi.fn((_stack: unknown, item: unknown) => [item]),
}));
vi.mock('$lib/ui/toast-stack', () => ({ reconcileToastStack: reconcileToastStackSpy }));

import type { Component } from 'svelte';
import { IMPORT_LABELS, SETTINGS_LABELS } from '../../../src/lib/domain/labels';
import DataPageRaw from '../../../src/routes/(parent)/admin/settings/data/+page.svelte';

type DataProps = {
	dataSummary: null;
	canExport: boolean;
	maxCloudExports: number;
	children: Array<{ id: string; nickname: string; age: number }>;
	maxImportBytes: number;
	notYetExportedLabels: string[];
};

// PageData には layout 由来 field が merge されるが、本 page component は上記 field と
// $page.data.authMode しか参照しないため、test では page 固有 load 分のみ渡す。
const DataPage = DataPageRaw as unknown as Component<{ data: DataProps; form: null }>;

function makeData(overrides: Partial<DataProps> = {}): DataProps {
	return {
		dataSummary: null,
		canExport: true,
		maxCloudExports: 0,
		children: [],
		maxImportBytes: 10 * 1024 * 1024,
		notYetExportedLabels: [],
		...overrides,
	};
}

/** File 選択を模す (`input.files` を set して change を発火)。 */
async function selectImportFile(container: HTMLElement, file: File) {
	const input = container.querySelector<HTMLInputElement>('[data-testid="import-file-input"]');
	if (!input) throw new Error('import-file-input が見つかりません');
	await fireEvent.change(input, { target: { files: [file] } });
}

describe('/admin/settings/data — import UX 条件付き UI レンダリング証跡 (#3749)', () => {
	beforeEach(() => {
		pageStore.set({ data: { authMode: 'local' } });
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// ── 状態 2: partial-backup 警告 (registry 駆動、data.notYetExportedLabels 由来) ──
	describe('partial-backup 警告 (#3372)', () => {
		it('notYetExportedLabels が非空のとき role=status の警告が対象名付きで表示される', () => {
			const { getByTestId } = render(DataPage, {
				data: makeData({ notYetExportedLabels: ['応援メッセージ', '通知設定'] }),
				form: null,
			});
			const warning = getByTestId('import-partial-backup-warning');
			expect(warning.getAttribute('role')).toBe('status');
			expect(warning.textContent).toContain('応援メッセージ、通知設定');
			expect(warning.textContent).toContain(
				SETTINGS_LABELS.dataImportPartialBackupWarning('応援メッセージ、通知設定'),
			);
		});

		it('notYetExportedLabels が空のときは警告を出さない (誤警告なし)', () => {
			const { queryByTestId } = render(DataPage, {
				data: makeData({ notYetExportedLabels: [] }),
				form: null,
			});
			expect(queryByTestId('import-partial-backup-warning')).toBeNull();
		});
	});

	// ── 状態 3a: サイズ超過エラー (実効上限 maxImportBytes 超過を送信前に弾く) ──
	describe('サイズ超過エラー (#3325 AC3)', () => {
		it('maxImportBytes を超える JSON 選択でクラウド導線案内付きエラーを表示しファイルを解除する', async () => {
			const { container, findByText, queryByTestId } = render(DataPage, {
				// 実効上限を 8 byte に絞る → それを超える JSON でクラウド共有経由の案内が出る
				data: makeData({ maxImportBytes: 8 }),
				form: null,
			});
			// 8 byte 超の valid JSON (`{"a":123456}` = 12 byte)
			const file = new File(['{"a":123456}'], 'backup.json', { type: 'application/json' });
			await selectImportFile(container, file);

			// errorFileTooLargeCloudGuide(0) が ErrorAlert 経由で描画される
			// (maxBytes 8byte → round(8/1MB*10)/10 = 0MB)
			await findByText(IMPORT_LABELS.errorFileTooLargeCloudGuide(0));
			// 送信前に弾かれ、preview / file-input select ステップに留まる (importStep=select)
			expect(queryByTestId('import-preview-summary')).toBeNull();
			expect(container.querySelector('[data-testid="import-file-input"]')).not.toBeNull();
		});
	});

	// ── 状態 3b: import timeout エラー (AbortController 発火 → 明示 timeout 文言) ──
	describe('import timeout エラー (#3324, 直接 import 経路)', () => {
		it('preview fetch が AbortError で中断したとき timeout 文言を表示する', async () => {
			// postImport の fetch を AbortError で reject させ isAbortError 分岐へ入れる
			vi.stubGlobal(
				'fetch',
				vi.fn(() => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))),
			);
			const { container, findByText } = render(DataPage, {
				data: makeData({ maxImportBytes: 10 * 1024 * 1024 }),
				form: null,
			});
			// size 内の valid JSON → postImport('preview') に到達 → fetch abort
			const file = new File(['{}'], 'backup.json', { type: 'application/json' });
			await selectImportFile(container, file);

			await findByText(SETTINGS_LABELS.dataImportTimeoutError);
		});
	});

	// ── 状態 1: cloud export status spinner (pending/building 中のみ role=status で表示) ──
	describe('cloud export status spinner (#3324 / #3509)', () => {
		it('cognito + building 状態の export で spinner (role=status) と生成中文言を描画する', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			// $effect の loadCloudExports が叩く GET /api/v1/export/cloud を stub
			vi.stubGlobal(
				'fetch',
				vi.fn((url: string) => {
					if (typeof url === 'string' && url.includes('/api/v1/export/cloud')) {
						return Promise.resolve({
							ok: true,
							json: () =>
								Promise.resolve({
									exports: [
										{
											id: 'exp-building',
											exportType: 'template',
											pinCode: 'ABC123',
											expiresAt: '2026-08-01T00:00:00Z',
											fileSizeBytes: 1024,
											description: null,
											downloadCount: 0,
											maxDownloads: 5,
											createdAt: '2026-07-16T00:00:00Z',
											status: 'building',
											failureReason: null,
											// #4767: server が付ける行の表示状態 / 自動削除までの残日数
											rowState: 'building',
											daysUntilAutoDelete: 5,
										},
									],
								}),
						} as Response);
					}
					return Promise.reject(new Error(`unexpected fetch: ${url}`));
				}),
			);

			const { findByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			const status = await findByTestId('cloud-export-status-exp-building');
			expect(status.getAttribute('role')).toBe('status');
			expect(status.textContent).toContain(SETTINGS_LABELS.cloudStatusBuilding);
			// spinner (animate-spin) が併置される
			expect(status.querySelector('.animate-spin')).not.toBeNull();
		});
	});

	// ── #4767 PO 回答 #3: 枠を占有している行 (DL 使い切り / 失敗) が一覧に出て削除できる ──
	describe('cloud export 保管枠の可視化と削除 (#4767)', () => {
		/** GET /api/v1/export/cloud を任意の行で解決し、DELETE の呼び出しを記録する stub。 */
		function stubCloudFetch(rows: unknown[]) {
			const deleted: string[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn((url: string, init?: RequestInit) => {
					if (typeof url === 'string' && url.includes('/api/v1/export/cloud')) {
						if (init?.method === 'DELETE') {
							deleted.push(url.split('/').pop() ?? '');
							return Promise.resolve({
								ok: true,
								json: () => Promise.resolve({ ok: true }),
							} as Response);
						}
						return Promise.resolve({
							ok: true,
							json: () => Promise.resolve({ exports: rows }),
						} as Response);
					}
					return Promise.reject(new Error(`unexpected fetch: ${url}`));
				}),
			);
			return deleted;
		}

		const exhaustedRow = {
			id: 'exp-exhausted',
			exportType: 'template',
			pinCode: 'ABC234',
			expiresAt: '2026-09-10T00:00:00Z',
			fileSizeBytes: 1024,
			description: null,
			downloadCount: 5,
			maxDownloads: 5,
			createdAt: '2026-09-01T00:00:00Z',
			status: 'ready',
			failureReason: null,
			rowState: 'exhausted',
			daysUntilAutoDelete: 7,
		};

		it('DL 回数を使い切った行も一覧に出て、状態と自動削除までの日数が読める', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			stubCloudFetch([exhaustedRow]);

			const { findByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			const status = await findByTestId('cloud-export-status-exp-exhausted');
			expect(status.getAttribute('role')).toBe('status');
			expect(status.textContent).toContain(SETTINGS_LABELS.cloudRowStateExhausted);
			const row = await findByTestId('cloud-export-row-exp-exhausted');
			expect(row.textContent).toContain(SETTINGS_LABELS.cloudAutoDeleteIn(7));
			// #4767 QM should: 期限 (絶対日付) と DL 回数は状態によらず消えない
			expect(row.textContent).toContain(SETTINGS_LABELS.cloudStoredExpiry('2026/09/10'));
			expect(row.textContent).toContain(SETTINGS_LABELS.cloudStoredDownloads(5, 5));
			// もう取り出せないので DL 導線は出さない (押しても失敗する導線を残さない)
			expect(row.querySelector('[data-testid="cloud-export-download-link"]')).toBeNull();
		});

		// #4767 QM must: 削除は S3 の全バージョンを消す取り消せない操作。押しただけでは実行されず、
		// 確認 dialog で「何が消えるか」「元に戻せない」ことを見せてから確定で初めて DELETE が飛ぶ。
		it('削除を押しただけでは DELETE を送らず、何が消えるかと元に戻せないことを確認 dialog で示す', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			const deleted = stubCloudFetch([exhaustedRow]);

			const { findByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			await fireEvent.click(await findByTestId('cloud-export-delete-exp-exhausted'));

			// Dialog は Portal 経由で body に出るため screen (document 起点) で引く
			const target = await screen.findByTestId('cloud-export-delete-confirm-target');
			expect(target.textContent).toContain('ABC234');
			expect(target.textContent).toContain(SETTINGS_LABELS.cloudRowStateExhausted);
			expect(document.body.textContent).toContain(SETTINGS_LABELS.cloudDeleteConfirmIrreversible);
			// この時点では何も消えていない
			expect(deleted).toEqual([]);
		});

		it('確認 dialog をキャンセルすると削除されない (取り消せない操作を誤爆させない)', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			const deleted = stubCloudFetch([exhaustedRow]);

			const { findByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			await fireEvent.click(await findByTestId('cloud-export-delete-exp-exhausted'));
			await fireEvent.click(await screen.findByTestId('cloud-export-delete-cancel'));

			// dialog が閉じ、DELETE は 1 度も飛ばず、行も消えない
			await waitFor(() =>
				expect(screen.queryByTestId('cloud-export-delete-confirm-target')).toBeNull(),
			);
			expect(deleted).toEqual([]);
			expect(await findByTestId('cloud-export-row-exp-exhausted')).toBeTruthy();
		});

		// #4767 QM should: 取り消せない操作の完了を無言で終わらせない。
		// DESIGN.md §5 の 2 層 = Toast (primitive) + 画面内 banner (role="status") を、
		// **どちらも実物を描画して** 確かめる (page は Toast を描画しないので test 側で並べる。
		// showToast は module-level state を共有するため、実際に見えるものを assert できる)。
		// #4767 QM should: 取り消せない操作の完了を無言で終わらせない。
		// DESIGN.md §5 の 2 層 (Toast = role="alert" / 画面内 banner = role="status") が
		// **どちらも** 出て、消した対象を名指しすることを固定する。
		it('削除完了を Toast と画面内 banner の 2 層で、消した対象を名指しして知らせる', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			reconcileToastStackSpy.mockClear();
			const deleted = stubCloudFetch([exhaustedRow]);

			const { findByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			await fireEvent.click(await findByTestId('cloud-export-delete-exp-exhausted'));
			vi.mocked(globalThis.fetch).mockImplementation(
				(url: string | URL | Request, init?: RequestInit) => {
					const u = String(url);
					if (init?.method === 'DELETE') {
						deleted.push(u.split('/').pop() ?? '');
						return Promise.resolve({
							ok: true,
							json: () => Promise.resolve({ ok: true }),
						} as Response);
					}
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ exports: [] }),
					} as Response);
				},
			);
			await fireEvent.click(await screen.findByTestId('cloud-export-delete-execute'));

			await waitFor(() => expect(deleted).toContain('exp-exhausted'));

			const expected = SETTINGS_LABELS.cloudDeleteSuccess('ABC234');
			// 層 1: 画面内 banner (role="status") — 消した PIN を名指しする
			await waitFor(() => {
				const statuses = screen.getAllByRole('status');
				expect(statuses.some((el) => el.textContent?.includes(expected))).toBe(true);
			});
			// 層 2: Toast — success 種別で title + 説明が積まれる
			await waitFor(() => {
				expect(reconcileToastStackSpy).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({
						title: SETTINGS_LABELS.cloudDeleteSuccessTitle,
						description: expected,
						type: 'success',
					}),
				);
			});
		});

		// #4767 QM should: 再取得が失敗したときに「削除しました」と言い切ると、画面に残った古い行を見た
		// 顧客は「消えていない」と受け取る (実際は消えている)。起きたことだけを言う。
		it('削除後の一覧再取得が失敗したら、成功と言い切らず表示が古い可能性を伝える', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			reconcileToastStackSpy.mockClear();
			const deleted = stubCloudFetch([exhaustedRow]);

			const { findByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			await fireEvent.click(await findByTestId('cloud-export-delete-exp-exhausted'));
			// DELETE は成功、その後の一覧再取得 (GET) だけ失敗させる
			vi.mocked(globalThis.fetch).mockImplementation(
				(url: string | URL | Request, init?: RequestInit) => {
					const u = String(url);
					if (init?.method === 'DELETE') {
						deleted.push(u.split('/').pop() ?? '');
						return Promise.resolve({
							ok: true,
							json: () => Promise.resolve({ ok: true }),
						} as Response);
					}
					return Promise.resolve({
						ok: false,
						status: 500,
						json: () => Promise.resolve({}),
					} as Response);
				},
			);
			await fireEvent.click(await screen.findByTestId('cloud-export-delete-execute'));

			await waitFor(() => expect(deleted).toContain('exp-exhausted'));

			const stale = SETTINGS_LABELS.cloudDeleteSuccessStale('ABC234');
			// banner は「削除した」+「表示が最新でないかもしれない」を両方言う
			await waitFor(() => {
				const statuses = screen.getAllByRole('status');
				expect(statuses.some((el) => el.textContent?.includes(stale))).toBe(true);
			});
			// 成功と言い切る文言は出さない
			expect(document.body.textContent).not.toContain(SETTINGS_LABELS.cloudDeleteSuccess('ABC234'));
			// Toast も同じ内容 (success ではなく info)
			await waitFor(() => {
				expect(reconcileToastStackSpy).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({
						title: SETTINGS_LABELS.cloudDeleteSuccessStaleTitle,
						description: stale,
						type: 'info',
					}),
				);
			});
			// 古い行はまだ画面に残っている (= だからこそ「最新でないかもしれない」と言う必要がある)
			expect(await findByTestId('cloud-export-row-exp-exhausted')).toBeTruthy();
		});

		it('確認 dialog で確定すると DELETE が飛び、一覧が再取得されて枠が空く', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			const deleted = stubCloudFetch([exhaustedRow]);

			const { findByTestId, queryByTestId } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			await fireEvent.click(await findByTestId('cloud-export-delete-exp-exhausted'));

			// 削除後の再取得は空一覧を返す (= 枠が戻った状態)
			vi.mocked(globalThis.fetch).mockImplementation(
				(url: string | URL | Request, init?: RequestInit) => {
					const u = String(url);
					if (init?.method === 'DELETE') {
						deleted.push(u.split('/').pop() ?? '');
						return Promise.resolve({
							ok: true,
							json: () => Promise.resolve({ ok: true }),
						} as Response);
					}
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ exports: [] }),
					} as Response);
				},
			);
			await fireEvent.click(await screen.findByTestId('cloud-export-delete-execute'));

			await waitFor(() => expect(deleted).toContain('exp-exhausted'));
			await waitFor(() => expect(queryByTestId('cloud-export-stored-list')).toBeNull());
		});
	});

	// ── 状態 4: cloud import timeout エラー (postCloudImport の isAbortError 分岐) ──
	describe('cloud import timeout エラー (#3324, cloud import 経路横展開)', () => {
		it('preview fetch が AbortError で中断したとき timeout 文言を表示する', async () => {
			pageStore.set({ data: { authMode: 'cognito' } });
			vi.stubGlobal(
				'fetch',
				vi.fn((url: string) => {
					// loadCloudExports (GET) は空一覧で解決させ、import/cloud (POST) だけ abort させる
					if (typeof url === 'string' && url.includes('/api/v1/import/cloud')) {
						return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
					}
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ exports: [] }),
					} as Response);
				}),
			);

			const { container, findByText } = render(DataPage, {
				data: makeData({ maxCloudExports: 3 }),
				form: null,
			});

			// PIN を 4 文字以上入力して「確認」ボタンを有効化 → click
			const pinInput = await waitFor(() => {
				const el = container.querySelector<HTMLInputElement>('input[maxlength="6"]');
				if (!el) throw new Error('PIN input 未描画');
				return el;
			});
			await fireEvent.input(pinInput, { target: { value: 'ABC123' } });
			const confirmBtn = await waitFor(() => {
				const btns = Array.from(container.querySelectorAll('button'));
				const btn = btns.find((b) =>
					b.textContent?.includes(SETTINGS_LABELS.cloudImportConfirmAction),
				);
				if (!btn || (btn as HTMLButtonElement).disabled) throw new Error('確認ボタン未有効化');
				return btn as HTMLButtonElement;
			});
			await fireEvent.click(confirmBtn);

			await findByText(SETTINGS_LABELS.dataImportTimeoutError);
		});
	});
});

// #3867: ZIP エクスポート推奨文言 (dataExportZipCloudHint) が NUC (authMode≠cognito) で dangling
// する回帰の固定。cloud export セクション (authMode==='cognito' 専用) と hint を同一条件でガードし、
// NUC / SaaS standard+ / SaaS free の 3 条件で「文言 ↔ CTA (クラウドセクション)」整合を assert する。
describe('/admin/settings/data — ZIP hint と cloud export セクションの条件整合 (#3867)', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	/** GET /api/v1/export/cloud (cognito + maxCloudExports>0 の $effect) を空一覧で解決させる。 */
	function stubCloudExportListEmpty() {
		vi.stubGlobal(
			'fetch',
			vi.fn((url: string) =>
				typeof url === 'string' && url.includes('/api/v1/export/cloud')
					? Promise.resolve({ ok: true, json: () => Promise.resolve({ exports: [] }) } as Response)
					: Promise.reject(new Error(`unexpected fetch: ${url}`)),
			),
		);
	}

	/** 「画像・音声ファイルも含める」チェックを ON にして ZIP hint 領域を描画させる。 */
	async function enableIncludeFiles(container: HTMLElement) {
		const checkbox = Array.from(
			container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
		).find((el) =>
			el.closest('label')?.textContent?.includes(SETTINGS_LABELS.dataExportIncludeFiles),
		);
		if (!checkbox)
			throw new Error('「画像・音声ファイルも含める」チェックボックスが見つかりません');
		await fireEvent.click(checkbox);
	}

	it('NUC (authMode=local): cloud セクション非描画、ZIP hint はクラウド非言及の代替文言', async () => {
		pageStore.set({ data: { authMode: 'local' } });
		const { container, queryByTestId, findByTestId } = render(DataPage, {
			data: makeData({ maxCloudExports: 0 }),
			form: null,
		});
		// cloud export セクションは self-host では描画されない (dangling 誘導先が無いことを固定)
		expect(queryByTestId('cloud-export-card')).toBeNull();

		await enableIncludeFiles(container);
		// cloud 版 hint は出さず、local 代替 hint を出す
		expect(queryByTestId('data-export-zip-cloud-hint')).toBeNull();
		const localHint = await findByTestId('data-export-zip-local-hint');
		expect(localHint.textContent).toContain(SETTINGS_LABELS.dataExportZipLocalHint);
		// AC2: 代替文言は「クラウドバックアップ」に言及しない (dangling 語を含まない)
		expect(localHint.textContent).not.toContain('クラウドバックアップ');
	});

	it('SaaS standard+ (authMode=cognito, maxCloudExports>0): cloud セクション描画、ZIP hint はクラウド誘導文言', async () => {
		pageStore.set({ data: { authMode: 'cognito' } });
		stubCloudExportListEmpty();
		const { container, findByTestId, queryByTestId } = render(DataPage, {
			data: makeData({ maxCloudExports: 3 }),
			form: null,
		});
		// 誘導先の cloud export セクションが実在する (dangling でない)
		await findByTestId('cloud-export-card');

		await enableIncludeFiles(container);
		expect(queryByTestId('data-export-zip-local-hint')).toBeNull();
		const cloudHint = await findByTestId('data-export-zip-cloud-hint');
		expect(cloudHint.textContent).toContain(SETTINGS_LABELS.dataExportZipCloudHint);
	});

	it('SaaS free (authMode=cognito, maxCloudExports=0): cloud セクションが upsell 付きで描画され、ZIP hint 誘導先が dead-end でない', async () => {
		pageStore.set({ data: { authMode: 'cognito' } });
		const { container, findByTestId } = render(DataPage, {
			data: makeData({ maxCloudExports: 0 }),
			form: null,
		});
		// free でも cloud セクションは描画され、upsell (アップグレード導線) が出る → hint 誘導先が実在
		await findByTestId('cloud-export-card');
		await findByTestId('cloud-export-upsell');

		await enableIncludeFiles(container);
		// 誘導先セクションが存在するため、cloud 版 hint のままで整合 (dead-end でない)
		const cloudHint = await findByTestId('data-export-zip-cloud-hint');
		expect(cloudHint.textContent).toContain(SETTINGS_LABELS.dataExportZipCloudHint);
	});
});
