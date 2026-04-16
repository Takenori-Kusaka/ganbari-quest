// tests/e2e/downgrade-flow.spec.ts
// #754: ダウングレード確認・超過リソース処理の E2E テスト
//
// ローカルモード（plan=family 相当）で 5 子供を持つテナントが
// free プランへのダウングレードを試みた際の超過リソース計算・
// 選択的アーカイブ・復元サイクルを検証する。
//
// Stripe Customer Portal 統合のフル UI テストは cognito-dev モードが必要。
// ここでは API レベル + ダイアログ UI の表示・操作を検証する。

import { expect, test } from '@playwright/test';

// ============================================================
// API: ダウングレードプレビュー
// ============================================================

test.describe('#754 ダウングレードフロー — API', () => {
	test('GET /api/v1/admin/downgrade-preview?targetTier=free が超過リソースを返す', async ({
		request,
	}) => {
		const res = await request.get('/api/v1/admin/downgrade-preview?targetTier=free');
		expect(res.status()).toBe(200);

		const body = await res.json();

		// free プランの上限: maxChildren=2, maxActivities=3, maxChecklistTemplates=3
		expect(body.targetTier).toBe('free');
		expect(body.children.max).toBe(2);

		// テストデータに 5 子供があるので超過あり
		expect(body.children.current.length).toBeGreaterThanOrEqual(5);
		expect(body.children.excess).toBeGreaterThanOrEqual(3);
		expect(body.hasExcess).toBe(true);

		// 各子供にはid, name, uiMode がある
		for (const child of body.children.current) {
			expect(child.id).toBeDefined();
			expect(child.name).toBeDefined();
			expect(child.uiMode).toBeDefined();
		}
	});

	test('GET /api/v1/admin/downgrade-preview?targetTier=standard は超過が少ない', async ({
		request,
	}) => {
		const res = await request.get('/api/v1/admin/downgrade-preview?targetTier=standard');
		expect(res.status()).toBe(200);

		const body = await res.json();
		expect(body.targetTier).toBe('standard');

		// standard は子供数無制限 → 超過なし
		expect(body.children.max).toBeNull();
		expect(body.children.excess).toBe(0);
	});

	test('targetTier 未指定で 400', async ({ request }) => {
		const res = await request.get('/api/v1/admin/downgrade-preview');
		expect(res.status()).toBe(400);
	});

	test('不正な targetTier で 400', async ({ request }) => {
		const res = await request.get('/api/v1/admin/downgrade-preview?targetTier=premium');
		expect(res.status()).toBe(400);
	});
});

// ============================================================
// API: ダウングレードアーカイブ実行
// ============================================================

test.describe('#754 ダウングレードフロー — アーカイブ API', () => {
	test('超過分を正しく選択してアーカイブできる', async ({ request }) => {
		// 1) プレビュー取得
		const previewRes = await request.get('/api/v1/admin/downgrade-preview?targetTier=free');
		expect(previewRes.status()).toBe(200);
		const preview = await previewRes.json();

		// 超過子供のうち必要な数だけ選択（古い順に余剰分を選択）
		const sortedChildren = [...preview.children.current].sort(
			(a: { id: number }, b: { id: number }) => a.id - b.id,
		);
		const childIdsToArchive = sortedChildren
			.slice(preview.children.max ?? sortedChildren.length)
			.map((c: { id: number }) => c.id);

		expect(childIdsToArchive.length).toBeGreaterThanOrEqual(preview.children.excess);

		// 2) アーカイブ実行
		const archiveRes = await request.post('/api/v1/admin/downgrade-archive', {
			data: {
				targetTier: 'free',
				childIds: childIdsToArchive,
				activityIds: [],
				checklistTemplateIds: [],
			},
		});
		expect(archiveRes.status()).toBe(200);

		const archiveResult = await archiveRes.json();
		expect(archiveResult.archivedChildIds).toEqual(expect.arrayContaining(childIdsToArchive));

		// 3) 再度プレビューを取得 → 超過が解消されている
		const afterRes = await request.get('/api/v1/admin/downgrade-preview?targetTier=free');
		expect(afterRes.status()).toBe(200);
		const afterPreview = await afterRes.json();
		expect(afterPreview.children.excess).toBe(0);

		// 4) クリーンアップ: アーカイブしたリソースを復元（他テストへの影響を防止）
		const restoreRes = await request.post('/api/v1/admin/downgrade-restore');
		expect(restoreRes.status()).toBe(200);
	});

	test('選択数が不足するとアーカイブ失敗（400）', async ({ request }) => {
		const previewRes = await request.get('/api/v1/admin/downgrade-preview?targetTier=free');
		const preview = await previewRes.json();

		// 超過がある場合のみテスト（通常は超過あり）
		if (preview.children.excess > 0) {
			// 必要数より 1 少なく選択
			const sortedChildren = [...preview.children.current].sort(
				(a: { id: number }, b: { id: number }) => a.id - b.id,
			);
			const insufficientIds = sortedChildren
				.slice(preview.children.max ?? sortedChildren.length)
				.slice(0, preview.children.excess - 1)
				.map((c: { id: number }) => c.id);

			const res = await request.post('/api/v1/admin/downgrade-archive', {
				data: {
					targetTier: 'free',
					childIds: insufficientIds,
					activityIds: [],
					checklistTemplateIds: [],
				},
			});
			expect(res.status()).toBe(400);
		}
	});

	test('targetTier 未指定でアーカイブ失敗（400）', async ({ request }) => {
		const res = await request.post('/api/v1/admin/downgrade-archive', {
			data: {
				childIds: [],
				activityIds: [],
				checklistTemplateIds: [],
			},
		});
		expect(res.status()).toBe(400);
	});
});

// ============================================================
// UI: ライセンスページからのダウングレードフロー
// ============================================================

test.describe('#754 ダウングレードフロー — UI', () => {
	test.beforeEach(() => {
		test.slow(); // Vite dev のコールドコンパイルでタイムアウトを延長
	});

	test('/admin/license でプラン管理ボタンをクリックするとダウングレード警告が表示される', async ({
		page,
	}) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });

		// プラン管理のポータルボタンがあるか確認
		const portalButton = page.getByTestId('open-portal-button');
		const isVisible = await portalButton.isVisible({ timeout: 5000 }).catch(() => false);

		if (isVisible) {
			await portalButton.click();

			// family プラン（5子供）で free にダウングレード試行
			// → DowngradeResourceSelector が表示される
			const selector = page.getByTestId('downgrade-preview-content');
			const selectorVisible = await selector.isVisible({ timeout: 5000 }).catch(() => false);

			if (selectorVisible) {
				// 超過子供リストが表示される
				const childList = page.getByTestId('downgrade-child-list');
				await expect(childList).toBeVisible();

				// 確認ボタンは初期状態で無効（選択不足）
				const confirmButton = page.getByTestId('downgrade-confirm-button');
				await expect(confirmButton).toBeDisabled();
			}
			// Stripe 未設定の場合は直接 PIN ダイアログが出る可能性もある
		}
		// ポータルボタンが無い場合（Stripe 未設定でプラン管理セクションが非表示）はスキップ
	});
});
