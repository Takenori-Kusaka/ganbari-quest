<script lang="ts">
import QRCode from 'qrcode';
import { page } from '$app/stores';
import { APP_LABELS, MEMBERS_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data } = $props();

let inviteRole = $state<'parent' | 'child'>('parent');
let inviteChildId = $state<number | '' | undefined>(undefined);
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
			error = data.message ?? MEMBERS_LABELS.inviteCreateError;
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
		error = MEMBERS_LABELS.networkError;
	} finally {
		creating = false;
	}
}

async function revokeInvite(code: string) {
	if (!confirm(MEMBERS_LABELS.revokeConfirm)) return;
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
			viewerError = d.message ?? MEMBERS_LABELS.viewerCreateError;
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
		viewerError = MEMBERS_LABELS.networkError;
	} finally {
		creatingViewer = false;
	}
}

async function revokeViewerToken(id: number) {
	if (!confirm(MEMBERS_LABELS.viewerRevokeConfirm)) return;
	await fetch(`/api/v1/admin/viewer-tokens/${id}?action=revoke`, { method: 'DELETE' });
	window.location.reload();
}

async function deleteViewerToken(id: number) {
	if (!confirm(MEMBERS_LABELS.viewerDeleteConfirm)) return;
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
	if (!confirm(MEMBERS_LABELS.removeMemberConfirm(email))) return;
	memberError = '';
	try {
		const res = await fetch(`/api/v1/admin/members/${userId}`, { method: 'DELETE' });
		if (!res.ok) {
			const d = await res.json();
			memberError = d.error ?? MEMBERS_LABELS.removeError;
			return;
		}
		window.location.reload();
	} catch {
		memberError = MEMBERS_LABELS.networkError;
	}
}

async function transferOwnership(userId: string, email: string) {
	if (!confirm(MEMBERS_LABELS.transferConfirm(email))) return;
	memberError = '';
	try {
		const res = await fetch(`/api/v1/admin/members/${userId}/transfer-ownership`, {
			method: 'POST',
		});
		if (!res.ok) {
			const d = await res.json();
			memberError = d.error ?? MEMBERS_LABELS.transferError;
			return;
		}
		window.location.reload();
	} catch {
		memberError = MEMBERS_LABELS.networkError;
	}
}

async function leaveGroup() {
	if (!confirm(MEMBERS_LABELS.leaveGroupConfirm)) return;
	memberError = '';
	try {
		const res = await fetch('/api/v1/admin/members/leave', { method: 'POST' });
		if (!res.ok) {
			const d = await res.json();
			memberError = d.error ?? MEMBERS_LABELS.leaveError;
			return;
		}
		window.location.href = '/auth/login';
	} catch {
		memberError = MEMBERS_LABELS.networkError;
	}
}

const roleLabel = (role: string) => {
	switch (role) {
		case 'owner':
			return MEMBERS_LABELS.roleOwner;
		case 'parent':
			return MEMBERS_LABELS.roleParent;
		case 'child':
			return MEMBERS_LABELS.roleChild;
		default:
			return role;
	}
};
</script>

