<script lang="ts">
import Logo from '$lib/ui/components/Logo.svelte';
</script>

<svelte:head>
	<title>利用規約 - がんばりクエスト</title>
</svelte:head>

<div class="legal-page">
	<div class="legal-card">
		<div class="legal-header">
			<Logo variant="symbol" size={48} />
			<h1>利用規約</h1>
			<p class="meta">最終更新日: 2026年3月27日 / バージョン: 2026-03-29</p>
		</div>

		<div class="legal-body">
			<p class="intro">
				本利用規約（以下「本規約」）は、がんばりクエスト運営者（以下「運営者」）が提供するWebアプリケーション「がんばりクエスト」（以下「本サービス」）の利用条件を定めるものです。
			</p>

			<section>
				<h2>第1条（定義）</h2>
				<ol>
					<li>「利用者」とは、本規約に同意の上、本サービスを利用する全ての方をいいます。</li>
					<li>「保護者」とは、本サービスにおいて管理者権限でアカウントを作成・管理する利用者をいいます。</li>
					<li>「こども」とは、保護者が本サービスに登録した未成年の家族をいいます。</li>
					<li>「家族グループ」とは、保護者が作成し、こどもや他の保護者が所属するグループをいいます。</li>
					<li>「コンテンツ」とは、利用者が本サービスに登録した活動、ポイント、実績等のデータをいいます。</li>
				</ol>
			</section>

			<section>
				<h2>第2条（サービスの内容）</h2>
				<ol>
					<li>本サービスは、家庭内でのこどもの日常活動をゲーミフィケーションにより動機づけすることを目的としたWebアプリケーションです。</li>
					<li>運営者は、本サービスの内容を予告なく変更・追加・削減することがあります。</li>
					<li>本サービスは教育効果や行動変容を保証するものではありません。</li>
				</ol>
			</section>

			<section>
				<h2>第3条（アカウントの管理）</h2>
				<ol>
					<li>利用者は、自己の責任においてアカウント情報を管理するものとします。</li>
					<li>アカウント情報の不正利用により生じた損害について、運営者は一切の責任を負いません。</li>
					<li>こどものアカウントは保護者が作成・管理するものとし、こども自身がアカウントを作成することはできません。</li>
				</ol>
			</section>

			<section>
				<h2>第4条（禁止事項）</h2>
				<p>利用者は、本サービスの利用にあたり、法令・公序良俗に違反する行為、不正アクセス、他の利用者への成りすまし等を行ってはなりません。</p>
			</section>

			<section>
				<h2>第5条（料金および支払い）</h2>
				<p>基本機能は無料です。有料プランの料金・支払い・自動更新・解約については本サービス内の料金ページをご確認ください。</p>
			</section>

			<section>
				<h2>第6条（個人情報・データの取扱い）</h2>
				<p>個人情報の取扱いについては<a href="/legal/privacy">プライバシーポリシー</a>に従います。アカウント削除時は30日の猶予期間の後、全データが完全に削除されます。</p>
			</section>

			<section>
				<h2>第7条（サービスの中断・免責）</h2>
				<p>システム保守・天災等により本サービスを中断することがあります。運営者の故意または重大な過失による場合を除き、損害賠償は過去12ヶ月の利用料を上限とします。</p>
			</section>

			<section>
				<h2>第8条（準拠法・管轄裁判所）</h2>
				<p>日本法を準拠法とし、運営者の所在地を管轄する裁判所を専属的合意管轄裁判所とします。</p>
			</section>

			<p class="full-text-link">
				<a href="https://takenori-kusaka.github.io/ganbari-quest/terms.html" target="_blank" rel="noopener">全文はこちら（外部ページ）</a>
			</p>
		</div>

		<div class="legal-footer">
			<a href="/legal/privacy">プライバシーポリシー</a>
			<a href="/auth/signup">アカウント登録に戻る</a>
		</div>
	</div>
</div>

<style>
	.legal-page {
		min-height: 100dvh;
		background: #f8fafc;
		padding: 24px 16px;
	}
	.legal-card {
		max-width: 720px;
		margin: 0 auto;
		background: white;
		border-radius: 12px;
		padding: 32px 24px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
	}
	.legal-header {
		text-align: center;
		margin-bottom: 24px;
	}
	.legal-header h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e293b;
		margin: 8px 0 4px;
	}
	.meta {
		font-size: 0.8rem;
		color: #94a3b8;
	}
	.legal-body {
		font-size: 0.9rem;
		color: #374151;
		line-height: 1.8;
	}
	.intro {
		margin-bottom: 24px;
		padding-bottom: 16px;
		border-bottom: 1px solid #e2e8f0;
	}
	.legal-body h2 {
		font-size: 1rem;
		font-weight: 600;
		color: #1e293b;
		margin: 24px 0 8px;
	}
	.legal-body ol {
		padding-left: 24px;
		margin: 8px 0;
	}
	.legal-body li {
		margin: 4px 0;
	}
	.legal-body a {
		color: #667eea;
	}
	.full-text-link {
		margin-top: 24px;
		text-align: center;
		font-size: 0.85rem;
	}
	.legal-footer {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid #e2e8f0;
		display: flex;
		justify-content: center;
		gap: 24px;
	}
	.legal-footer a {
		font-size: 0.85rem;
		color: #667eea;
		text-decoration: none;
	}
	.legal-footer a:hover {
		text-decoration: underline;
	}
</style>
