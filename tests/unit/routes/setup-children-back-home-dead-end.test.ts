// tests/unit/routes/setup-children-back-home-dead-end.test.ts
//
// `/setup/children` (local モードで最初に着地する画面) の「ホームに戻る」は `/switch` を指す。
// ところが `src/hooks.server.ts` の local セットアップ誘導は「子供 0 人なら全 path を /setup へ
// 302」を掛けており、除外リストに `/switch` (も `/admin`) が無い。つまり子供 0 人のあいだ
// このリンクは `/switch` → `/setup` → `/setup/children` と自分自身に戻る無反応リンクだった。
// (隣の復元リンク `/admin/settings/data` は #4696 で同じ理由から除外リストに穴を開けてある。)
//
// 固定する不変条件:
//   [A] セットアップが強制されている状態では「ホームに戻る」を出さない
//       (出口が実在するときだけ出す = 押しても動かないリンクを作らない)
//   [B] セットアップが強制されていない実行モードでは従来どおり出す
//   [C] 出口が 0 になる状態を作らない (復元導線は常に残る)

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETUP_CHILDREN_LABELS } from '../../../src/lib/domain/labels';
import SetupChildrenPage from '../../../src/routes/setup/children/+page.svelte';

const getAuthMode = vi.fn();
const getAllChildren = vi.fn();
const isSetupRequired = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 'tenant-1',
	getAuthMode: () => getAuthMode(),
}));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => getAllChildren(...args),
	addChild: vi.fn(),
}));
vi.mock('$lib/server/services/setup-service', () => ({
	isSetupRequired: (...args: unknown[]) => isSetupRequired(...args),
}));
vi.mock('$lib/server/services/setup-funnel-service', () => ({
	trackSetupFunnel: vi.fn(),
}));

async function runLoad(): Promise<{ canReturnHome: boolean }> {
	const { load } = await import('../../../src/routes/setup/children/+page.server');
	return (await load({ locals: { context: { tenantId: 'tenant-1' } } } as never)) as unknown as {
		canReturnHome: boolean;
	};
}

describe('[A][B] 「ホームに戻る」を出すかどうか (load)', () => {
	beforeEach(() => {
		getAuthMode.mockReset();
		getAllChildren.mockReset();
		isSetupRequired.mockReset();
	});

	it('local + 子供 0 人 (セットアップ強制) では出さない — /switch は自分自身へ戻る', async () => {
		getAuthMode.mockReturnValue('local');
		getAllChildren.mockResolvedValueOnce([]);
		isSetupRequired.mockResolvedValueOnce(true);

		expect((await runLoad()).canReturnHome).toBe(false);
	});

	it('local でも子供が居れば出す (セットアップ誘導が掛からない)', async () => {
		getAuthMode.mockReturnValue('local');
		getAllChildren.mockResolvedValueOnce([{ id: 'c1', nickname: 'たろう' }]);

		expect((await runLoad()).canReturnHome).toBe(true);
		// 子供が居る時点で判定は確定するので追加の問い合わせをしない
		expect(isSetupRequired).not.toHaveBeenCalled();
	});

	it('local + 子供 0 人でもアーカイブ済みが居れば出す (セットアップ済み扱い)', async () => {
		getAuthMode.mockReturnValue('local');
		getAllChildren.mockResolvedValueOnce([]);
		isSetupRequired.mockResolvedValueOnce(false);

		expect((await runLoad()).canReturnHome).toBe(true);
	});

	it('cognito は子供 0 人でも出す (セットアップ誘導が local 限定のため /switch に着地できる)', async () => {
		getAuthMode.mockReturnValue('cognito');
		getAllChildren.mockResolvedValueOnce([]);

		expect((await runLoad()).canReturnHome).toBe(true);
		expect(isSetupRequired).not.toHaveBeenCalled();
	});
});

// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の PageData 型を test で最小化する
function renderPage(canReturnHome: boolean): any {
	return render(SetupChildrenPage as never, {
		props: { data: { children: [], canReturnHome }, form: null } as never,
	});
}

describe('[A][C] 画面に出るリンク (component)', () => {
	afterEach(() => cleanup());

	it('canReturnHome=false では「ホームに戻る」リンクを描画しない', () => {
		renderPage(false);
		expect(screen.queryByTestId('setup-skip-link')).toBeNull();
	});

	it('canReturnHome=true では従来どおり /switch へのリンクを描画する', () => {
		renderPage(true);
		const link = screen.getByTestId('setup-skip-link');
		expect(link.getAttribute('href')).toBe('/switch');
		expect(link.textContent).toContain(SETUP_CHILDREN_LABELS.backToHome);
	});

	it('リンクを隠しても出口は 0 にならない (バックアップ復元導線は残す)', () => {
		renderPage(false);
		expect(screen.getByTestId('setup-restore-link').getAttribute('href')).toBe(
			'/admin/settings/data',
		);
	});
});
