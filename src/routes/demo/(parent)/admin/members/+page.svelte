<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
</script>

<svelte:head>
	<title>メンバー管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- QRコード共有の説明 -->
	<Card>
		<h3 class="text-lg font-bold text-[var(--color-text-primary)] mb-3">👥 メンバー管理</h3>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			QRコードでご家族をかんたんに招待できます。パートナーやおじいちゃん・おばあちゃんもお子さまの成長を一緒に見守れます。
		</p>

		<!-- QRコードプレビュー -->
		<div class="bg-[var(--color-surface-muted)] rounded-lg p-6 text-center">
			<div class="w-32 h-32 mx-auto bg-white border-2 border-dashed border-[var(--color-border-strong)] rounded-lg flex items-center justify-center mb-3">
				<span class="text-4xl text-[var(--color-text-disabled)]">📱</span>
			</div>
			<p class="text-xs text-[var(--color-text-tertiary)]">登録するとQRコードが生成されます</p>
		</div>
	</Card>

	<!-- メンバー一覧プレビュー -->
	<Card>
		<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">招待済みメンバー</h3>
		<div class="space-y-2">
			<div class="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)] rounded-lg">
				<span class="text-2xl">👨</span>
				<div class="flex-1">
					<p class="text-sm font-bold text-[var(--color-text-primary)]">がんばり太郎</p>
					<p class="text-xs text-[var(--color-text-tertiary)]">オーナー</p>
				</div>
				<span class="text-xs text-[var(--color-feedback-success-text)] font-bold">アクティブ</span>
			</div>
			<div class="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)] rounded-lg">
				<span class="text-2xl">👩</span>
				<div class="flex-1">
					<p class="text-sm font-bold text-[var(--color-text-primary)]">がんばり花子</p>
					<p class="text-xs text-[var(--color-text-tertiary)]">メンバー</p>
				</div>
				<span class="text-xs text-[var(--color-feedback-success-text)] font-bold">アクティブ</span>
			</div>
		</div>
	</Card>

	<!-- 権限説明 -->
	<Card>
		<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-2">権限について</h3>
		<ul class="text-xs text-[var(--color-text-muted)] space-y-1.5">
			<li>&#x2022; <span class="font-bold">オーナー</span>: すべての設定変更・メンバー管理が可能</li>
			<li>&#x2022; <span class="font-bold">メンバー</span>: 活動記録・閲覧が可能（設定変更は不可）</li>
			<li>&#x2022; 招待は最大5名まで（オーナー含む）</li>
		</ul>
	</Card>

	<DemoCta
		title="ご家族みんなで使いませんか？"
		description="登録すると、QRコードで簡単にご家族を招待できます。"
	/>
</div>
