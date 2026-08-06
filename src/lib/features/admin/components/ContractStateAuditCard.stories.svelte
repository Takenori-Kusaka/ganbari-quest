<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ContractStateAuditCard from './ContractStateAuditCard.svelte';

// EPIC #4118 手 3。不正な契約状態 (X1-X4) は demo fixture では作れず実画面 SS が撮れないため、
// 3 状態 (正常 / 問題あり / 上限超過) を Storybook で目視確認できるようにする (#4087)。

/** 分類ごとの件数 (全 key を 0 で持つ)。 */
function counts(overrides = {}) {
	const base = {
		S1: 0,
		S2: 0,
		S3: 0,
		S4: 0,
		S5: 0,
		S6: 0,
		X1: 0,
		X2: 0,
		X3: 0,
		X4: 0,
		UNCLASSIFIED: 0,
	};
	return { ...base, ...overrides };
}

const HEALTHY = {
	counts: counts({ S1: 12, S2: 30, S5: 2 }),
	total: 44,
	problemRows: [],
	truncated: 0,
};

const WITH_PROBLEMS = {
	counts: counts({ S1: 10, S2: 28, X3: 2, X1: 1 }),
	total: 41,
	problemRows: [
		{
			tenantId: '3f9a1c22-0000-4000-8000-000000000001',
			classification: 'X3',
			status: 'active',
			hasPlan: true,
			hasSubscription: true,
			hasPlanExpiresAt: true,
		},
		{
			tenantId: '3f9a1c22-0000-4000-8000-000000000002',
			classification: 'X3',
			status: 'active',
			hasPlan: true,
			hasSubscription: true,
			hasPlanExpiresAt: true,
		},
		{
			tenantId: '3f9a1c22-0000-4000-8000-000000000003',
			classification: 'X1',
			status: 'active',
			hasPlan: true,
			hasSubscription: false,
			hasPlanExpiresAt: false,
		},
	],
	truncated: 0,
};

const TRUNCATED = {
	counts: counts({ S2: 100, X3: 205 }),
	total: 305,
	problemRows: WITH_PROBLEMS.problemRows,
	truncated: 202,
};

const { Story } = defineMeta({
	title: 'Admin/ContractStateAuditCard',
	component: ContractStateAuditCard,
	tags: ['autodocs'],
	args: { audit: HEALTHY },
});
</script>

<!-- 全件正常。母数を出して「監査が動いていない」と読み違えられないようにする -->
<Story name="Healthy" args={{ audit: HEALTHY }} />

<!-- 不正状態あり。#4118 手 2 で直した invoice.paid の X3 が在庫として残っている想定 -->
<Story name="With problems" args={{ audit: WITH_PROBLEMS }} />

<!-- 上限超過。表示は切るが件数は残す (黙って捨てない) -->
<Story name="Truncated" args={{ audit: TRUNCATED }} />
