<script lang="ts">
import { onMount } from 'svelte';
import { goto, invalidateAll } from '$app/navigation';
import { page } from '$app/state';
import { navigating } from '$app/stores';
import {
	getModeLabels,
	ICON_CHECKLIST,
	ICON_HOME,
	ICON_STATUS,
	ICON_SWITCH,
} from '$lib/domain/icons';
import { CHILD_SHOP_LABELS, PIN_GATE_ONBOARDING_LABELS } from '$lib/domain/labels';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { startAutoSleep } from '$lib/features/auto-sleep';
// #2168: 旧 MilestoneBanner 横長 alert は撤去。Header の bell slot に MilestoneBellButton を注入する。
import MilestoneBellButton from '$lib/features/value-preview/MilestoneBellButton.svelte';
// Issue #2069 POC: ProductionDashboardService を Context に配備する。
// 本 PR では既存 +page.svelte の挙動を変更せず Context インフラのみ noisy なく追加。
// follow-up Issue で各子供ページが getDashboardService() 経由でデータ参照する。
import { setDashboardService } from '$lib/services/context';
import { createProductionDashboardService } from '$lib/services/production/DashboardService';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';
import StampCard from '$lib/ui/components/StampCard.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { loadSoundSettings, SOUND_TIER_CONFIG, soundService } from '$lib/ui/sound';
import { CHILD_TUTORIAL_CHAPTERS } from '$lib/ui/tutorial/tutorial-chapters-child';
import { resetChapters, setChapters, startTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';

let { data, children } = $props();

// Issue #2069 POC: 本番側 ProductionDashboardService を Context に注入。
// 既存 +page.svelte は本 service を未使用 (UI 等価性保護のため)。
// follow-up で page 内 logic を順次 service 経由に置き換える。
// getter 関数を渡すことで data 変化 (navigation 等) に追従できる
// (Svelte 5 state_referenced_locally 警告を回避)。
setDashboardService(
	createProductionDashboardService(() => ({
		child: data.child ?? null,
		todayRecorded: [],
		pointSettings: data.pointSettings,
	})),
);

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'preschool');
const isBaby = $derived(uiMode === 'baby');
// #0289: モード別ラベルを一元定数から取得
const modeLabels = $derived(getModeLabels(uiMode));
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: ICON_HOME, label: 'ホーム' },
	{ href: '/checklist', icon: ICON_CHECKLIST, label: modeLabels.checklist },
	{ href: `/${uiMode}/shop`, icon: CHILD_SHOP_LABELS.navIcon, label: CHILD_SHOP_LABELS.navLabel },
	{ href: `/${uiMode}/status`, icon: ICON_STATUS, label: modeLabels.status },
	{ href: '/switch', icon: ICON_SWITCH, label: modeLabels.switch },
]);

// #1292 自動スリープ設定
// 15 分連続アクティブで /switch にリダイレクト
// 非アクティブ 1 分でタイマーリセット
// バトル中は +2 分の grace period
const AUTO_SLEEP_ACTIVE_MS = 15 * 60 * 1000;
const AUTO_SLEEP_INACTIVE_RESET_MS = 60 * 1000;
const AUTO_SLEEP_BATTLE_GRACE_MS = 2 * 60 * 1000;

// サウンドシステム初期化 + オートリロード + チュートリアル設定
// baby モードは親向け準備ツールのため効果音・チュートリアルを抑制 (#1300)
onMount(() => {
	if (!isBaby) {
		loadSoundSettings();
		soundService.configure(uiMode as UiMode);
		const config = SOUND_TIER_CONFIG[uiMode as UiMode];
		if (config) {
			soundService.preload(config.enabledSounds);
		}
		setChapters(CHILD_TUTORIAL_CHAPTERS);
	}

	// 1分間隔で自動リロード（親の変更を反映）
	const autoReloadTimer = setInterval(() => {
		// バックグラウンドタブやダイアログ表示中はスキップ
		if (document.hidden) return;
		if (document.querySelector('[data-scope="dialog"][data-state="open"]')) return;
		invalidateAll();
	}, 60_000);

	// #1292 自動スリープ + 使用時間記録（baby モード除外）
	let cleanupSleep: (() => void) | undefined;
	if (!isBaby && data.child) {
		const childId = data.child.id;
		let usageSessionId: number | null = null;

		// セッション開始を記録（fire-and-forget）
		fetch('/api/v1/usage', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ childId }),
		})
			.then((res) => res.json())
			.then((json: unknown) => {
				if (
					json &&
					typeof json === 'object' &&
					'id' in json &&
					typeof (json as { id: unknown }).id === 'number'
				) {
					usageSessionId = (json as { id: number }).id;
				}
			})
			.catch(() => {
				// セッション記録失敗は無視（非クリティカル）
			});

		const stopTimer = startAutoSleep({
			activeMs: AUTO_SLEEP_ACTIVE_MS,
			inactiveResetMs: AUTO_SLEEP_INACTIVE_RESET_MS,
			battleGraceMs: AUTO_SLEEP_BATTLE_GRACE_MS,
			onSleep: () => {
				// セッション終了を記録してからリダイレクト
				if (usageSessionId !== null) {
					const sid = usageSessionId;
					fetch('/api/v1/usage', {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ id: sid }),
					}).catch(() => {});
				}
				goto('/switch');
			},
			getPathname: () => page.url.pathname,
		});

		cleanupSleep = () => {
			stopTimer();

			// セッション終了を記録（コンポーネント破棄時）
			if (usageSessionId !== null) {
				const sid = usageSessionId;
				fetch('/api/v1/usage', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: sid }),
				}).catch(() => {});
			}
		};
	}

	return () => {
		clearInterval(autoReloadTimer);
		if (!isBaby) resetChapters();
		cleanupSleep?.();
	};
});

