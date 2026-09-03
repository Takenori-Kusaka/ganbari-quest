<script module>
// #4702: 料金ページ「無料体験をはじめる」→ /auth/signup?plan=X の Google 登録ボタンが plan を
// 引き継ぐことの視認用 story。/auth/signup は dev / local モードで /auth/login に redirect される
// (本番 Cognito 専用) ため実サーバでは描画できない。`?plan=` は $page.url に載るため、
// Storybook では sveltekit_experimental.stores.page で URL を差し込む。
import { defineMeta } from '@storybook/addon-svelte-csf';
import SignupPage from '../routes/auth/signup/+page.svelte';

const { Story } = defineMeta({
	title: 'Pages/AuthSignupGooglePlan',
	component: SignupPage,
	parameters: { layout: 'fullscreen' },
});

/**
 * `?plan=` 付きの page store を差し込む (Storybook の SvelteKit mock)
 * @param {string | null} plan
 */
function pageWithPlan(plan) {
	return {
		sveltekit_experimental: {
			stores: {
				page: { url: new URL(`http://localhost/auth/signup${plan ? `?plan=${plan}` : ''}`) },
			},
		},
	};
}
</script>

<!-- plan なし: Google ボタンは /auth/oauth/google (従来どおり) -->
<Story name="NoPlan" args={{ form: null, data: { devMode: false } }} parameters={pageWithPlan(null)} />

<!-- plan=standard: Google ボタンが ?plan=standard を引き継ぐ (トライアル自動開始の前提) -->
<Story
	name="PlanStandard"
	args={{ form: null, data: { devMode: false } }}
	parameters={pageWithPlan('standard')}
/>

<!-- plan=family: 同上 -->
<Story
	name="PlanFamily"
	args={{ form: null, data: { devMode: false } }}
	parameters={pageWithPlan('family')}
/>

<!-- 無効な plan: 引き継がず既定の登録フロー -->
<Story
	name="InvalidPlanIgnored"
	args={{ form: null, data: { devMode: false } }}
	parameters={pageWithPlan('free')}
/>
