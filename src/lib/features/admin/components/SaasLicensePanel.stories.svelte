<script module lang="ts">
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import {
	PORTAL_FALLBACK_CONTEXT,
	PORTAL_FALLBACK_REASON,
} from '$lib/domain/constants/stripe-portal';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { STORYBOOK_LABELS, SUBSCRIPTION_PAGE_LABELS } from '$lib/domain/labels';
import SaasLicensePanel from './SaasLicensePanel.svelte';

// #4302 follow-up (QM 指摘): `portal-fallback-notice` は Stripe が実際に flow を拒否したときだけ
// 描画される (SaasLicensePanel.svelte の `openPortal()` / `$effect` 分岐)。demo 環境
// (`DATA_SOURCE=demo`) では Stripe を叩けないため撮影できず (ss-render-impossible)、
// 見た目を確認する手段が story しか無かった (#4166 / #4270)。
//
// `data.portalFallback` に `PORTAL_FALLBACK_CONTEXT.CANCEL` を渡すと、マウント時の `$effect` が
// 決定的に `portalFallbackMessage` を立てる (fetch モック不要)。解約フォーム送信後に
// server redirect (`?portalFallback=cancel`) で戻ってきた状態を再現する。

const BASE_LICENSE = {
	plan: 'standard' as const,
	status: SUBSCRIPTION_STATUS.ACTIVE,
	tenantName: STORYBOOK_LABELS.saasLicensePanel.tenantName,
	stripeSubscriptionId: 'sub_mock_4302',
	stripeCustomerId: 'cus_mock_4302',
	createdAt: '2026-01-15T00:00:00.000Z',
	updatedAt: '2026-01-15T00:00:00.000Z',
};

const BASE_PLAN_STATS = {
	activityCount: 4,
	activityMax: 20,
	childCount: 1,
	childMax: 3,
	retentionDays: 365,
};

const BASE_TRIAL_STATUS = {
	isTrialActive: false,
	trialUsed: true,
	daysRemaining: 0,
	trialEndDate: null,
	trialTier: null,
};

/** SaasLicensePanel `data` prop の mock (`+page.server.ts` の load 戻り値と同型)。 */
function mockData(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		license: BASE_LICENSE,
		stripeEnabled: true,
		loyaltyInfo: null,
		planTier: 'standard' as const,
		planStats: BASE_PLAN_STATS,
		downgradeRetentionDays: 90,
		pinConfigured: true,
		checkoutReconciliation: null,
		portalFallback: null,
		// #4548: 既定は一時障害側 (`+page.server.ts` の load と同じ既定値)。
		portalFallbackReason: PORTAL_FALLBACK_REASON.FLOW_REJECTED,
		trialStatus: BASE_TRIAL_STATUS,
		cancellation: null,
		...overrides,
	};
}

const { Story } = defineMeta({
	title: 'Admin/SaasLicensePanel',
	component: SaasLicensePanel,
	tags: ['autodocs'],
});
</script>

<!-- 通常表示 (フォールバック無し)。プラン管理カード等は出るが portal-fallback-notice は無い。 -->
<Story
	name="Default"
	args={{ data: mockData() }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('saas-license-panel')).toBeVisible();
		await expect(canvas.queryByTestId('portal-fallback-notice')).toBeNull();
	}}
/>

<!-- #4270: 解約フローが Stripe に拒否されて portal home に倒れ、
     `/admin/subscription?portalFallback=cancel` へ戻ってきた状態。
     このケースでは作成済み session URL が無いため「続ける」ボタンは出ず、
     「請求管理ページを開く」ボタンから続けるよう案内するだけになる (実装どおり)。 -->
