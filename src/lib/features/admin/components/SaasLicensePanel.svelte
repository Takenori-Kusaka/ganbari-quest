<script lang="ts">
/**
 * SaasLicensePanel.svelte — AWS SaaS 版サブスクリプション画面 (EPIC #2327 / #2330)
 *
 * 既存 /admin/subscription/+page.svelte (旧 /admin/license、940 行) の AWS 用ロジックを分離移行。
 * 主な変更点 (EPIC #2327 子#2330):
 *   1. 「現在のプラン」表示を license.plan → planTier (resolveFullPlanTier 経由) に統一
 *      (header badge との表示矛盾解消、PO 報告 2026-05-20 Q3)
 *   2. 「決済機能は現在準備中です」placeholder 削除
 *      (stripeEnabled false 分岐は production 環境で到達不能、PO 報告 Q2)
 *
 * Epic #2525 Phase 7 PR-L3 (#2818): license key 全廃 (Phase 1 補強 3 #2788) に伴い
 *   ライセンスキー適用 UI section (入力フォーム / 適用ボタン / ヘルプ / 確認ダイアログ /
 *   license.licenseKey 表示行) を完全撤去。subscription 管理 (プラン表示 / 選択 / Stripe Portal /
 *   trial / PIN ゲート / DowngradeResourceSelector) のみ残す。
 *
 * 維持セクション: trial banner / 現在のプラン / プラン選択 /
 *   PIN ゲート / DowngradeResourceSelector / Stripe Customer Portal 遷移
 *
 * #4139: 旧 `/admin/billing` (請求書・支払い管理) を本パネルに統合。プラン・課金の情報と操作を
 *   1 ページに集約し、契約ステータス表示 1 箇所 / 請求管理ページを開くボタン 1 個 /
 *   解約導線 1 本 (`/admin/subscription/cancel`) にする。旧 URL は LEGACY_URL_MAP で救済。
 *
 * 親コンポーネント: /admin/subscription/+page.svelte (薄ラッパー、子#2331)
 */

import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import {
	CONTRACT_STATE,
	CONTRACT_STATE_VIEW,
	canOpenBillingHistory,
	hasActiveContract,
	resolveContractState,
} from '$lib/domain/contract-state-view';
import type { DowngradePreview } from '$lib/domain/downgrade-types';
import { getActionErrorDisplay } from '$lib/domain/errors';
import type { ActivityId, ChildId } from '$lib/domain/ids';
import {
	ACTION_LABELS,
	APP_LABELS,
	BILLING_LABELS,
	OYAKAGI_LABELS,
	PAGE_TITLES,
	SUBSCRIPTION_PAGE_LABELS,
	TRIAL_LABELS,
} from '$lib/domain/labels';
import { getLicenseHighlights } from '$lib/domain/plan-features';
import DowngradeResourceSelector from '$lib/features/admin/components/DowngradeResourceSelector.svelte';
import PlanStatusCard from '$lib/features/admin/components/PlanStatusCard.svelte';
import ChurnPreventionModal from '$lib/features/loyalty/ChurnPreventionModal.svelte';
import LoyaltyBadge from '$lib/features/loyalty/LoyaltyBadge.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data } = $props();

const license = $derived(data.license);
// EPIC #2327 子#2330 AC3: stripeEnabled false 分岐 (placeholder) は撤去したが、
// hasSubscription / plan card 制御で stripeEnabled が必要なため derived は維持。
const stripeEnabled = $derived(data.stripeEnabled);
const planTier = $derived(data.planTier ?? 'free');
const planStats = $derived(data.planStats);
const trialStatus = $derived(data.trialStatus);
// #771: プラン変更時の二段階確認 (PIN 設定済みなら PIN 必須、未設定なら確認フレーズ)
const pinConfigured = $derived(data.pinConfigured);
// #736: 解約時のダウングレード先 (free) の保持期間。PLAN_LIMITS 由来の動的値。
const downgradeRetentionDays = $derived(data.downgradeRetentionDays);
const churnLostRetentionLabel = $derived(
	downgradeRetentionDays === null || downgradeRetentionDays === undefined
		? null
		: SUBSCRIPTION_PAGE_LABELS.churnLostRetentionDays(downgradeRetentionDays),
);

// #3991: 期末解約 (cancel_at_period_end) の予約状態。SSOT は Stripe (NFR-2) で、
// page load が `getCancellationState()` 経由で都度取得する。null = 契約なし / 取得失敗。
const cancellation = $derived(data.cancellation ?? null);
const cancelPending = $derived(cancellation?.cancelAtPeriodEnd === true);
const cancelPeriodEndDate = $derived(
	cancellation?.currentPeriodEnd
		? new Date(cancellation.currentPeriodEnd).toLocaleDateString('ja-JP', {
				timeZone: 'Asia/Tokyo',
			})
		: '',
);
let revertSubmitting = $state(false);
let revertError = $state('');

async function handleRevertCancellation() {
	if (revertSubmitting) return;
	revertSubmitting = true;
	revertError = '';
	try {
		const res = await fetch('/api/v1/admin/tenant/reactivate', { method: 'POST' });
		const body = (await res.json()) as { error?: string };
		if (!res.ok) throw new Error(body.error ?? SUBSCRIPTION_PAGE_LABELS.cancelPendingRevertError);
		await invalidateAll();
	} catch (err) {
		revertError =
			err instanceof Error ? err.message : SUBSCRIPTION_PAGE_LABELS.cancelPendingRevertError;
	} finally {
		revertSubmitting = false;
	}
}

