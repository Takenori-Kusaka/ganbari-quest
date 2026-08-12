<script module lang="ts">
// #4538: 内部 ID を表示名のフォールバックにしない (DESIGN.md §6) — その見た目を確認できる場所。
//
// フォールバックが出る条件は「children 一覧から引けない childId を参照している」= データ不整合で、
// 通常運用でも demo 環境 (DATA_SOURCE=demo) でも発生しない。実画面での撮影が原理的にできないため、
// **見た目の確認はこの story で行う** (SS gate の `ss-render-impossible` 宣言が指す先)。
import { defineMeta } from '@storybook/addon-svelte-csf';
import type { ChildId } from '$lib/domain/ids';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import type { Child, ChildChallenge } from '$lib/server/db/types';
import SiblingChallengeComparison from './SiblingChallengeComparison.svelte';

// 表示テキストは labels SSOT 経由 (DESIGN.md §6 Storybook ラベル言語ポリシー)。
const L = STORYBOOK_LABELS.siblingChallengeComparison;

/** ChildChallenge の必須項目を埋める最小 fixture。表示に効くのは childId / 進捗 / completed のみ。 */
function instance(
	id: string,
	childId: string,
	currentValue: number,
	targetValue: number,
	completed: number,
): ChildChallenge {
	return {
		id,
		childId: childId as ChildId,
		title: L.challengeTitle,
		description: null,
		challengeType: 'count',
		periodType: 'weekly',
		startDate: '2026-08-10',
		endDate: '2026-08-16',
		targetConfig: '{}',
		rewardConfig: '{}',
		status: 'active',
		isActive: 1,
		sourceTemplateId: 'auto:weekly',
		currentValue,
		targetValue,
		completed,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		celebrationShownAt: null,
		createdAt: '2026-08-10T00:00:00.000Z',
		updatedAt: '2026-08-10T00:00:00.000Z',
	};
}

function child(id: string, nickname: string): Child {
	return {
		id: id as ChildId,
		nickname,
		age: 8,
		birthDate: null,
		theme: 'default',
		uiMode: 'elementary',
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-08-01T00:00:00.000Z',
		updatedAt: '2026-08-01T00:00:00.000Z',
	};
}

const group = {
	groupKey: 'auto:weekly',
	title: L.challengeTitle,
	description: null,
	startDate: '2026-08-10',
	endDate: '2026-08-16',
	periodType: 'weekly',
	sourceTemplateId: 'auto:weekly',
	instances: [instance('c1', 'child-1', 5, 7, 0), instance('c2', 'child-2', 7, 7, 1)],
	allCompleted: false,
};

const children = [child('child-1', L.firstChildNickname), child('child-2', L.secondChildNickname)];

/** child-2 が children 一覧に無い = 名前を解決できない状態 (データ不整合)。 */
const childrenMissingOne = [child('child-1', L.firstChildNickname)];

// `component` 指定時は Storybook が args でも component を描画するため、meta 既定 args を必ず与える
// (与えないと group が undefined で render error になる)。
const { Story } = defineMeta({
	title: 'Features/Admin/SiblingChallengeComparison',
	component: SiblingChallengeComparison,
	tags: ['autodocs'],
	args: { group, children },
});
</script>

<Story name="Default" />

<!-- child-2 が children 一覧に無い = 名前を解決できない状態。内部 ID ではなく汎用語が出る。 -->
<Story name="Unresolved Child Name" args={{ group, children: childrenMissingOne }} />

<Story
	name="All Completed"
	args={{
		group: {
			...group,
			instances: [instance('c1', 'child-1', 7, 7, 1), instance('c2', 'child-2', 7, 7, 1)],
			allCompleted: true,
		},
		children,
	}}
/>
