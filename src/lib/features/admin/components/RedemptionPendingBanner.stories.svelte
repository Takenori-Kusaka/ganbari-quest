<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { ADMIN_HOME_LABELS } from '$lib/domain/labels';
import RedemptionPendingBanner from './RedemptionPendingBanner.svelte';

// #3144 / #3148: admin ホームの承認待ち導線バナー。
// - Pending: pending > 0 の発見性バナー (warning semantic token、件数表示)。
// - Error: 件数取得失敗時の導線 (error semantic token、true-0 と failure-0 を区別)。
// 表示文言は ADMIN_HOME_LABELS (REWARD_TERMS atom 経由) を参照し直書きしない。
const { Story } = defineMeta({
	title: 'Admin/RedemptionPendingBanner',
	component: RedemptionPendingBanner,
	tags: ['autodocs'],
});
</script>

<!-- 承認待ちあり (pending > 0)。warning semantic token + 件数 + 確認ページ導線。 -->
<Story
	name="Pending"
	args={{ variant: 'pending', count: 3 }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('redemption-pending-banner');
		await expect(banner).toBeVisible();
		await expect(banner).toHaveAttribute('href', '/admin/rewards/requests');
		await expect(banner).toHaveTextContent(ADMIN_HOME_LABELS.pendingRedemptionBanner(3));
		// #3185 a11y: 出現時に SR へ告知する live region。link role は保持 (role 上書きしない)。
		await expect(banner).toHaveAttribute('aria-live', 'polite');
		await expect(banner).not.toHaveAttribute('role'); // <a> の link role を上書きしない
	}}
/>

<!-- #3148: 件数取得失敗 (failure-0)。error semantic token + 確認ページ導線で silent 非表示を回避。 -->
<Story
	name="Error"
	args={{ variant: 'error' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('redemption-pending-banner-error');
		await expect(banner).toBeVisible();
		await expect(banner).toHaveAttribute('href', '/admin/rewards/requests');
		await expect(banner).toHaveTextContent(ADMIN_HOME_LABELS.pendingRedemptionLoadFailed);
		// #3185 a11y: 件数取得失敗は assertive で即時告知。link role は保持 (対処画面へ遷移可能)。
		await expect(banner).toHaveAttribute('aria-live', 'assertive');
		await expect(banner).not.toHaveAttribute('role'); // <a> の link role を上書きしない
	}}
/>
