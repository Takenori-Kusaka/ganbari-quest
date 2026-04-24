<script lang="ts">
import { formatChildName } from '$lib/domain/child-display';
import CertificateTemplate from '$lib/features/certificate/CertificateTemplate.svelte';
import ShareCard from '$lib/features/certificate/ShareCard.svelte';
import { CERTIFICATE_DETAIL_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
let showShareCard = $state(false);
let shareStatus = $state('');

function handlePrint() {
	window.print();
}

async function handleShareDownload() {
	// Use html2canvas-like approach: capture the share card as an image
	const el = document.getElementById('share-card');
	if (!el) return;

	try {
		// Use canvas API to render the card area
		const canvas = document.createElement('canvas');
		canvas.width = 640;
		canvas.height = 480;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Simple text-based card rendering for download
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, 640, 480);

		// Gradient border
		const grad = ctx.createLinearGradient(0, 0, 640, 480);
		grad.addColorStop(0, '#3b82f6');
		grad.addColorStop(1, '#8b5cf6');
		ctx.strokeStyle = grad;
		ctx.lineWidth = 6;
		ctx.roundRect(3, 3, 634, 474, 16);
		ctx.stroke();

		// Content
		ctx.fillStyle = '#1f2937';
		ctx.textAlign = 'center';
		ctx.font = '48px sans-serif';
		ctx.fillText(data.certificate.icon, 320, 100);
		ctx.font = 'bold 24px sans-serif';
		ctx.fillText(formatChildName(data.certificate.childName), 320, 160);
		ctx.fillStyle = '#2563eb';
		ctx.font = 'bold 22px sans-serif';
		ctx.fillText(data.certificate.title, 320, 210);
		ctx.fillStyle = '#4b5563';
		ctx.font = '16px sans-serif';
		ctx.fillText(data.certificate.description, 320, 250);

		// Stats
		let statY = 300;
		ctx.font = 'bold 18px sans-serif';
		for (const stat of data.certificate.stats) {
			ctx.fillStyle = '#1d4ed8';
			ctx.fillText(`${stat.label}: ${stat.value}`, 320, statY);
			statY += 30;
		}

		// Branding
		ctx.fillStyle = '#9ca3af';
		ctx.font = '14px sans-serif';
		ctx.fillText('がんばりクエスト', 320, 440);

		// Download
		const link = document.createElement('a');
		link.download = `certificate-${data.certificate.id}.png`;
		link.href = canvas.toDataURL('image/png');
		link.click();
		shareStatus = 'ダウンロードしました！';
		setTimeout(() => {
			shareStatus = '';
		}, 3000);
	} catch {
		shareStatus = 'ダウンロードに失敗しました';
		setTimeout(() => {
			shareStatus = '';
		}, 3000);
	}
}
</script>

<svelte:head>
	<title>{data.certificate.title} - {CERTIFICATE_DETAIL_LABELS.pageTitle}</title>
</svelte:head>

<!-- Screen-only controls -->
<div class="screen-controls">
	<div class="flex items-center gap-3 mb-4">
		<a href="/admin/certificates" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">&larr; {CERTIFICATE_DETAIL_LABELS.backLink}</a>
	</div>

	<div class="flex items-center justify-between mb-6">
		<h2 class="text-lg font-bold text-[var(--color-text-primary)]">{CERTIFICATE_DETAIL_LABELS.previewTitle}</h2>
		<div class="flex gap-2">
			{#if data.isPremium}
				<Button type="button" variant="primary" size="sm" onclick={handlePrint}>
					{CERTIFICATE_DETAIL_LABELS.printButton}
				</Button>
			{:else}
				<div class="flex items-center gap-2">
					<span class="text-xs text-[var(--color-text-tertiary)]">{CERTIFICATE_DETAIL_LABELS.pdfUpgradeNote}</span>
					<a href="/admin/license" class="text-xs text-[var(--color-feedback-info-text)] hover:underline">{CERTIFICATE_DETAIL_LABELS.upgradeLink}</a>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Certificate preview (visible on screen, prints full-page) -->
<div class="cert-preview">
	<CertificateTemplate
		certificate={data.certificate}
		watermark={!data.isPremium}
	/>
</div>

<!-- Share section (screen only) -->
<div class="screen-controls">
	<Card variant="default" padding="md" class="mt-6">
		{#snippet children()}
		<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">{CERTIFICATE_DETAIL_LABELS.shareCardTitle}</h3>
		<p class="text-xs text-[var(--color-text-muted)] mb-3">{CERTIFICATE_DETAIL_LABELS.shareCardDesc}</p>

		{#if showShareCard}
			<div class="mb-4">
				<ShareCard card={{
					childName: data.certificate.childName,
					title: data.certificate.title,
					icon: data.certificate.icon,
					stats: data.certificate.stats,
				}} />
			</div>
			<div class="flex gap-2 justify-center">
				<Button type="button" variant="primary" size="sm" onclick={handleShareDownload}>
					{CERTIFICATE_DETAIL_LABELS.downloadButton}
				</Button>
				<Button type="button" variant="outline" size="sm" onclick={() => { showShareCard = false; }}>
					{CERTIFICATE_DETAIL_LABELS.closeButton}
				</Button>
			</div>
		{:else}
			<Button type="button" variant="outline" size="sm" onclick={() => { showShareCard = true; }}>
				{CERTIFICATE_DETAIL_LABELS.showShareCardButton}
			</Button>
		{/if}

		{#if shareStatus}
			<p class="text-xs text-[var(--color-feedback-success-text)] mt-2 text-center">{shareStatus}</p>
		{/if}
		{/snippet}
	</Card>
</div>

<style>
	.cert-preview {
		overflow-x: auto;
	}

	/* Hide screen-only controls when printing */
	@media print {
		.screen-controls {
			display: none !important;
		}

		.cert-preview {
			overflow: visible;
		}

		:global(body) {
			margin: 0;
			padding: 0;
		}

		/* Hide admin layout chrome */
		:global(.admin-shell > header),
		:global(.admin-shell > nav),
		:global(.safe-area-bottom) {
			display: none !important;
		}

		:global(.admin-shell > main) {
			max-width: none;
			padding: 0;
			margin: 0;
		}

		:global(.admin-shell) {
			background: white !important;
		}
	}
</style>
