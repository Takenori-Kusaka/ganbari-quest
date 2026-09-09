<script lang="ts">
// #2821: セットアップ離脱後の再開導線。OnboardingChecklist (/admin 専用) では届かない
// 「親が実際に着地する画面 (/switch・子供ホーム)」と「setup 由来で admin に着地したとき」
// の 2 文脈に最小サイズの再開バナーを出す。完了済みなら描画しない
// (Anti-engagement ADR-0012: 進行中のみ表示)。
//
// **ただし「完了済み」の判定に印を混ぜる** (#4868 adversarial 実測)。`allCompleted` は
// admin checklist の required 5 項目 (children / activities / rewards / checklist /
// child_screen) だけで決まり、ウィザードの印を見ていない。ところがウィザードを歩くと
// step 1〜4 で 4 項目が埋まり、本 PR が足した「あとでやる」で `/switch` に降りて
// 子供の画面を 1 回覗くと `markChildScreenVisited` が最後の 1 項目を埋める。
// → `allCompleted = true` → **バナーが二度と出ない**。印は `/setup/complete` の load で
// しか降りないので立ったまま残り、rules / activities-defaults / challenges /
// **first-adventure** (= コアループそのもの) / complete の 5 step が URL 直打ちだけの
// ものに戻る。**本 PR が足した出口が、本 PR が塞いだ行き止まりを作り直していた。**
//
// PO 決裁 (2026-09-09 Q3) は「印はその人の戻り道そのもの」として掃除しない判断なので、
// 戻り道である以上、**印が立っている間はバナーを出す**のが筋が通る。
//
// `dismissed` は据え置き (明示的に「閉じる」を押した人に出し続けない、ADR-0012)。
// ただし `onboarding_dismissed` は admin の OnboardingChecklist と共有なので、
// admin 側で閉じた親はウィザードへの戻り道も同時に閉じる — 新しい state を持たない
// 範囲での既知の残余。
import { SETUP_RESUME_LABELS } from '$lib/domain/labels';
import type { OnboardingProgress } from '$lib/server/services/onboarding-service';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	onboarding: OnboardingProgress;
	/** 'resume': 着地画面で続きへ誘導 / 'context': setup 由来の admin 文脈バナー */
	variant?: 'resume' | 'context';
}

let { onboarding, variant = 'resume' }: Props = $props();

const next = $derived(onboarding.nextRecommendation);
// 再開先: 次のおすすめ step の href。無ければ /admin (チェックリスト全体) に戻す。
// resume バナーからの遷移には `from=setup` を付与し、着地した admin 画面で文脈バナー
// (variant=context) が出るようにする (「テンプレ追加で着地して迷子」の連鎖を断つ、AC2)。
// 既に query を持つ href には & で連結。/switch (子供画面確認導線) など admin 外 href には付けない。
function withFromSetup(href: string): string {
	if (!href.startsWith('/admin')) return href;
	return href.includes('?') ? `${href}&from=setup` : `${href}?from=setup`;
}
// #4863 (PO 決裁 2026-09-09): ウィザードを歩いている最中なら、続きは **ウィザードへ戻す**。
//
// #2821 が admin の checklist へ誘導していたのは「step 2〜9 が原理的に開かなかった」時代の
// 判断で、当時ウィザードへ戻していたら親を行き止まりに送っていた。#4863 で step 2〜9 が
// 開いた以上、前提が変わっている。checklist は 6 項目しかなく、ウィザード 9 step のうち
// questionnaire / rules / activities-defaults / challenges / first-adventure の **5 つに
// 対応が無い** (とりわけ first-adventure = 親子で最初の 1 件を記録する、はコアループそのもの)。
// admin のままにすると、中断した親にはその 5 つが二度と届かない。
//
// 戻り先は step 連鎖の頭 (`/setup/questionnaire`)。**どこまで歩いたかの新しい state は
// 持たない** — 各 step は 2 周しても二重に積まない (challenges だけ「配信済みは飛ばす」を
// 持つ、`child-challenge-service.findAppliedSetupPresetIds`)。
//
// 印を持たない人 (既存テナント / 歩き終えた人) は従来どおり admin の次の未完了項目へ。
// **面は増えない** — 1 つのバナーが 1 つの条件で行き先を変えるだけ。
const RESUME_WIZARD_HREF = '/setup/questionnaire';
const resumeHref = $derived(
	onboarding.wizardInProgress
		? RESUME_WIZARD_HREF
		: variant === 'resume'
			? withFromSetup(next?.href ?? '/admin')
			: (next?.href ?? '/admin'),
);
</script>

{#if (onboarding.wizardInProgress || !onboarding.allCompleted) && !onboarding.dismissed}
	<div class="setup-resume" data-testid="setup-resume-banner" data-variant={variant} role="status">
		<span class="emoji" aria-hidden="true">{variant === 'context' ? '🧭' : '🚩'}</span>
		<div class="body">
			<p class="title">
				{variant === 'context'
					? SETUP_RESUME_LABELS.contextTitle
					: SETUP_RESUME_LABELS.resumeTitle}
			</p>
			{#if onboarding.wizardInProgress}
				<!-- #4863: 行き先がウィザードなら本文もウィザードの話にする。admin checklist を
				     母数にした「あと N ステップ」と「次は〈checklist 項目名〉」は、9 step の
				     ウィザードへ戻す人には無関係な数字・無関係な項目名になる
				     (CTA だけ差し替えると、親は「次は『活動を追加する』」と読んで押し、
				     アンケート画面に着く)。 -->
				<p class="desc">{SETUP_RESUME_LABELS.wizardResumeDesc}</p>
			{:else if variant === 'context'}
				<p class="desc">
					{SETUP_RESUME_LABELS.contextDesc}{#if next}{SETUP_RESUME_LABELS.nextStepSuffix(
							next.label,
						)}{/if}
				</p>
			{:else}
				<p class="desc">
					{SETUP_RESUME_LABELS.progressText(
						onboarding.completedCount,
						onboarding.totalCount,
					)}{#if next}{SETUP_RESUME_LABELS.nextStepSuffix(next.label)}{/if}
				</p>
			{/if}
		</div>
		<Button
			variant="primary"
			size="sm"
			href={resumeHref}
			data-testid="setup-resume-cta"
		>
			{variant === 'context'
				? SETUP_RESUME_LABELS.backToSetupCta
				: SETUP_RESUME_LABELS.resumeCta}
		</Button>
	</div>
{/if}

<style>
	.setup-resume {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: var(--color-surface-info);
		border: 1px solid var(--color-border-default);
		border-radius: 12px;
	}
	.emoji {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		margin: 0;
		font-weight: 700;
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}
	.desc {
		margin: 2px 0 0 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
