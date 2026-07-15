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

import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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