let checkoutLoading = $state(false);
let portalLoading = $state(false);
// #2941 項目 2 (#3033 で TrialBanner not-started form から本 panel へ移植):
// startTrial の fail(400) (trialUsed=true 再押下等) をユーザーに見える形で表示する
// (NN/G #1 visibility of system status)。getActionErrorDisplay (#2913) 経路。
let trialSubmitting = $state(false);
let trialStartError = $state('');
let showChurnModal = $state(false);
let selectedTier = $state<'standard' | 'family'>('standard');
// #3204: 年額は #2719 で廃止確定 (checkout が yearly を reject)。月額固定にし、年額トグル UI を撤去。
// #3204: checkout 失敗時のエラーメッセージ (silent no-op 撲滅、Toast と併用の in-page banner)
let checkoutError = $state<string | null>(null);
// #4161: 決済未設定 (stripeEnabled=false) の配備でアップグレード操作を押したときの説明文。
// `checkoutError` の Alert は `{#if stripeEnabled}` ブロック内にしか無く、決済未設定時は
// 画面に何も出ないため、ブロック外に出す専用 state を分けている。
let billingUnavailable = $state<string | null>(null);

// #771 Portal を開く前の PIN / 確認フレーズ入力
const DOWNGRADE_CONFIRM_PHRASE = 'プランを変更します';
// #4156: 同じ Portal でも「プランを変えに行く」のか「領収書を見に行く」のかで、
// 顧客が確認ダイアログで読むべき文が違う。確認フレーズ自体はサーバー契約
// (`/api/stripe/portal` の CONFIRM_PHRASE_REQUIRED) と同値である必要があるため変えない。
let portalIntent = $state<'plan-change' | 'billing-history'>('plan-change');
let showPortalConfirm = $state(false);
let portalPinValue = $state('');
let portalConfirmPhrase = $state('');
let portalError = $state<string | null>(null);

// #738 ダウングレード前警告フロー
let downgradePreview = $state<DowngradePreview | null>(null);
let showDowngradeSelector = $state(false);
let downgradeLoading = $state(false);
let downgradeError = $state<string | null>(null);

// EPIC #2327 子#2330 AC2: 表示矛盾解消。
// 旧実装は license.plan (Stripe subscription tier) を表示していたため、NUC や free 状態で
// header badge の planTier (resolveFullPlanTier 経由) と矛盾していた。
// 新実装は data.planTier を SSOT として直接ラベル化し、header と必ず一致させる。
const planTierLabel = $derived.by(() => {
	switch (planTier) {
		case 'standard':
			return SUBSCRIPTION_PAGE_LABELS.planLabelMonthly;
		case 'family':
			return SUBSCRIPTION_PAGE_LABELS.planLabelFamilyMonthly;
		case 'free':
			return SUBSCRIPTION_PAGE_LABELS.planLabelFree;
		default:
			return SUBSCRIPTION_PAGE_LABELS.planLabelFree;
	}
});

const planLabel = (plan: string) => {
	switch (plan) {
		case SUBSCRIPTION_PLAN.MONTHLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelMonthly;
		case SUBSCRIPTION_PLAN.YEARLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelYearly;
		case SUBSCRIPTION_PLAN.FAMILY_MONTHLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelFamilyMonthly;
		case SUBSCRIPTION_PLAN.FAMILY_YEARLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelFamilyYearly;
		case SUBSCRIPTION_PLAN.LIFETIME:
			return SUBSCRIPTION_PAGE_LABELS.planLabelLifetime;
		case 'free':
			return SUBSCRIPTION_PAGE_LABELS.planLabelFree;
		default:
			return plan;
	}
};

const statusLabel = (status: string, churned: boolean) => {
	// #4156: `suspended` は 2 状態を兼ねる (contract-state-matrix §4)。契約が残る S4 は「停止中」、
	// 解約が確定した S5 は「解約済み」。区別せず「停止中」と出すと、解約した顧客に
	// 「まだ何か止まっているだけ」と読める表示を返し続けることになる。
	if (status === SUBSCRIPTION_STATUS.SUSPENDED && churned) {
		return {
			text: SUBSCRIPTION_PAGE_LABELS.statusCancelled,
			color: 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
			icon: '✅',
		};
	}
	switch (status) {
		case SUBSCRIPTION_STATUS.ACTIVE:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusActive,
				color:
					'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]',
				icon: '✅',
			};
		case SUBSCRIPTION_STATUS.GRACE_PERIOD:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusGracePeriod,
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⚠️',
			};
		case SUBSCRIPTION_STATUS.SUSPENDED:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusSuspended,
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⏸️',
			};
		case SUBSCRIPTION_STATUS.TERMINATED:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusTerminated,
				color: 'bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]',
				icon: '❌',
			};
		default:
			return {
				text: status,
				color: 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
				icon: '❓',
			};
	}
};