<Story
	name="PortalFallbackCancel"
	args={{
		data: mockData({
			portalFallback: PORTAL_FALLBACK_CONTEXT.CANCEL,
			portalFallbackReason: PORTAL_FALLBACK_REASON.FLOW_REJECTED,
		}),
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const notice = canvas.getByTestId('portal-fallback-notice');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.portalFallbackCancel);
		// 解約経路のフォールバックには session URL が無いため continue ボタンは出ない
		await expect(canvas.queryByTestId('portal-fallback-continue')).toBeNull();
		// #4548: 一時障害は時間をおけば直る。ここでサポート導線まで出すと、自力で解決できる
		// 顧客を問い合わせへ流してしまう (出し分けが崩れる)。
		await expect(canvas.queryByTestId('portal-fallback-support')).toBeNull();
	}}
/>

<!-- #4548: ご契約情報が確認できず、**この画面から自力で解約を完了できない**状態。
     再試行を促しても同じ場所に戻り続けるだけなので (出口の無いループ = 特商法上の
     解約導線の実効性を欠く)、できないことを認めてサポート窓口を出す。
     Stripe を叩けない demo 環境では撮影できないため (ss-render-impossible)、
     見た目の確認手段は本 story が担う。 -->
<Story
	name="PortalFallbackCancelUnresolvable"
	args={{
		data: mockData({
			portalFallback: PORTAL_FALLBACK_CONTEXT.CANCEL,
			portalFallbackReason: PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION,
		}),
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const notice = canvas.getByTestId('portal-fallback-notice');
		await expect(notice).toBeVisible();
		// 一時障害の文言 (「この画面の『請求ポータルを開く』から続けてください」) を出しては
		// いけない — 押しても続けられないため、顧客は同じ画面を往復し続ける。
		await expect(notice).toHaveTextContent(
			SUBSCRIPTION_PAGE_LABELS.portalFallbackCancelUnavailable,
		);
		await expect(notice).not.toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.portalFallbackCancel);
		// 唯一の出口。無いと顧客は解約する手段を 1 つも持たない。
		const support = canvas.getByTestId('portal-fallback-support');
		await expect(support).toBeVisible();
		await expect(support).toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.portalFallbackSupportLink);
		await expect(support).toHaveAttribute('href', '/admin/settings/support');
	}}
/>

<!-- #4596 / PO 回答 (2026-09-03): 支払い猶予中 (S3) の告知。契約はまだ生きているが、
     解約を決める瞬間に「解約後に移る先で履歴がいつまで残るか」が効くため、
     S5 (解約済み) と同じ保持期間の 2 文をここでも述べる。
     猶予 / 停止は Stripe webhook が書く状態で demo 環境では作れないため
     (ss-render-impossible)、見た目の確認手段は本 story が担う。 -->
<Story
	name="GracePeriodNotice"
	args={{
		data: mockData({
			license: { ...BASE_LICENSE, status: SUBSCRIPTION_STATUS.GRACE_PERIOD },
		}),
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const notice = canvas.getByTestId('contract-state-notice');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.gracePeriodTitle);
		// 保持期間の 2 文 (特商法と同一) が出ていること
		await expect(notice).toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.freePlanRetentionNotice);
	}}
/>

<!-- #4596 / PO 回答 (2026-09-03): 支払い停止中 (S4) の告知。S3 と同じ理由で保持期間を述べる。
     契約が残っておりアーカイブはまだ起きていないため、archive の話は持ち込まない。
     PO 決定 (2026-09-04): S4 では物理削除も走らない (`retention-cleanup-service` が skip する)
     ため、「契約が残っている間は削除しない」「表示だけが絞られ復帰で戻る」ことを述べる。 -->
<Story
	name="PaymentSuspendedNotice"
	args={{
		data: mockData({
			license: { ...BASE_LICENSE, status: SUBSCRIPTION_STATUS.SUSPENDED },
		}),
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const notice = canvas.getByTestId('contract-state-notice');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.paymentSuspendedTitle);
		await expect(notice).toHaveTextContent(SUBSCRIPTION_PAGE_LABELS.freePlanRetentionNotice);
		// 削除は起きていない (skip される) ので、現在形で「削除されています」と出さない
		await expect(notice).toHaveTextContent(
			'ご契約が残っているあいだ、これまでの記録を削除することはありません',
		);
		await expect(notice).not.toHaveTextContent('期間を超えた記録から順に削除されています');
	}}
/>