let stampDialogOpen = $state(false);

// #2353 設計欠陥 6: PIN gate 初心者導線 dialog
// data.pinGateOnboardingSeen が false (settings 未保存) のとき初回 mount 時に開く。
// 「今後表示しない」checkbox で確認のうえ閉じる → POST /api/v1/settings/pin-gate-onboarding。
let pinGateOnboardingOpen = $state(!data.pinGateOnboardingSeen && !isBaby);
let dontShowAgainChecked = $state(true);

async function closePinGateOnboarding() {
	pinGateOnboardingOpen = false;
	if (dontShowAgainChecked) {
		try {
			await fetch('/api/v1/settings/pin-gate-onboarding', { method: 'POST' });
		} catch {
			// persist 失敗は無視 (次回 child 画面遷移時に再表示されるだけ)
		}
	}
}

function handleStartChildTutorial() {
	startTutorial();
}
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		{@const hasMilestones = !isBaby && data.milestones && data.milestones.length > 0}
		<Header
			nickname={data.child.nickname}
			totalPoints={data.balance}
			avatarUrl={data.child.avatarUrl}
			pointSettings={data.pointSettings}
			stampProgress={data.stampProgress}
			onStampClick={() => {
				stampDialogOpen = true;
			}}
			onHelpClick={handleStartChildTutorial}
			isPremium={data.isPremium}
		>
			{#snippet notificationSlot()}
				<!-- #2168: MilestoneBanner 横長 alert を撤去し、Header に bell + dot badge を統合。
				     baby モードは祝福 UI 非対象 (ADR-0011 + ADR-0012)。 -->
				{#if hasMilestones && data.child}
					<MilestoneBellButton
						milestones={data.milestones}
						childId={data.child.id}
						{uiMode}
					/>
				{/if}
			{/snippet}
		</Header>
	{/if}

	<main class="relative z-0 pb-20 pt-[var(--sp-sm)]">
		{#if $navigating}
			<div class="px-[var(--sp-md)] py-[var(--sp-sm)] flex flex-col gap-[var(--sp-md)]">
				<div class="skeleton-block h-32 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	{#if !isBaby}
		<BottomNav items={navItems} />
		<TutorialOverlay />
	{/if}
</div>

<!-- Stamp card dialog (opened from header) -->
{#if data.stampCard}
	<Dialog bind:open={stampDialogOpen} size="lg" ariaLabel="スタンプカード">
		<StampCard
			weekStart={data.stampCard.weekStart}
			weekEnd={data.stampCard.weekEnd}
			entries={data.stampCard.entries}
			canStampToday={data.stampCard.canStampToday}
			totalSlots={data.stampCard.totalSlots}
			filledSlots={data.stampCard.filledSlots}
			status={data.stampCard.status}
			redeemedPoints={data.stampCard.redeemedPoints}
		/>
	</Dialog>
{/if}

<!-- #2353 設計欠陥 6: PIN gate 初心者導線 onboarding dialog -->
{#if !isBaby}
	<Dialog bind:open={pinGateOnboardingOpen} title={PIN_GATE_ONBOARDING_LABELS.dialogTitle} size="sm" testid="pin-gate-onboarding-dialog">
		<div class="flex flex-col gap-3">
			<p class="text-sm text-[var(--color-text-primary)] leading-relaxed m-0">{PIN_GATE_ONBOARDING_LABELS.dialogIntro}</p>
			<p class="text-sm text-[var(--color-text-primary)] leading-relaxed m-0">{PIN_GATE_ONBOARDING_LABELS.dialogPinHint}</p>
			<p class="text-xs text-[var(--color-text-muted)] leading-relaxed m-0">{PIN_GATE_ONBOARDING_LABELS.dialogChangePinHint}</p>
			<label class="flex items-center gap-2 mt-2 text-sm cursor-pointer">
				<input type="checkbox" bind:checked={dontShowAgainChecked} data-testid="pin-gate-onboarding-dont-show-again" />
				<span>{PIN_GATE_ONBOARDING_LABELS.dontShowAgain}</span>
			</label>
			<div class="mt-3">
				<Button variant="primary" size="md" fullWidth onclick={closePinGateOnboarding} data-testid="pin-gate-onboarding-close">{PIN_GATE_ONBOARDING_LABELS.close}</Button>
			</div>
		</div>
	</Dialog>
{/if}
