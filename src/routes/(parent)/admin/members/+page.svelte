<script lang="ts">
import QRCode from 'qrcode';
import { page } from '$app/stores';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

let inviteRole = $state<'parent' | 'child'>('parent');
let inviteChildId = $state<number | undefined>(undefined);
let creating = $state(false);
let inviteLink = $state('');
let qrDataUrl = $state('');
let error = $state('');
let copied = $state(false);
let copyButtonVariant: 'secondary' | 'success' = $derived(copied ? 'secondary' : 'success');

// 紐づけ済みでない子供のみ選択可能
let availableChildren = $derived(
	(data.children ?? []).filter(
		(c: { id: number; nickname: string; userId: string | null }) => !c.userId,
	),
);

async function createInvite() {
	creating = true;
	error = '';
	inviteLink = '';
	qrDataUrl = '';
	copied = false;
	try {
		const body: { role: string; childId?: number } = { role: inviteRole };
		if (inviteRole === 'child' && inviteChildId) {
			body.childId = inviteChildId;
		}
		const res = await fetch('/api/v1/admin/invites', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const data = await res.json();
			error = data.message ?? '招待リンクの作成に失敗しました';
			return;
		}
		const result = await res.json();
		inviteLink = `${window.location.origin}/auth/invite/${result.invite.inviteCode}`;
		// QRコード生成
		qrDataUrl = await QRCode.toDataURL(inviteLink, {
			width: 256,
			margin: 2,
			color: { dark: '#1e293b', light: '#ffffff' },
		});
	} catch {
		error = '通信エラーが発生しました';
	} finally {
		creating = false;
	}
}

async function revokeInvite(code: string) {
	if (!confirm('この招待リンクを取り消しますか？')) return;
	await fetch(`/api/v1/admin/invites/${code}`, { method: 'DELETE' });
	window.location.reload();
}

async function copyLink() {
	await navigator.clipboard.writeText(inviteLink);
	copied = true;
	setTimeout(() => {
		copied = false;
	}, 2000);
}

// --- Viewer Token ---
let viewerLabel = $state('');
let viewerDuration = $state<'7d' | '30d' | 'unlimited'>('30d');
let creatingViewer = $state(false);
let viewerLink = $state('');
let viewerQrDataUrl = $state('');
let viewerError = $state('');
let viewerCopied = $state(false);

async function createViewerLink() {
	creatingViewer = true;
	viewerError = '';
	viewerLink = '';
	viewerQrDataUrl = '';
	viewerCopied = false;
	try {
		const res = await fetch('/api/v1/admin/viewer-tokens', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: viewerLabel || undefined, duration: viewerDuration }),
		});
		if (!res.ok) {
			const d = await res.json();
			viewerError = d.message ?? '閲覧リンクの作成に失敗しました';
			return;
		}
		const result = await res.json();
		viewerLink = `${window.location.origin}/view/${result.token.token}`;
		viewerQrDataUrl = await QRCode.toDataURL(viewerLink, {
			width: 256,
			margin: 2,
			color: { dark: '#1e293b', light: '#ffffff' },
		});
	} catch {
		viewerError = '通信エラーが発生しました';
	} finally {
		creatingViewer = false;
	}
}

async function revokeViewerToken(id: number) {
	if (!confirm('この閲覧リンクを無効にしますか？')) return;
	await fetch(`/api/v1/admin/viewer-tokens/${id}?action=revoke`, { method: 'DELETE' });
	window.location.reload();
}

async function deleteViewerToken(id: number) {
	if (!confirm('この閲覧リンクを削除しますか？')) return;
	await fetch(`/api/v1/admin/viewer-tokens/${id}`, { method: 'DELETE' });
	window.location.reload();
}

async function copyViewerLink() {
	await navigator.clipboard.writeText(viewerLink);
	viewerCopied = true;
	setTimeout(() => {
		viewerCopied = false;
	}, 2000);
}

let memberError = $state('');

