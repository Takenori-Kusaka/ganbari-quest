<script module lang="ts">
/**
 * DowngradeResourceSelector.stories.svelte (#4528)
 *
 * ダウングレード確認ダイアログの見た目を story で固定する。
 *
 * 本ダイアログは `SaasLicensePanel.requestPortal()` から
 *   ① `STRIPE_SECRET_KEY` があり (stripeEnabled)
 *   ② tenant に有効な契約 (`stripeSubscriptionId`) があり
 *   ③ ダウングレードで失うものがある (`hasExcess` または保持期間短縮 `willLoseHistory`、
 *     判定は `downgrade-dialog-policy.ts` の `shouldOpenDowngradeSelector`、#4530)
 * の 3 条件が揃ったときにだけ開く。local backend (sqlite) は `tenants` を持たず
 * `getLicenseInfo` が常に null を返すため、**ローカルでは開くこと自体ができない**
 * (docs/CLAUDE.md §「local 検証不可」と同型。SaasLicensePanel story の
 * portal-fallback-notice と同じ理由)。よって保持期間短縮警告の見た目は本 story で担保する。
 *
 * 設計原則 (tests/CLAUDE.md §Storybook interaction test):
 *   - Dialog は Ark UI `<Portal>` 経由で document.body 直下に render されるため
 *     `canvasElement` には届かない。`screen` (document.body 起点) で query する。
 *   - 表示テキストの mock は `STORYBOOK_LABELS` 経由 (docs/DESIGN.md §6 Storybook ラベル方針)。
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { PLAN_HISTORY_RETENTION_DAYS } from '$lib/domain/constants/plan-retention';
import type { DowngradePreview } from '$lib/domain/downgrade-types';
import type { ActivityId, ChildId } from '$lib/domain/ids';
import { DOWNGRADE_RESOURCE_SELECTOR_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import DowngradeResourceSelector from './DowngradeResourceSelector.svelte';

const L = STORYBOOK_LABELS.downgradeResourceSelector;

/** free の上限。値は plan-limit-service と同じ SSOT から引く (直書きしない)。 */
const FREE_MAX_CHILDREN = 2;
const FREE_MAX_ACTIVITIES = 3;
const FREE_RETENTION_DAYS = PLAN_HISTORY_RETENTION_DAYS.free;
const STANDARD_RETENTION_DAYS = PLAN_HISTORY_RETENTION_DAYS.standard;

/**
 * `/api/v1/admin/downgrade-preview?targetTier=free` の戻り値と同型の mock。
 * 子供 3 人 / 活動 4 個 = free 上限超過 (hasExcess) で、保持期間も短縮される状態。
 */
function mockPreview(currentRetentionDays: number | null): DowngradePreview {
	return {
		targetTier: 'free',
		children: {
			current: [
				{ id: 'child-1' as ChildId, name: L.childOne, uiMode: 'elementary' },
				{ id: 'child-2' as ChildId, name: L.childTwo, uiMode: 'preschool' },
				{ id: 'child-3' as ChildId, name: L.childThree, uiMode: 'junior' },
			],
			max: FREE_MAX_CHILDREN,
			excess: 1,
		},
		activities: {
			current: [
				{ id: 'act-1' as ActivityId, name: L.activityOne, icon: '🦷' },
				{ id: 'act-2' as ActivityId, name: L.activityTwo, icon: '🧹' },
				{ id: 'act-3' as ActivityId, name: L.activityThree, icon: '📖' },
				{ id: 'act-4' as ActivityId, name: L.activityFour, icon: '🤸' },
			],
			max: FREE_MAX_ACTIVITIES,
			excess: 1,
		},
		checklistTemplates: { current: [], maxPerChild: 3, excessByChild: [] },
		retentionChange: {
			currentDays: currentRetentionDays,
			targetDays: FREE_RETENTION_DAYS,
			willLoseHistory: true,
		},
		hasExcess: true,
	};
}

/**
 * 超過リソースが**無い**まま保持期間だけが縮む preview (#4530)。
 *
 * 旧実装はダイアログを開く判定が `hasExcess` だけだったため、この状態の顧客は
 * 警告を 1 つも見ないまま Stripe の確認へ直行し、保持期間を超えた記録が物理削除されていた。
 * 子供 2 人 / 活動 2 個はいずれも free 上限以内 = `hasExcess: false`。
 */
