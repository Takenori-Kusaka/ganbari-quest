// tests/unit/components/activity-empty-state.test.ts
// EPIC #2253 / #2256 — ActivityEmptyState の 3 visibility 状態を SSOT 検証
//
// 旧 Fix-4 では同等検証を E2E で `__data.json` route stub を介して再現しようとしたが、
// SvelteKit の SSR 経路ではダエハイドレートされた HTML payload に data が埋め込まれるため
// `__data.json` stub が発火せず、初期遷移で empty 状態を強制できなかった (PR #2260)。
// 本ファイルでは @testing-library/svelte で component 単体をマウントし、props を直接
// 制御する形に切り替えることで以下 3 状態の visibility を高速・決定的に検証する。
//
// AC #2256 AC1: empty 状態 (canAdd && !hasFilter) で `empty-state-import-link` が visible
// AC #2256 AC2: click で onAdd('browse') が呼ばれる (#2558 段階2: admin 内ブラウズ UI 撤去に伴い
//               /marketplace へ画面遷移する 'browse' mode に変更。旧 'import' (dialog 開) は廃止)
// AC #2256 AC3: hasFilter=true (filter 結果空) の時は primary CTA のみで import link は非表示
// AC #2256 AC4: canAdd=false (上限到達) の時は CTA / link 共に非表示

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActivityEmptyState from '../../../src/lib/features/admin/components/ActivityEmptyState.svelte';

describe('ActivityEmptyState — visibility matrix (#2253 / #2256)', () => {
	afterEach(() => {
		cleanup();
	});

	describe('AC1: canAdd=true, hasFilter=false (genuine empty, can add)', () => {
		it('primary CTA (Button) が visible', () => {
			render(ActivityEmptyState, {
				hasFilter: false,
				canAdd: true,
				onAdd: () => {},
			});
			// Primary CTA = Button primitive の label
			const buttons = screen.getAllByRole('button');
			// 1 個目 = primary CTA, 2 個目 = secondary import link
			expect(buttons.length).toBeGreaterThanOrEqual(2);
		});

		it('secondary import link (empty-state-import-link) が visible', () => {
			render(ActivityEmptyState, {
				hasFilter: false,
				canAdd: true,
				onAdd: () => {},
			});
			const link = screen.getByTestId('empty-state-import-link');
			expect(link).toBeTruthy();
			expect(link.tagName.toLowerCase()).toBe('button');
		});
	});

	describe('AC2: secondary import link click で onAdd("browse") が呼ばれる (#2558 段階2)', () => {
		it('click すると onAdd callback に "browse" が渡る (/marketplace 遷移トリガ)', async () => {
			const onAdd = vi.fn();
			render(ActivityEmptyState, {
				hasFilter: false,
				canAdd: true,
				onAdd,
			});
			const link = screen.getByTestId('empty-state-import-link');
			await fireEvent.click(link);
			// #2558 段階2: admin 内ブラウズ UI 撤去 → /marketplace へ画面遷移する 'browse' mode に変更
			expect(onAdd).toHaveBeenCalledWith('browse');
		});
	});

	describe('AC3: hasFilter=true (filter empty) の時は import link 非表示', () => {
		it('empty-state-import-link は DOM に存在しない', () => {
			render(ActivityEmptyState, {
				hasFilter: true,
				canAdd: true,
				onAdd: () => {},
			});
			expect(screen.queryByTestId('empty-state-import-link')).toBeNull();
		});

		it('primary CTA は visible (フィルタ条件下でも追加可能を示す)', () => {
			render(ActivityEmptyState, {
				hasFilter: true,
				canAdd: true,
				onAdd: () => {},
			});
			const buttons = screen.getAllByRole('button');
			expect(buttons.length).toBe(1); // primary CTA のみ
		});
	});

	describe('AC4: canAdd=false (上限到達) の時は CTA / link 共に非表示', () => {
		it('hasFilter=false で empty-state-import-link が非表示', () => {
			render(ActivityEmptyState, {
				hasFilter: false,
				canAdd: false,
				onAdd: () => {},
			});
			expect(screen.queryByTestId('empty-state-import-link')).toBeNull();
		});

		it('hasFilter=false で primary CTA も非表示', () => {
			render(ActivityEmptyState, {
				hasFilter: false,
				canAdd: false,
				onAdd: () => {},
			});
			expect(screen.queryAllByRole('button').length).toBe(0);
		});

		it('hasFilter=true でも primary CTA / link 共に非表示', () => {
			render(ActivityEmptyState, {
				hasFilter: true,
				canAdd: false,
				onAdd: () => {},
			});
			expect(screen.queryByTestId('empty-state-import-link')).toBeNull();
			expect(screen.queryAllByRole('button').length).toBe(0);
		});
	});
});