async function removeMember(userId: string, email: string) {
	if (!confirm(`${email} をメンバーから削除しますか？この操作は取り消せません。`)) return;
	memberError = '';
	try {
		const res = await fetch(`/api/v1/admin/members/${userId}`, { method: 'DELETE' });
		if (!res.ok) {
			const d = await res.json();
			memberError = d.error ?? '削除に失敗しました';
			return;
		}
		window.location.reload();
	} catch {
		memberError = '通信エラーが発生しました';
	}
}

async function transferOwnership(userId: string, email: string) {
	if (
		!confirm(
			`${email} にオーナー権限を移譲しますか？\n移譲後、あなたは「保護者」ロールになります。この操作は取り消せません。`,
		)
	)
		return;
	memberError = '';
	try {
		const res = await fetch(`/api/v1/admin/members/${userId}/transfer-ownership`, {
			method: 'POST',
		});
		if (!res.ok) {
			const d = await res.json();
			memberError = d.error ?? '移譲に失敗しました';
			return;
		}
		window.location.reload();
	} catch {
		memberError = '通信エラーが発生しました';
	}
}

async function leaveGroup() {
	if (!confirm('家族グループを離れますか？この操作は取り消せません。')) return;
	memberError = '';
	try {
		const res = await fetch('/api/v1/admin/members/leave', { method: 'POST' });
		if (!res.ok) {
			const d = await res.json();
			memberError = d.error ?? '離脱に失敗しました';
			return;
		}
		window.location.href = '/auth/login';
	} catch {
		memberError = '通信エラーが発生しました';
	}
}

const roleLabel = (role: string) => {
	switch (role) {
		case 'owner':
			return 'オーナー';
		case 'parent':
			return '保護者';
		case 'child':
			return 'こども';
		default:
			return role;
	}
};
</script>