function mockPreviewWithoutExcess(currentRetentionDays: number | null): DowngradePreview {
	return {
		targetTier: 'free',
		children: {
			current: [
				{ id: 'child-1' as ChildId, name: L.childOne, uiMode: 'elementary' },
				{ id: 'child-2' as ChildId, name: L.childTwo, uiMode: 'preschool' },
			],
			max: FREE_MAX_CHILDREN,
			excess: 0,
		},
		activities: {
			current: [
				{ id: 'act-1' as ActivityId, name: L.activityOne, icon: '🦷' },
				{ id: 'act-2' as ActivityId, name: L.activityTwo, icon: '🧹' },
			],
			max: FREE_MAX_ACTIVITIES,
			excess: 0,
		},
		checklistTemplates: { current: [], maxPerChild: 3, excessByChild: [] },
		retentionChange: {
			currentDays: currentRetentionDays,
			targetDays: FREE_RETENTION_DAYS,
			willLoseHistory: true,
		},
		hasExcess: false,
	};
}

const { Story } = defineMeta({
	title: 'Admin/DowngradeResourceSelector',
	component: DowngradeResourceSelector,
	tags: ['autodocs'],
});
</script>

<!--
  スタンダード (1年保持) → 無料 (90日保持)。
  保持期間短縮の警告が「削除され、復元できません（再契約でも戻りません）」まで述べ切っていること
  を検証する (#4528。実装は物理削除なので「閲覧できなくなります」に弱めてはならない)。
-->
<Story
	name="RetentionShortenedFromStandard"
	args={{
		open: true,
		preview: mockPreview(STANDARD_RETENTION_DAYS),
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async () => {
		const expected = DOWNGRADE_RESOURCE_SELECTOR_LABELS.retentionWarning(
			STANDARD_RETENTION_DAYS,
			FREE_RETENTION_DAYS,
		);
		const warning = await waitFor(() => screen.getByText(expected));
		await expect(warning).toBeVisible();
		await expect(warning).toHaveTextContent('削除され、復元できません（再契約でも戻りません）');
	}}
/>

<!--
  プレミアム (無制限保持) → 無料 (90日保持)。無制限側の分岐でも同じ強さで述べる。
-->
<Story
	name="RetentionShortenedFromUnlimited"
	args={{
		open: true,
		preview: mockPreview(null),
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async () => {
		const expected = DOWNGRADE_RESOURCE_SELECTOR_LABELS.retentionWarning(
			null,
			FREE_RETENTION_DAYS,
		);
		const warning = await waitFor(() => screen.getByText(expected));
		await expect(warning).toBeVisible();
		await expect(warning).toHaveTextContent('削除され、復元できません（再契約でも戻りません）');
	}}
/>

<!--
  #4530: 超過リソースが無く、保持期間だけが縮むダウングレード。
  旧実装ではこの状態でダイアログが開かれず、警告が顧客に一度も出なかった
  (caller が `hasExcess` だけで開くか決めていた)。
  ここでは (a) 保持期間短縮の警告が出ること、(b) 超過リソースの選択 UI は出ないこと、
  (c) 確認ボタンが「アーカイブして…」ではなく「プラン変更へ進む」であることを固定する。
-->
<Story
	name="RetentionShortenedWithoutExcess"
	args={{
		open: true,
		preview: mockPreviewWithoutExcess(STANDARD_RETENTION_DAYS),
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async () => {
		const expected = DOWNGRADE_RESOURCE_SELECTOR_LABELS.retentionWarning(
			STANDARD_RETENTION_DAYS,
			FREE_RETENTION_DAYS,
		);
		const warning = await waitFor(() => screen.getByText(expected));
		await expect(warning).toBeVisible();
		await expect(warning).toHaveTextContent('削除され、復元できません（再契約でも戻りません）');

		// 超過が無いので選択 UI は出ない (無用な操作を増やさない)
		await expect(screen.queryByTestId('downgrade-child-list')).toBeNull();

		// 確認ボタンはアーカイブではなくプラン変更へ進む側
		const confirm = screen.getByTestId('downgrade-confirm-button');
		await expect(confirm).toHaveTextContent(DOWNGRADE_RESOURCE_SELECTOR_LABELS.proceedButton);
		await expect(confirm).toBeEnabled();
	}}
/>
