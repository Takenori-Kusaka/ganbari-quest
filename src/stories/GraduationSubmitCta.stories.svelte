<script module>
// #4498: 卒業ページ (/admin/subscription/cancel/graduation) の送信 CTA を視認するための story。
//
// 課金プランの卒業送信は Stripe の解約フローへ直行する。この状態は
// Stripe Customer + STRIPE_SECRET_KEY が揃った環境でしか描画されず、
// SS 撮影環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo、Stripe 無効) では出せない。
// load が返す data をそのまま渡して見た目を確認する (AuthInviteError.stories.svelte と同型)。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { GRADUATION_LABELS } from '$lib/domain/labels';
import GraduationPage from '../routes/(parent)/admin/subscription/cancel/graduation/+page.svelte';

const BASE_DATA = {
	totalPoints: 1300,
	yenAmount: 1300,
	usagePeriodDays: 420,
	nicknameMaxLength: GRADUATION_LABELS.nicknameMaxLength,
	messageMaxLength: GRADUATION_LABELS.messageMaxLength,
};

const { Story } = defineMeta({
	title: 'Pages/GraduationSubmitCta',
	component: GraduationPage,
	parameters: { layout: 'fullscreen' },
});
</script>

<!--
	課金プラン (Stripe Customer あり + Stripe 有効)。
	送信先は Stripe の解約フローなので、CTA は遷移先を名乗る。
-->
<Story
	name="PaidPlan"
	args={{
		data: { ...BASE_DATA, isPaidPlan: true, hasStripeCustomer: true, stripeEnabled: true },
		form: null,
	}}
/>

<!--
	無料プラン。送信先は thanks ページなので、従来どおり卒業の完了を名乗る。
	#4498 修正前は課金プランでもこの名乗りのまま Stripe に到達しなかった
	(顧客は解約完了と誤認し課金が継続した) — その旧表示もこの見た目にあたる。
-->
<Story
	name="FreePlan"
	args={{
		data: { ...BASE_DATA, isPaidPlan: false, hasStripeCustomer: false, stripeEnabled: false },
		form: null,
	}}
/>

<!--
	Stripe 未有効の環境 (self-host 等)。portal へ行けないので名乗りも卒業完了のまま。
	action 側の分岐条件と同じ材料 (hasStripeCustomer && stripeEnabled) で一致させている。
-->
<Story
	name="PaidPlanStripeDisabled"
	args={{
		data: { ...BASE_DATA, isPaidPlan: true, hasStripeCustomer: true, stripeEnabled: false },
		form: null,
	}}
/>
