<script lang="ts">
import QRCode from 'qrcode';

let { data } = $props();

let inviteRole = $state<'parent' | 'child'>('parent');
let creating = $state(false);
let inviteLink = $state('');
let qrDataUrl = $state('');
let error = $state('');
let copied = $state(false);

async function createInvite() {
	creating = true;
	error = '';
	inviteLink = '';
	qrDataUrl = '';
	copied = false;
	try {
		const res = await fetch('/api/v1/admin/invites', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: inviteRole }),
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
	setTimeout(() => (copied = false), 2000);
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
	<h2 class="text-xl font-bold text-gray-700">メンバー管理</h2>

	<!-- メンバー一覧 -->
	<section class="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
		<h3 class="text-lg font-semibold text-gray-600 mb-3">現在のメンバー</h3>
		{#if data.members.length === 0}
			<p class="text-gray-400 text-sm">メンバーがいません</p>
		{:else}
			<div class="divide-y divide-gray-100">
				{#each data.members as member}
					<div class="flex items-center justify-between py-3">
						<div>
							<span class="text-sm font-medium text-gray-700">{member.email}</span>
							<span class="ml-2 text-xs px-2 py-0.5 rounded-full
								{member.role === 'owner' ? 'bg-amber-100 text-amber-700'
								: member.role === 'parent' ? 'bg-blue-100 text-blue-700'
								: 'bg-green-100 text-green-700'}">
								{roleLabel(member.role)}
							</span>
						</div>
						<span class="text-xs text-gray-400">
							{new Date(member.joinedAt).toLocaleDateString('ja-JP')}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- 招待リンク作成 -->
	<section class="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
		<h3 class="text-lg font-semibold text-gray-600 mb-3">メンバーを招待</h3>

		<div class="flex items-end gap-3 mb-3">
			<div class="flex-1">
				<label for="invite-role" class="block text-sm font-medium text-gray-600 mb-1">
					招待ロール
				</label>
				<select
					id="invite-role"
					bind:value={inviteRole}
					class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
				>
					<option value="parent">保護者</option>
					<option value="child">こども</option>
				</select>
			</div>
			<button
				onclick={createInvite}
				disabled={creating}
				class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
			>
				{creating ? '作成中...' : '招待リンクを作成'}
			</button>
		</div>

		{#if error}
			<div class="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
				{error}
			</div>
		{/if}

		{#if inviteLink}
			<div class="p-4 bg-green-50 rounded-lg border border-green-100">
				<p class="text-sm text-green-700 font-medium mb-3">招待リンクが作成されました（7日間有効）</p>

				<!-- QRコード -->
				{#if qrDataUrl}
					<div class="flex justify-center mb-3">
						<div class="bg-white p-3 rounded-lg shadow-sm">
							<img src={qrDataUrl} alt="招待QRコード" class="w-48 h-48" />
						</div>
					</div>
					<p class="text-xs text-center text-gray-500 mb-3">
						スマートフォンのカメラでスキャンして参加できます
					</p>
				{/if}

				<!-- URL コピー -->
				<div class="flex items-center gap-2">
					<input
						type="text"
						value={inviteLink}
						readonly
						class="flex-1 px-3 py-2 bg-white border border-green-200 rounded-lg text-xs font-mono"
					/>
					<button
						onclick={copyLink}
						class="px-3 py-2 text-xs font-medium rounded-lg transition-colors
							{copied
							? 'bg-gray-500 text-white'
							: 'bg-green-600 text-white hover:bg-green-700'}"
					>
						{copied ? 'コピー済み' : 'コピー'}
					</button>
				</div>
			</div>
		{/if}
	</section>

	<!-- 保留中の招待 -->
	{#if data.invites.length > 0}
		<section class="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
			<h3 class="text-lg font-semibold text-gray-600 mb-3">保留中の招待</h3>
			<div class="divide-y divide-gray-100">
				{#each data.invites as invite}
					<div class="flex items-center justify-between py-3">
						<div>
							<span class="text-xs px-2 py-0.5 rounded-full
								{invite.role === 'parent' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">
								{roleLabel(invite.role)}
							</span>
							<span class="ml-2 text-xs text-gray-400">
								期限: {new Date(invite.expiresAt).toLocaleDateString('ja-JP')}
							</span>
						</div>
						<button
							onclick={() => revokeInvite(invite.inviteCode)}
							class="text-xs text-red-500 hover:text-red-700 transition-colors"
						>
							取消し
						</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