<svelte:head>
	<title>{PAGE_TITLES.members}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- メンバー一覧 -->
	<Card variant="default" padding="md">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">{MEMBERS_LABELS.currentMembersTitle}</h3>

		{#if memberError}
			<div class="p-3 mb-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm rounded-lg border border-[var(--color-feedback-error-bg-strong)]">
				{memberError}
			</div>
		{/if}

		{#if data.members.length === 0}
			<p class="text-[var(--color-text-tertiary)] text-sm">{MEMBERS_LABELS.noMembersText}</p>
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
										title={MEMBERS_LABELS.transferTitle}
									>
										{MEMBERS_LABELS.transferButton}
									</Button>
									<Button
										onclick={() => removeMember(member.userId, member.email)}
										variant="danger"
										size="sm"
										title={MEMBERS_LABELS.removeTitle}
									>
										{MEMBERS_LABELS.removeButton}
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
					{MEMBERS_LABELS.leaveGroupButton}
				</Button>
			</div>
		{/if}
		{/snippet}
	</Card>

	<!-- 招待リンク作成 -->
	<Card variant="default" padding="md">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">{MEMBERS_LABELS.inviteSectionTitle}</h3>

		<div class="flex flex-wrap items-end gap-3 mb-3">
			<FormField label={MEMBERS_LABELS.inviteRoleLabel} id="invite-role" class="flex-1 min-w-[120px]">
				{#snippet children()}
					<NativeSelect
						id="invite-role"
						bind:value={inviteRole}
						onchange={() => { inviteChildId = undefined; }}
						options={[
							{ value: 'parent', label: '保護者' },
							{ value: 'child', label: 'こども' },
						]}
					/>
				{/snippet}
			</FormField>
			{#if inviteRole === 'child' && availableChildren.length > 0}
				<FormField label={MEMBERS_LABELS.inviteChildLabel} class="flex-1 min-w-[120px]">
					{#snippet children()}
						<NativeSelect
							bind:value={inviteChildId}
							options={[
								{ value: '', label: MEMBERS_LABELS.inviteChildNone },
								...availableChildren.map((child) => ({ value: child.id, label: child.nickname })),
							]}
						/>
					{/snippet}
				</FormField>
			{/if}
			<Button
				onclick={createInvite}
				disabled={creating}
				variant="primary"
				size="sm"
			>
				{creating ? MEMBERS_LABELS.inviteCreateLoading : MEMBERS_LABELS.inviteCreateButton}
			</Button>
		</div>

		{#if error}
			<div class="p-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm rounded-lg border border-[var(--color-feedback-error-bg-strong)]">
				{error}
			</div>
		{/if}

		{#if inviteLink}
			<div class="p-4 bg-[var(--color-feedback-success-bg)] rounded-lg border border-[var(--color-feedback-success-bg-strong)]">
				<p class="text-sm text-[var(--color-feedback-success-text)] font-medium mb-3">{MEMBERS_LABELS.inviteSuccessMsg}</p>

				<!-- QRコード -->
				{#if qrDataUrl}
					<div class="flex justify-center mb-3">
						<div class="bg-white p-3 rounded-lg shadow-sm">
							<img src={qrDataUrl} alt={MEMBERS_LABELS.inviteQrAlt} class="w-48 h-48" />
						</div>
					</div>
					<p class="text-xs text-center text-[var(--color-text-muted)] mb-3">
						{MEMBERS_LABELS.inviteQrNote}
					</p>
				{/if}

				<!-- URL コピー -->
				<div class="flex items-end gap-2">
					<FormField label={MEMBERS_LABELS.inviteUrlLabel} class="flex-1">
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
						{copied ? MEMBERS_LABELS.inviteCopied : MEMBERS_LABELS.inviteCopy}
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
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">{MEMBERS_LABELS.pendingInvitesTitle}</h3>
			<div class="divide-y divide-gray-100">
				{#each data.invites as invite}
					<div class="flex items-center justify-between py-3">
						<div>
							<span class="text-xs px-2 py-0.5 rounded-full
								{invite.role === 'parent' ? 'bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-feedback-info-text)]' : 'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]'}">
								{roleLabel(invite.role)}
							</span>
							<span class="ml-2 text-xs text-[var(--color-text-tertiary)]">
								{MEMBERS_LABELS.inviteExpiresPrefix}{new Date(invite.expiresAt).toLocaleDateString('ja-JP')}
							</span>
						</div>
						<Button
							onclick={() => revokeInvite(invite.inviteCode)}
							variant="danger"
							size="sm"
						>
							{MEMBERS_LABELS.inviteRevokeButton}
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
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">{MEMBERS_LABELS.viewerSectionTitle}</h3>
			<p class="text-xs text-[var(--color-text-tertiary)] mb-3">
				{MEMBERS_LABELS.viewerSectionDesc}
			</p>

			<div class="flex flex-wrap items-end gap-3 mb-3">
				<FormField label={MEMBERS_LABELS.viewerLabelField} class="flex-1 min-w-[120px]">
					{#snippet children()}
						<input
							type="text"
							bind:value={viewerLabel}
							placeholder={MEMBERS_LABELS.viewerLabelPlaceholder}
							maxlength="50"
							class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm"
						/>
					{/snippet}
				</FormField>
				<FormField label={MEMBERS_LABELS.viewerDurationLabel} class="min-w-[100px]">
					{#snippet children()}
						<NativeSelect
							bind:value={viewerDuration}
							options={[
								{ value: '7d', label: '7日間' },
								{ value: '30d', label: '30日間' },
								{ value: 'unlimited', label: '無期限' },
							]}
						/>
					{/snippet}
				</FormField>
				<Button
					onclick={createViewerLink}
					disabled={creatingViewer}
					variant="primary"
					size="sm"
				>
					{creatingViewer ? MEMBERS_LABELS.viewerCreateLoading : MEMBERS_LABELS.viewerCreateButton}
				</Button>
			</div>

			{#if viewerError}
				<div class="p-3 mb-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm rounded-lg border border-[var(--color-feedback-error-bg-strong)]">
					{viewerError}
				</div>
			{/if}

			{#if viewerLink}
				<div class="p-4 mb-3 bg-[var(--color-feedback-success-bg)] rounded-lg border border-[var(--color-feedback-success-bg-strong)]">
					<p class="text-sm text-[var(--color-feedback-success-text)] font-medium mb-3">{MEMBERS_LABELS.viewerSuccessMsg}</p>
					{#if viewerQrDataUrl}
						<div class="flex justify-center mb-3">
							<div class="bg-white p-3 rounded-lg shadow-sm">
								<img src={viewerQrDataUrl} alt={MEMBERS_LABELS.viewerQrAlt} class="w-48 h-48" />
							</div>
						</div>
						<p class="text-xs text-center text-[var(--color-text-muted)] mb-3">
							{MEMBERS_LABELS.viewerQrNote}
						</p>
					{/if}
					<div class="flex items-end gap-2">
						<FormField label={MEMBERS_LABELS.viewerUrlLabel} class="flex-1">
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
							{viewerCopied ? MEMBERS_LABELS.viewerCopied : MEMBERS_LABELS.viewerCopy}
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
									{vt.label || MEMBERS_LABELS.viewerNoLabel}
								</span>
								<div class="flex items-center gap-2 mt-0.5">
									{#if vt.isRevoked}
										<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]">{MEMBERS_LABELS.viewerStatusInvalid}</span>
									{:else if vt.isExpired}
										<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]">{MEMBERS_LABELS.viewerStatusExpired}</span>
									{:else}
										<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]">{MEMBERS_LABELS.viewerStatusValid}</span>
									{/if}
									{#if vt.expiresAt}
										<span class="text-xs text-[var(--color-text-tertiary)]">
											{MEMBERS_LABELS.viewerExpiresPrefix}{new Date(vt.expiresAt).toLocaleDateString('ja-JP')}
										</span>
									{:else}
										<span class="text-xs text-[var(--color-text-tertiary)]">{MEMBERS_LABELS.viewerExpiresNone}</span>
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
										{MEMBERS_LABELS.viewerRevokeButton}
									</Button>
								{/if}
								<Button
									onclick={() => deleteViewerToken(vt.id)}
									variant="danger"
									size="sm"
								>
									{MEMBERS_LABELS.viewerDeleteButton}
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