<svelte:head>
	<title>メンバー管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- メンバー一覧 -->
	<Card variant="default" padding="md">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">現在のメンバー</h3>

		{#if memberError}
			<div class="p-3 mb-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm rounded-lg border border-[var(--color-feedback-error-bg-strong)]">
				{memberError}
			</div>
		{/if}

		{#if data.members.length === 0}
			<p class="text-[var(--color-text-tertiary)] text-sm">メンバーがいません</p>
		{:else}
			<div class="divide-y divide-gray-100">
				{#each data.members as member}
					<div class="flex items-center justify-between py-3 gap-2">
						<div class="flex-1 min-w-0">
							<span class="text-sm font-medium text-[var(--color-text-primary)] truncate block">{member.email}</span>
							<div class="flex items-center gap-2 mt-0.5">
								<span class="text-xs px-2 py-0.5 rounded-full
									{member.role === 'owner' ? 'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]'
									: member.role === 'parent' ? 'bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-feedback-info-text)]'
									: 'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]'}">
									{roleLabel(member.role)}
								</span>
								<span class="text-xs text-[var(--color-text-tertiary)]">
									{new Date(member.joinedAt).toLocaleDateString('ja-JP')}
								</span>
							</div>
						</div>
						<!-- アクションボタン -->
						{#if $page.data.currentRole === 'owner' && member.userId !== $page.data.currentUserId}
							<div class="flex gap-1 flex-shrink-0">
								{#if member.role !== 'owner'}
									<Button
										onclick={() => transferOwnership(member.userId, member.email)}
										variant="ghost"
										size="sm"
										title="オーナー権限を移譲"
									>
										移譲
									</Button>
									<Button
										onclick={() => removeMember(member.userId, member.email)}
										variant="danger"
										size="sm"
										title="メンバーを削除"
									>
										削除
									</Button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- 自主離脱ボタン（parent のみ） -->
		{#if $page.data.currentRole === 'parent'}
			<div class="mt-4 pt-4 border-t border-[var(--color-border-light)]">
				<Button
					onclick={leaveGroup}
					variant="danger"
					size="sm"
				>
					家族グループを離れる
				</Button>
			</div>
		{/if}
		{/snippet}
	</Card>

	<!-- 招待リンク作成 -->
	<Card variant="default" padding="md">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">メンバーを招待</h3>

		<div class="flex flex-wrap items-end gap-3 mb-3">
			<FormField label="招待ロール" id="invite-role" class="flex-1 min-w-[120px]">
				{#snippet children()}
					<select
						id="invite-role"
						bind:value={inviteRole}
						onchange={() => { inviteChildId = undefined; }}
						class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm"
					>
						<option value="parent">保護者</option>
						<option value="child">こども</option>
					</select>
				{/snippet}
			</FormField>
			{#if inviteRole === 'child' && availableChildren.length > 0}
				<FormField label="対象の子供（任意）" class="flex-1 min-w-[120px]">
					{#snippet children()}
						<select
							bind:value={inviteChildId}
							class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm"
						>
							<option value={undefined}>-- 後で紐づけ --</option>
							{#each availableChildren as child}
								<option value={child.id}>{child.nickname}</option>
							{/each}
						</select>
					{/snippet}
				</FormField>
			{/if}
			<Button
				onclick={createInvite}
				disabled={creating}
				variant="primary"
				size="sm"
			>
				{creating ? '作成中...' : '招待リンクを作成'}
			</Button>
		</div>

		{#if error}
			<div class="p-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm rounded-lg border border-[var(--color-feedback-error-bg-strong)]">
				{error}
			</div>
		{/if}

		{#if inviteLink}
			<div class="p-4 bg-[var(--color-feedback-success-bg)] rounded-lg border border-[var(--color-feedback-success-bg-strong)]">
				<p class="text-sm text-[var(--color-feedback-success-text)] font-medium mb-3">招待リンクが作成されました（7日間有効）</p>

				<!-- QRコード -->
				{#if qrDataUrl}
					<div class="flex justify-center mb-3">
						<div class="bg-white p-3 rounded-lg shadow-sm">
							<img src={qrDataUrl} alt="招待QRコード" class="w-48 h-48" />
						</div>
					</div>
					<p class="text-xs text-center text-[var(--color-text-muted)] mb-3">
						スマートフォンのカメラでスキャンして参加できます
					</p>
				{/if}

				<!-- URL コピー -->
				<div class="flex items-end gap-2">
					<FormField label="招待URL" class="flex-1">
						{#snippet children()}
							<input
								type="text"
								value={inviteLink}
								readonly
								class="w-full px-3 py-2 bg-white border border-[var(--color-feedback-success-border)] rounded-[var(--input-radius)] text-xs font-mono"
							/>
						{/snippet}
					</FormField>
					<Button
						onclick={copyLink}
						variant={copyButtonVariant}
						size="sm"
					>
						{copied ? 'コピー済み' : 'コピー'}
					</Button>
				</div>
			</div>
		{/if}
		{/snippet}
	</Card>

	<!-- 保留中の招待 -->
	{#if data.invites.length > 0}
		<Card variant="default" padding="md">
			{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">保留中の招待</h3>
			<div class="divide-y divide-gray-100">
				{#each data.invites as invite}
					<div class="flex items-center justify-between py-3">
						<div>
							<span class="text-xs px-2 py-0.5 rounded-full
								{invite.role === 'parent' ? 'bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-feedback-info-text)]' : 'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]'}">
								{roleLabel(invite.role)}
							</span>
							<span class="ml-2 text-xs text-[var(--color-text-tertiary)]">
								期限: {new Date(invite.expiresAt).toLocaleDateString('ja-JP')}
							</span>
						</div>
						<Button
							onclick={() => revokeInvite(invite.inviteCode)}
							variant="danger"
							size="sm"
						>
							取消し
						</Button>
					</div>
				{/each}
			</div>
			{/snippet}
		</Card>
	{/if}

	<!-- 閲覧リンク（ファミリープラン限定） -->
	{#if data.isFamily}
		<Card variant="default" padding="md">
			{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">閲覧リンク</h3>
			<p class="text-xs text-[var(--color-text-tertiary)] mb-3">
				祖父母や家族に、お子さまの成長を読み取り専用で共有できます
			</p>

			<div class="flex flex-wrap items-end gap-3 mb-3">
				<FormField label="ラベル（任意）" class="flex-1 min-w-[120px]">
					{#snippet children()}
						<input
							type="text"
							bind:value={viewerLabel}
							placeholder="例: おばあちゃん用"
							maxlength="50"
							class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm"
						/>
					{/snippet}
				</FormField>
				<FormField label="有効期限" class="min-w-[100px]">
					{#snippet children()}
						<select
							bind:value={viewerDuration}
							class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm"
						>
							<option value="7d">7日間</option>
							<option value="30d">30日間</option>
							<option value="unlimited">無期限</option>
						</select>
					{/snippet}
				</FormField>
				<Button
					onclick={createViewerLink}
					disabled={creatingViewer}
					variant="primary"
					size="sm"
				>
					{creatingViewer ? '作成中...' : '閲覧リンクを作成'}
				</Button>
			</div>

			{#if viewerError}
				<div class="p-3 mb-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm rounded-lg border border-[var(--color-feedback-error-bg-strong)]">
					{viewerError}
				</div>
			{/if}

			{#if viewerLink}
				<div class="p-4 mb-3 bg-[var(--color-feedback-success-bg)] rounded-lg border border-[var(--color-feedback-success-bg-strong)]">
					<p class="text-sm text-[var(--color-feedback-success-text)] font-medium mb-3">閲覧リンクが作成されました</p>
					{#if viewerQrDataUrl}
						<div class="flex justify-center mb-3">
							<div class="bg-white p-3 rounded-lg shadow-sm">
								<img src={viewerQrDataUrl} alt="閲覧QRコード" class="w-48 h-48" />
							</div>
						</div>
						<p class="text-xs text-center text-[var(--color-text-muted)] mb-3">
							スマートフォンのカメラでスキャンして閲覧できます
						</p>
					{/if}
					<div class="flex items-end gap-2">
						<FormField label="閲覧URL" class="flex-1">
							{#snippet children()}
								<input
									type="text"
									value={viewerLink}
									readonly
									class="w-full px-3 py-2 bg-white border border-[var(--color-feedback-success-border)] rounded-[var(--input-radius)] text-xs font-mono"
								/>
							{/snippet}
						</FormField>
						<Button
							onclick={copyViewerLink}
							variant={viewerCopied ? 'secondary' : 'success'}
							size="sm"
						>
							{viewerCopied ? 'コピー済み' : 'コピー'}
						</Button>
					</div>
				</div>
			{/if}

			<!-- 既存の閲覧リンク一覧 -->
			{#if data.viewerTokens.length > 0}
				<div class="divide-y divide-gray-100">
					{#each data.viewerTokens as vt}
						<div class="flex items-center justify-between py-3 gap-2">
							<div class="flex-1 min-w-0">
								<span class="text-sm font-medium text-[var(--color-text-primary)] truncate block">
									{vt.label || '(ラベルなし)'}
								</span>
								<div class="flex items-center gap-2 mt-0.5">
									{#if vt.isRevoked}
										<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]">無効</span>
									{:else if vt.isExpired}
										<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]">期限切れ</span>
									{:else}
										<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]">有効</span>
									{/if}
									{#if vt.expiresAt}
										<span class="text-xs text-[var(--color-text-tertiary)]">
											期限: {new Date(vt.expiresAt).toLocaleDateString('ja-JP')}
										</span>
									{:else}
										<span class="text-xs text-[var(--color-text-tertiary)]">無期限</span>
									{/if}
								</div>
							</div>
							<div class="flex gap-1 flex-shrink-0">
								{#if !vt.isRevoked && !vt.isExpired}
									<Button
										onclick={() => revokeViewerToken(vt.id)}
										variant="ghost"
										size="sm"
									>
										無効化
									</Button>
								{/if}
								<Button
									onclick={() => deleteViewerToken(vt.id)}
									variant="danger"
									size="sm"
								>
									削除
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/snippet}
		</Card>
	{/if}
</div>
