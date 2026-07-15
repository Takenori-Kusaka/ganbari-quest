// tests/unit/routes/activity-edit-reseed.test.ts
// #3499 AC1: /admin/activities/[id]/edit の編集フォームは data.activity の切替
// (= 同一 route の param 変更による非アンマウント再遷移) で必ず再 seed される。
//
// SvelteKit は edit/1 → edit/2 の client-side 遷移で page component を remount せず
// props (`data`) だけを更新する。seed-once $state を +page.svelte に直接置くと古い
// activity のフォーム値が残る stale form になる (#3498 QM adversarial 検出)。
// 本 test は @testing-library/svelte の `rerender` で「同一 component instance への
// data 更新」を忠実に再現し、`{#key data.activity.id}` guard (ActivityEditForm 分割)
// が無いと RED になる (failing-test-first、ADR-0061)。

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));

import type { Component } from 'svelte';
import { asActivityId, asCategoryId, asChildId } from '../../../src/lib/domain/ids';
import { CATEGORY_DEFS } from '../../../src/lib/domain/validation/activity';
import EditPageRaw from '../../../src/routes/(parent)/admin/activities/[id]/edit/+page.svelte';

function makeActivity(overrides: {
	id: string;
	name: string;
	nameKana?: string | null;
	dailyLimit?: number | null;
	priority?: 'must' | 'optional';
}) {
	return {
		id: asActivityId(overrides.id),
		childId: asChildId('901'),
		name: overrides.name,
		categoryId: asCategoryId(1),
		icon: '🏃',
		basePoints: 5,
		isVisible: 1,
		dailyLimit: overrides.dailyLimit ?? null,
		sortOrder: 0,
		source: 'manual',
		nameKana: overrides.nameKana ?? null,
		nameKanji: null,
		triggerHint: null,
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-01-01T00:00:00Z',
		priority: overrides.priority ?? ('optional' as const),
	};
}

function makeData(activity: ReturnType<typeof makeActivity>) {
	return { activity, categoryDefs: CATEGORY_DEFS };
}

// PageData には layout 由来 field (role / planTier / requestId 等) が merge されるが、
// 本 page component は data.activity / data.categoryDefs しか参照しないため、
// test では page 固有 load 分のみを渡す (型は component 側で最小化して受ける)。
const EditPage = EditPageRaw as unknown as Component<{
	data: ReturnType<typeof makeData>;
	form: null;
}>;

describe('/admin/activities/[id]/edit — 再遷移時のフォーム再 seed (#3499 AC1)', () => {
	afterEach(() => {
		cleanup();
	});

	it('初期表示で data.activity の値が seed される', () => {
		const { container } = render(EditPage, {
			data: makeData(makeActivity({ id: '1', name: 'あさランニング' })),
			form: null,
		});
		const nameInput = container.querySelector<HTMLInputElement>('input[name="name"]');
		expect(nameInput?.value).toBe('あさランニング');
	});

	it('data.activity が別 activity に変わったらフォーム値が再 seed される (stale form 防止)', async () => {
		const activityA = makeActivity({
			id: '1',
			name: 'あさランニング',
			nameKana: 'あさらんにんぐ',
			dailyLimit: 3,
			priority: 'must',
		});
		const activityB = makeActivity({
			id: '2',
			name: 'ほんをよむ',
			nameKana: null,
			dailyLimit: null,
			priority: 'optional',
		});
		const { container, rerender } = render(EditPage, {
			data: makeData(activityA),
			form: null,
		});

		// precondition: A の値が seed 済
		expect(container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(
			'あさランニング',
		);
		expect(
			container.querySelector<HTMLInputElement>('[data-testid="must-toggle-checkbox"]')?.checked,
		).toBe(true);

		// SvelteKit の同一 route param 遷移 (edit/1 → edit/2) = 同一 instance への data 更新
		await rerender({ data: makeData(activityB), form: null });

		// {#key data.activity.id} guard により ActivityEditForm が remount → B の値へ再 seed。
		// guard 無し (旧実装) では A の値が残り RED になる。
		expect(container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(
			'ほんをよむ',
		);
		expect(container.querySelector<HTMLInputElement>('input[name="nameKana"]')?.value).toBe('');
		expect(
			container.querySelector<HTMLInputElement>('[data-testid="must-toggle-checkbox"]')?.checked,
		).toBe(false);
		expect(container.querySelector<HTMLInputElement>('input[name="dailyLimit"]')?.value).toBe('');
	});
});