// #4156: 契約状態 (contract-state-matrix §4 の S1〜S5) を 1 箇所で解決する。
// 画面の分岐を「契約の有無」だけに畳むと、寿命の違う `stripeCustomerId` (過去の取引) を
// 巻き添えで隠してしまう — それが本 Issue の退行 1 だった。
const contractState = $derived(
	resolveContractState({
		status: license.status,
		stripeSubscriptionId: license.stripeSubscriptionId,
		cancelAtPeriodEnd: cancelPending,
	}),
);
const contractStateNotice = $derived(
	contractState ? CONTRACT_STATE_VIEW[contractState].statusNotice : null,
);
const hasSubscription = $derived(hasActiveContract(license));
const status = $derived(statusLabel(license.status, contractState === CONTRACT_STATE.CANCELLED));
// #4156: 請求書・領収書は **過去の取引** に紐づくため、契約 (`stripeSubscriptionId`) ではなく
// 顧客 (`stripeCustomerId`) の有無で到達性を決める。サーバー側の `createPortalSession` も
// 同じ軸で判定しており (`NO_STRIPE_CUSTOMER`)、UI 側だけが厳しい状態を解消する。
// `stripeEnabled` では絞らない: customer が存在する = かつて決済が有効だった配備であり、
// いま無効なら requestPortal() が理由を提示して打ち切る (#4161 と同じ扱い、dead-end は作らない)。
const billingHistoryAvailable = $derived(canOpenBillingHistory(license) && !hasSubscription);

async function startCheckout(planId: string) {
	checkoutLoading = true;
	checkoutError = null;
	try {
		const res = await fetch('/api/stripe/checkout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId }),
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok && data.url) {
			window.location.href = data.url;
			return;
		}
		// #3204: silent no-op 撲滅。非 2xx / url 欠落時はサーバーメッセージを必ず提示する
		// (decision 機能無効 = STRIPE_DISABLED は「決済機能は現在利用できません」、
		//  INVALID_PLAN 等も同様)。demo/staging で押下しても無反応にしない。
		const message =
			typeof data?.message === 'string' && data.message
				? data.message
				: SUBSCRIPTION_PAGE_LABELS.checkoutFailed;
		checkoutError = message;
		showToast(SUBSCRIPTION_PAGE_LABELS.checkoutFailedToastTitle, message, 'error');
	} catch {
		checkoutError = SUBSCRIPTION_PAGE_LABELS.checkoutFailed;
		showToast(
			SUBSCRIPTION_PAGE_LABELS.checkoutFailedToastTitle,
			SUBSCRIPTION_PAGE_LABELS.checkoutFailed,
			'error',
		);
	} finally {
		checkoutLoading = false;
	}
}

// #4139: プラン利用状況カード (PlanStatusCard) のアップグレード CTA を実処理に接続する。
// 未接続だと CTA は `/admin/subscription` (= このページ自身) へのリンクにフォールバックし、
// 押しても何も起きない自己リンクになる (本番実機 2026-07-31 PO 確認)。
//
// 契約状態で経路が分かれる:
//   - 契約なし   → Stripe Checkout (新規契約)
//   - 契約あり   → Stripe 請求管理ページ (プラン変更)。checkout は ALREADY_SUBSCRIBED (409) で
//                  弾かれるため、上位プランへの変更は Portal 経由が唯一の正しい経路。
//                  PIN ゲート + 超過リソース確認も requestPortal() が担う。
//
// #4161: 決済が有効でない配備 (セルフホスト / STRIPE_SECRET_KEY 未設定の本番) では、
//   どちらの経路も最後まで到達できない。プラン管理カードは `{#if stripeEnabled}` で
//   隠れているのに PlanStatusCard の CTA と確認ダイアログはブロックの外にあるため、
//   放置すると「PIN を入れて確定した末に失敗する」dead-end (#2544 型) が成立する。
//   押した時点で理由を提示して打ち切る (silent no-op も作らない、#3204 整合)。
function handlePlanUpgrade(planId: string) {
	if (!stripeEnabled) {
		notifyBillingUnavailable();
		return;
	}
	if (hasSubscription) {
		requestPlanChange();
		return;
	}
	void startCheckout(planId);
}

// #738: ダウングレードプレビュー取得
async function fetchDowngradePreview() {
	downgradeLoading = true;
	downgradeError = null;
	try {
		const res = await fetch('/api/v1/admin/downgrade-preview?targetTier=free');
		if (!res.ok) {
			downgradeError = 'ダウングレード情報の取得に失敗しました';
			return null;
		}
		return await res.json();
	} catch {
		downgradeError = 'ダウングレード情報の取得に失敗しました';
		return null;
	} finally {
		downgradeLoading = false;
	}
}

// #738: ダウングレード用リソースアーカイブを実行
async function executeDowngradeArchive(selection: {
	childIds: ChildId[];
	activityIds: ActivityId[];
	checklistTemplateIds: string[];
}) {
	downgradeLoading = true;
	downgradeError = null;
	try {
		const res = await fetch('/api/v1/admin/downgrade-archive', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetTier: 'free',
				...selection,
			}),
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			downgradeError =
				(body as { message?: string }).message ?? SUBSCRIPTION_PAGE_LABELS.downgradeArchiveError;
			return false;
		}
		return true;
	} catch {
		downgradeError = 'リソースのアーカイブに失敗しました';
		return false;
	} finally {
		downgradeLoading = false;
	}
}

