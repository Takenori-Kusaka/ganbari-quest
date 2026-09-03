<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { SETTINGS_LABELS } from '$lib/domain/labels';
import ImportQuotaArchivedNotice from './ImportQuotaArchivedNotice.svelte';

// #4693 (PO 回答 2026-09-03 #2): 復元がプラン上限で一部を保管 (archived) したときの結果行。
// 実環境で描画するには「無料プラン + 上限を超える backup を復元」が要り、SS 撮影に使う demo 環境
// (DATA_SOURCE=demo) では復元自体が起きないため、見た目の確認は本 story が担う。
const { Story } = defineMeta({
	title: 'Admin/ImportQuotaArchivedNotice',
	component: ImportQuotaArchivedNotice,
	tags: ['autodocs'],
});
</script>

<!-- PO 回答の例: 119 件のうち 3 件を有効化し、116 件を保管 -->
<Story
	name="PlanLimitArchived"
	args={{
		total: 119,
		activated: 3,
		archived: 116,
		message: 'オリジナル活動は 3 個までです（プリセットからの取込は無制限です）',
		upgradeUrl: '/admin/subscription',
		testid: 'data-import-quota-archived',
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const row = canvas.getByTestId('data-import-quota-archived');
		// 入った数 / 保管した数 / 理由 / 次の行動 の 4 つが同一視界に出る
		await expect(row).toHaveTextContent(
			SETTINGS_LABELS.dataImportResultQuotaArchived(119, 3, 116),
		);
		await expect(row).toHaveTextContent('オリジナル活動は 3 個までです');
		await expect(canvas.getByRole('link')).toHaveAttribute('href', '/admin/subscription');
	}}
/>

<!-- プランを確認できず全件を保管した場合 (fail-closed)。アップグレードでは解消しないので導線は出さない -->
<Story
	name="PlanUnverifiableArchived"
	args={{
		total: 5,
		activated: 0,
		archived: 5,
		message:
			'ただいまプランを確認できないため、5 件の活動は保管しました。有料プランでは自動で元に戻ります。',
		upgradeUrl: null,
		testid: 'data-import-quota-archived',
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('data-import-quota-archived')).toHaveTextContent(
			'保管しました',
		);
		await expect(canvas.queryByRole('link')).toBeNull();
	}}
/>

<!-- 上限に触れていない復元では何も描画しない (成功表示を汚さない) -->
<Story
	name="NothingArchived"
	args={{
		total: 3,
		activated: 3,
		archived: 0,
		message: '',
		upgradeUrl: null,
		testid: 'data-import-quota-archived',
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('data-import-quota-archived')).toBeNull();
	}}
/>