// #4161: 決済未設定を伝える単一箇所 (Toast + in-page banner の 2 層、ADR-0062 / #3204 整合)
function notifyBillingUnavailable() {
	billingUnavailable = SUBSCRIPTION_PAGE_LABELS.billingUnavailable;
	showToast(
		SUBSCRIPTION_PAGE_LABELS.billingUnavailableToastTitle,
		SUBSCRIPTION_PAGE_LABELS.billingUnavailable,
		'error',
	);
}

// #4156: 確認ダイアログの見出し / 説明 / 実行ボタンは Portal を開く目的で切り替える。
const portalConfirmTitle = $derived(
	portalIntent === 'billing-history'
		? SUBSCRIPTION_PAGE_LABELS.portalConfirmTitleBillingHistory
		: SUBSCRIPTION_PAGE_LABELS.portalConfirmTitle,
);
const portalConfirmDesc = $derived(
	portalIntent === 'billing-history'
		? SUBSCRIPTION_PAGE_LABELS.portalConfirmDescBillingHistory
		: SUBSCRIPTION_PAGE_LABELS.portalConfirmDesc,
);
const portalConfirmSubmit = $derived(
	portalIntent === 'billing-history'
		? SUBSCRIPTION_PAGE_LABELS.portalConfirmSubmitBillingHistory
		: SUBSCRIPTION_PAGE_LABELS.portalConfirmSubmit,
);

/** #4156: 契約操作 (プラン変更 / 支払い方法) の目的で Portal を開く */
function requestPlanChange() {
	portalIntent = 'plan-change';
	void requestPortal();
}

/** #4156: 請求履歴を見る目的で Portal を開く (契約操作ではない) */
function requestBillingHistory() {
	portalIntent = 'billing-history';
	void requestPortal();
}

// #771 + #738: Portal 遷移前ダイアログ
async function requestPortal() {
	// #4161: 確認ダイアログは `{#if stripeEnabled}` の外にあるため、requestPortal() を
	//   呼ぶ全経路 (PlanStatusCard CTA / 請求管理ボタン / ダウングレード選択後) で塞ぐ。
	if (!stripeEnabled) {
		notifyBillingUnavailable();
		return;
	}
	billingUnavailable = null;
	portalPinValue = '';
	portalConfirmPhrase = '';
	portalError = null;

	if (planTier !== 'free') {
		const preview = await fetchDowngradePreview();
		if (preview?.hasExcess) {
			downgradePreview = preview;
			showDowngradeSelector = true;
			return;
		}
	}

	showPortalConfirm = true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: PIN ゲート + Portal 遷移の集中ロジックのため
async function openPortal() {
	portalError = null;

	// #4161: ChurnPreventionModal の「解約する」からは requestPortal() を経由せず直接呼ばれる。
	//   決済未設定の配備で押しても Portal へは行けないため、ここでも同じ理由を返す。
	if (!stripeEnabled) {
		notifyBillingUnavailable();
		return;
	}

	if (pinConfigured) {
		if (
			!portalPinValue ||
			portalPinValue.length < 4 ||
			portalPinValue.length > 6 ||
			!/^\d+$/.test(portalPinValue)
		) {
			portalError = OYAKAGI_LABELS.formatError;
			return;
		}
	} else {
		if (portalConfirmPhrase !== DOWNGRADE_CONFIRM_PHRASE) {
			portalError = SUBSCRIPTION_PAGE_LABELS.portalConfirmPhraseError(DOWNGRADE_CONFIRM_PHRASE);
			return;
		}
	}

	portalLoading = true;
	try {
		const res = await fetch('/api/stripe/portal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(
				pinConfigured ? { pin: portalPinValue } : { confirmPhrase: portalConfirmPhrase },
			),
		});
		if (!res.ok) {
			let message: string = SUBSCRIPTION_PAGE_LABELS.portalFetchError;
			try {
				const body = (await res.json()) as { message?: string };
				const raw = body.message ?? '';
				if (raw === 'INVALID_PIN' || raw === 'PIN_REQUIRED') {
					message = OYAKAGI_LABELS.invalidError;
				} else if (raw.startsWith('LOCKED_OUT')) {
					message = OYAKAGI_LABELS.lockedError;
				} else if (raw === 'CONFIRM_PHRASE_REQUIRED') {
					message = SUBSCRIPTION_PAGE_LABELS.portalConfirmPhraseError(DOWNGRADE_CONFIRM_PHRASE);
				} else if (raw) {
					message = raw;
				}
			} catch {
				/* noop */
			}
			portalError = message;
			portalPinValue = '';
			return;
		}
		const body = (await res.json()) as { url?: string };
		if (body.url) {
			window.location.href = body.url;
		}
	} catch (err) {
		portalError = err instanceof Error ? err.message : SUBSCRIPTION_PAGE_LABELS.portalFetchError;
	} finally {
		portalLoading = false;
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.license}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<!-- #4161: アップグレード CTA の分岐を決めるのはこの 2 変数だけ (handlePlanUpgrade)。
     受け入れテストが「いまどちらの経路を検証しているか」を実際に読んで表明できるよう、
     DOM に出す (結末を or で並べて、どちらが走ったか誰にも見えない形を作らない)。 -->
<div
	class="space-y-6"
	data-testid="saas-license-panel"
	data-stripe-enabled={stripeEnabled ? 'true' : 'false'}
	data-has-subscription={hasSubscription ? 'true' : 'false'}
>
	<!-- #3991: 解約 (期末解約) 申請中バナー + 取り消し導線。
	     「いつまで使えるか」を親が画面で再確認できる唯一の場所であり、
	     解約完了メールの猶予期限と同じ日付 (Stripe の請求期間終了日) を示す。 -->
	{#if cancelPending}
		<section
			class="bg-[var(--color-feedback-warning-bg)] rounded-xl p-4 border border-[var(--color-feedback-warning-border)]"
			data-testid="subscription-cancel-pending-banner"
		>
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">
				{SUBSCRIPTION_PAGE_LABELS.cancelPendingTitle}
			</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)] mb-3">
				{cancelPeriodEndDate
					? SUBSCRIPTION_PAGE_LABELS.cancelPendingDesc(cancelPeriodEndDate)
					: SUBSCRIPTION_PAGE_LABELS.cancelPendingDescUnknownDate}
			</p>
			{#if revertError}
				<Alert variant="danger" message={revertError} />
			{/if}
			<Button
				type="button"
				variant="success"
				size="md"
				loading={revertSubmitting}
				onclick={handleRevertCancellation}
				data-testid="subscription-cancel-revert"
			>
				{revertSubmitting
					? SUBSCRIPTION_PAGE_LABELS.cancelPendingRevertSubmitting
					: SUBSCRIPTION_PAGE_LABELS.cancelPendingRevertAction}
			</Button>
		</section>
	{/if}

	<!-- 現在のプラン -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4" data-tutorial="subscription-current-plan">{SUBSCRIPTION_PAGE_LABELS.currentPlanTitle}</h3>

		<div class="grid gap-4">
			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanLabel}</span>
				<!-- EPIC #2327 子#2330 AC2: planTier SSOT 統一 -->
				<span class="text-sm font-semibold text-[var(--color-text-primary)]" data-testid="saas-current-plan">{planTierLabel}</span>
			</div>

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanStatus}</span>
				<span class="text-xs font-medium px-2.5 py-1 rounded-full {status.color}">
					{status.icon} {status.text}
				</span>
			</div>

			{#if cancelPending && cancelPeriodEndDate}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]" data-testid="subscription-cancel-period-end">
					<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.cancelPendingExpiryLabel}</span>
					<span class="text-sm text-[var(--color-text-primary)]">{cancelPeriodEndDate}</span>
				</div>
			{:else if license.planExpiresAt}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanExpiry}</span>
					<span class="text-sm text-[var(--color-text-primary)]">
						{new Date(license.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanFamilyName}</span>
				<span class="text-sm text-[var(--color-text-primary)]">{license.tenantName}</span>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanCreatedAt}</span>
				<span class="text-sm text-[var(--color-text-primary)]">
					{new Date(license.createdAt).toLocaleDateString('ja-JP')}
				</span>
			</div>
		</div>
		{/snippet}
	</Card>

	<!-- プラン利用状況 -->
	{#if planStats}
		<PlanStatusCard
			{planTier}
			activityCount={planStats.activityCount}
			activityMax={planStats.activityMax}
			childCount={planStats.childCount}
			childMax={planStats.childMax}
			retentionDays={planStats.retentionDays}
			{trialStatus}
			onUpgrade={handlePlanUpgrade}
			upgradeLoading={checkoutLoading || portalLoading}
		/>
	{/if}

	<!-- #4161: 決済未設定の配備でアップグレード操作を押したときの理由表示。
	     `checkoutError` の Alert は `{#if stripeEnabled}` の内側にあり決済未設定時は描画されないため、
	     ここ (ブロック外) に置く。確認ダイアログは開かない = dead-end を作らない。 -->
	{#if billingUnavailable}
		<div data-testid="billing-unavailable-alert">
			<Alert variant="warning" message={billingUnavailable} />
		</div>
	{/if}

	<!-- 無料トライアル -->
	{#if planTier === 'free' && trialStatus}
		<Card variant="default" padding="lg">
			{#snippet children()}
			{#if trialStatus.isTrialActive}
				<div class="text-center">
					<p class="text-sm font-semibold text-[var(--color-feedback-info-text)] mb-1">
						{SUBSCRIPTION_PAGE_LABELS.trialActiveTitle}
					</p>
					<p class="text-2xl font-bold text-[var(--color-feedback-info-text)]">
						{SUBSCRIPTION_PAGE_LABELS.trialActiveDays(trialStatus.daysRemaining)}
					</p>
					<p class="text-xs text-[var(--color-text-tertiary)] mt-1">
						{SUBSCRIPTION_PAGE_LABELS.trialActiveUntil(trialStatus.trialEndDate)}
					</p>
				</div>
			{:else if !trialStatus.trialUsed}
				<div class="text-center">
					<p class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
						{SUBSCRIPTION_PAGE_LABELS.trialStartTitle}
					</p>
					<p class="text-sm text-[var(--color-text-muted)] mb-4">
						{SUBSCRIPTION_PAGE_LABELS.trialStartDesc}
					</p>
					<form
						method="POST"
						action="?/startTrial"
						use:enhance={() => {
							trialSubmitting = true;
							trialStartError = '';
							return async ({ result, update }) => {
								await update({ reset: false });
								if (result.type === 'success') {
									await invalidateAll();
								} else if (result.type === 'failure') {
									// #2941 item 2: fail(400) must be visible to the user (NN/G #1)
									trialStartError = getActionErrorDisplay(
										result.data?.error,
										TRIAL_LABELS.startErrorFallback,
									).message;
								}
								trialSubmitting = false;
							};
						}}
					>
						<Button
							type="submit"
							variant="primary"
							size="md"
							class="w-full"
							loading={trialSubmitting}
							data-testid="subscription-start-trial-button"
						>
							{trialSubmitting
								? ACTION_LABELS.submitting
								: SUBSCRIPTION_PAGE_LABELS.trialStartButton}
						</Button>
					</form>
					{#if trialStartError}
						<p
							class="text-xs font-semibold text-[var(--color-feedback-error-text)] mt-2"
							role="alert"
							data-testid="subscription-start-trial-error"
						>
							{trialStartError}
						</p>
					{/if}
					<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
						{SUBSCRIPTION_PAGE_LABELS.trialStartNote}
					</p>
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.trialUsed}
				</p>
			{/if}
			{/snippet}
		</Card>
	{/if}

	<!-- サポーターバッジ -->
	{#if data.loyaltyInfo && data.loyaltyInfo.subscriptionMonths > 0}
		<LoyaltyBadge
			subscriptionMonths={data.loyaltyInfo.subscriptionMonths}
			memoryTickets={data.loyaltyInfo.memoryTickets}
			currentTierName={data.loyaltyInfo.currentTier.name}
			nextTierMonths={data.loyaltyInfo.nextTier?.months ?? null}
			nextTierRemaining={data.loyaltyInfo.nextTier?.remaining ?? null}
			tiers={data.loyaltyInfo.tiers}
			loginBonusMultiplier={data.loyaltyInfo.loginBonusMultiplier}
		/>
	{/if}

	<!-- ステータス別メッセージ -->
	<!-- #4156: 文言は `contract-state-view.ts` の対応表を SSOT とする。表は認可の実挙動
	     (`authorization.ts`) と対で test に固定されており、片方だけ変えると CI が落ちる。 -->
	{#if contractStateNotice}
		<section
			class="rounded-xl p-4 border"
			class:notice-warning={contractStateNotice.tone === 'warning'}
			class:notice-info={contractStateNotice.tone === 'info'}
			data-testid="contract-state-notice"
			data-contract-state={contractState}
		>
			<h3 class="text-sm font-semibold mb-1">{contractStateNotice.title}</h3>
			<p class="text-sm">
				{contractStateNotice.desc}
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.TERMINATED}
		<section class="bg-[var(--color-feedback-error-bg)] rounded-xl p-4 border border-[var(--color-feedback-error-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-error-text)] mb-1">{SUBSCRIPTION_PAGE_LABELS.terminatedTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-error-text)]">
				{SUBSCRIPTION_PAGE_LABELS.terminatedDesc}
			</p>
		</section>
	{/if}

	<!-- プラン管理 -->
	<!-- EPIC #2327 子#2330 AC3: stripeEnabled false 分岐 placeholder「決済機能は現在準備中です」削除 -->
	{#if stripeEnabled}
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4" data-tutorial="subscription-plan-management">{SUBSCRIPTION_PAGE_LABELS.planManagementTitle}</h3>

		{#if hasSubscription}
			<!-- サブスクリプション有り → Stripe Customer Portal で管理 (#771: PIN 再確認ゲート付き) -->
			<!-- #4139: 旧 /admin/billing の「請求書・支払い方法」セクションを統合。
			     請求管理ページを開くボタンはこの 1 箇所のみ (同じ出口を複数置かない)。 -->
			<div class="grid gap-3">
				<p class="text-sm text-[var(--color-text-muted)]">
					{BILLING_LABELS.billingPortalDesc}
				</p>
				<ul class="portal-feature-list">
					<li>{BILLING_LABELS.featureInvoices}</li>
					<li>{BILLING_LABELS.featurePaymentMethod}</li>
					<li>{BILLING_LABELS.featurePlanSwitch}</li>
					<li>{BILLING_LABELS.featureNextBilling}</li>
				</ul>
				<Button
					onclick={requestPlanChange}
					disabled={portalLoading}
					variant="primary"
					size="md"
					class="w-full"
					data-testid="open-portal-button"
				>
					{SUBSCRIPTION_PAGE_LABELS.portalButton(portalLoading)}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.portalNote}
				</p>
				<p class="text-xs text-[var(--color-feedback-warning-text)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.portalPinNote(pinConfigured)}
				</p>
			</div>
		{:else}
			<!-- サブスクリプション無し → プラン選択 -->
			<div class="grid gap-4">
				<!-- #3204: 年額トグル撤去 (年額は #2719 で廃止確定、checkout が reject)。月額固定。 -->
				<!-- PLAN_LABELS.standard -->
				<div
					class="plan-card"
					class:selected={selectedTier === 'standard'}
					role="button"
					tabindex="0"
					data-testid="standard-plan-card"
					onclick={() => (selectedTier = 'standard')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'standard')}
				>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">{SUBSCRIPTION_PAGE_LABELS.standardPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPlanDesc}</p>
						</div>
						<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{SUBSCRIPTION_PAGE_LABELS.standardPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPerMonth}</span></p>
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('standard') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- PLAN_LABELS.family -->
				<div
					class="plan-card"
					class:selected={selectedTier === 'family'}
					class:recommended={true}
					role="button"
					tabindex="0"
					data-testid="family-plan-card"
					onclick={() => (selectedTier = 'family')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'family')}
				>
					<span class="recommend-badge">{SUBSCRIPTION_PAGE_LABELS.familyRecommendBadge}</span>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">{SUBSCRIPTION_PAGE_LABELS.familyPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.familyPlanDesc}</p>
						</div>
						<p class="text-xl font-bold text-[var(--color-stat-purple)]">{SUBSCRIPTION_PAGE_LABELS.familyPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPerMonth}</span></p>
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('family') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- 購入ボタン -->
				<Button
					onclick={() =>
						startCheckout(
							selectedTier === 'family'
								? SUBSCRIPTION_PLAN.FAMILY_MONTHLY
								: SUBSCRIPTION_PLAN.MONTHLY,
						)}
					loading={checkoutLoading}
					variant="primary"
					size="md"
					class="w-full"
				>
					{SUBSCRIPTION_PAGE_LABELS.checkoutButton(selectedTier, checkoutLoading)}
				</Button>

				<!-- #3204: checkout 失敗時の in-page banner (Toast との 2 層 feedback、silent no-op 撲滅) -->
				{#if checkoutError}
					<Alert variant="danger" message={checkoutError} />
				{/if}

				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.checkoutNote}
				</p>
			</div>
		{/if}
		{/snippet}
	</Card>
	{/if}

	<!-- 請求履歴 (#4156) — 契約が終わっても過去の取引は残る。
	     契約中は上の「プラン管理」の Portal ボタンが請求書も含めて担うため、
	     ここは契約が無い顧客 (解約済み) にだけ出す。出口は同時に 1 つだけ (統合 #4139 の原則を維持)。
	     特商法の表示義務に接続する導線であり、解約理由の送信を経由させない。 -->
	{#if billingHistoryAvailable}
		<Card variant="default" padding="lg">
			{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{SUBSCRIPTION_PAGE_LABELS.billingHistoryTitle}</h3>
			<div class="grid gap-3" data-testid="billing-history-section">
				<p class="text-sm text-[var(--color-text-muted)]">
					{SUBSCRIPTION_PAGE_LABELS.billingHistoryDesc}
				</p>
				<ul class="portal-feature-list">
					<li>{SUBSCRIPTION_PAGE_LABELS.billingHistoryFeatureInvoices}</li>
					<li>{SUBSCRIPTION_PAGE_LABELS.billingHistoryFeatureReceipts}</li>
				</ul>
				<Button
					onclick={requestBillingHistory}
					disabled={portalLoading}
					variant="secondary"
					size="md"
					class="w-full"
					data-testid="open-billing-history-button"
				>
					{SUBSCRIPTION_PAGE_LABELS.billingHistoryButton(portalLoading)}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.billingHistoryNote}
				</p>
				<p class="text-xs text-[var(--color-feedback-warning-text)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.billingHistoryPinNote(pinConfigured)}
				</p>
			</div>
			{/snippet}
		</Card>
	{/if}

	<!-- #4139: 解約導線。旧 /admin/billing の「解約手続き」リンクを統合先に移設する
	     (プラン・課金の操作を 1 ページに集約したため、ここが唯一の解約入口)。
	     Kinde frictionless 整合で控えめ表示 (Phase 3 #2567 §FR-5)。 -->
	<div class="subscription-cancel-row">
		<a
			href="/admin/subscription/cancel"
			class="subscription-cancel-link"
			data-testid="subscription-to-cancel"
		>
			{SUBSCRIPTION_PAGE_LABELS.cancelLink}
		</a>
	</div>

	<!-- #771: プラン変更 (Stripe Portal) 前の二段階確認ダイアログ
	     #4156: 請求履歴を見に行くときは目的が違うため、見出しと説明を差し替える
	     (確認フレーズはサーバー契約と同値である必要があるため共通)。 -->
	<Dialog bind:open={showPortalConfirm} title={portalConfirmTitle}>
		{#snippet children()}
		<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
			<p>
				{portalConfirmDesc}
			</p>
			<p class="text-[var(--color-feedback-warning-text)] font-semibold">
				{SUBSCRIPTION_PAGE_LABELS.portalConfirmWarning}{pinConfigured ? OYAKAGI_LABELS.inputLabel : SUBSCRIPTION_PAGE_LABELS.portalConfirmWarningPhrase}{SUBSCRIPTION_PAGE_LABELS.portalConfirmWarningPin}
			</p>

			{#if pinConfigured}
				<div class="space-y-2">
					<label for="portal-pin" class="block text-sm font-medium text-[var(--color-text-primary)]">
						{OYAKAGI_LABELS.inputLabel}
					</label>
					<input
						id="portal-pin"
						type="password"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength={6}
						minlength={4}
						bind:value={portalPinValue}
						placeholder={OYAKAGI_LABELS.inputPlaceholder}
						autocomplete="off"
						data-testid="portal-pin-input"
						class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
					/>
				</div>
			{:else}
				<div class="space-y-2">
					<label for="portal-confirm-phrase" class="block text-sm font-medium text-[var(--color-text-primary)]">
						{SUBSCRIPTION_PAGE_LABELS.portalConfirmPhraseLabel(DOWNGRADE_CONFIRM_PHRASE)}
					</label>
					<input
						id="portal-confirm-phrase"
						type="text"
						bind:value={portalConfirmPhrase}
						placeholder={DOWNGRADE_CONFIRM_PHRASE}
						autocomplete="off"
						data-testid="portal-confirm-phrase-input"
						class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
					/>
				</div>
			{/if}

			{#if portalError}
				<Alert variant="danger">
					{#snippet children()}
					{portalError}
					{/snippet}
				</Alert>
			{/if}
		</div>
		<div class="mt-4 flex justify-end gap-2">
			<Button
				type="button"
				variant="secondary"
				size="md"
				onclick={() => {
					showPortalConfirm = false;
					portalPinValue = '';
					portalConfirmPhrase = '';
					portalError = null;
				}}
				disabled={portalLoading}
			>
				{SUBSCRIPTION_PAGE_LABELS.portalConfirmCancel}
			</Button>
			<Button
				type="button"
				variant="primary"
				size="md"
				onclick={openPortal}
				disabled={portalLoading}
				data-testid="portal-confirm-button"
			>
				{portalLoading ? SUBSCRIPTION_PAGE_LABELS.portalConfirmLoading : portalConfirmSubmit}
			</Button>
		</div>
		{/snippet}
	</Dialog>
</div>

<style>
	.plan-card {
		position: relative;
		border: 2px solid var(--color-neutral-200, #e5e7eb);
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.plan-card:hover {
		border-color: var(--color-violet-300, #c4b5fd);
	}

	.plan-card.selected {
		border-color: var(--color-violet-500, #8b5cf6);
		box-shadow: 0 0 0 1px var(--color-violet-500, #8b5cf6);
	}

	/* #4139: merged from the former /admin/billing portal feature list */
	.portal-feature-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}

	.portal-feature-list li {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		padding-left: 1.25rem;
		position: relative;
	}

	.portal-feature-list li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--color-action-success);
		font-weight: 700;
	}

	/* #4156: contract-state notice — tone is decided by the table in contract-state-view.ts */
	.notice-warning {
		background: var(--color-feedback-warning-bg);
		border-color: var(--color-feedback-warning-border);
		color: var(--color-feedback-warning-text);
	}

	.notice-info {
		background: var(--color-feedback-info-bg);
		border-color: var(--color-feedback-info-border);
		color: var(--color-feedback-info-text);
	}

	/* #4139: cancellation entry point (low-emphasis) */
	.subscription-cancel-row {
		display: flex;
		justify-content: center;
	}

	.subscription-cancel-link {
		font-size: 0.8rem;
		color: var(--color-text-tertiary);
		text-decoration: underline;
	}

	.subscription-cancel-link:hover {
		color: var(--color-text-secondary);
	}

	.recommend-badge {
		position: absolute;
		top: -10px;
		left: 16px;
		background: var(--color-violet-500, #8b5cf6);
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 2px 10px;
		border-radius: 9999px;
	}
</style>

<!-- Churn prevention modal -->
{#if data.loyaltyInfo && data.loyaltyInfo.subscriptionMonths > 0}
	<ChurnPreventionModal
		bind:open={showChurnModal}
		subscriptionMonths={data.loyaltyInfo.subscriptionMonths}
		lostItems={[
			...(data.loyaltyInfo.subscriptionMonths > 0 ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemMonthly(data.loyaltyInfo.subscriptionMonths)] : []),
			...(data.loyaltyInfo.memoryTickets > 0 ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemTickets(data.loyaltyInfo.memoryTickets)] : []),
			...(data.loyaltyInfo.loginBonusMultiplier > 1 ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemBonus(data.loyaltyInfo.loginBonusMultiplier)] : []),
			...(data.loyaltyInfo.currentTier.titleUnlock ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemTitle(data.loyaltyInfo.currentTier.titleUnlock)] : []),
			...(churnLostRetentionLabel ? [churnLostRetentionLabel] : []),
		]}
		onKeep={() => { showChurnModal = false; }}
		onCancel={() => { showChurnModal = false; openPortal(); }}
	/>
{/if}

<!-- #738: ダウングレード前リソース選択ダイアログ -->
<DowngradeResourceSelector
	bind:open={showDowngradeSelector}
	preview={downgradePreview}
	loading={downgradeLoading}
	error={downgradeError}
	onConfirm={async (selection) => {
		if (downgradePreview?.hasExcess) {
			const ok = await executeDowngradeArchive(selection);
			if (!ok) return;
		}
		showDowngradeSelector = false;
		downgradePreview = null;
		showPortalConfirm = true;
	}}
	onCancel={() => {
		showDowngradeSelector = false;
		downgradePreview = null;
	}}
/>
