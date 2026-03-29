<script lang="ts">
import Logo from '$lib/ui/components/Logo.svelte';
</script>

<svelte:head>
	<title>プライバシーポリシー - がんばりクエスト</title>
</svelte:head>

<div class="legal-page">
	<div class="legal-card">
		<div class="legal-header">
			<Logo variant="symbol" size={48} />
			<h1>プライバシーポリシー</h1>
			<p class="meta">最終更新日: 2026年3月27日 / バージョン: 2026-03-29</p>
		</div>

		<div class="legal-body">
			<p class="intro">
				がんばりクエスト運営者（以下「運営者」）は、本サービスの利用者の個人情報およびこどもの個人情報を適切に保護することが重要であると考え、以下のとおりプライバシーポリシーを定めます。
			</p>

			<section>
				<h2>1. 収集する情報</h2>
				<ul>
					<li><strong>保護者情報</strong>: メールアドレス、パスワード（ハッシュ化して保存）</li>
					<li><strong>こどもの情報</strong>: ニックネーム、生年月日、アバター画像</li>
					<li><strong>活動データ</strong>: 活動記録、ポイント、実績、ステータス</li>
					<li><strong>技術情報</strong>: IPアドレス、ブラウザ情報、アクセスログ</li>
				</ul>
			</section>

			<section>
				<h2>2. 情報の利用目的</h2>
				<ul>
					<li>本サービスの提供・運営・改善</li>
					<li>利用者への連絡（サービスに関する通知）</li>
					<li>不正利用の防止</li>
					<li>利用統計の作成（個人を特定しない形式）</li>
				</ul>
			</section>

			<section>
				<h2>3. こどものプライバシー（GDPR Art.8 対応）</h2>
				<p>本サービスは保護者の同意のもとでこどもの情報を取り扱います。こどもが自らアカウントを作成することはできません。保護者はいつでもこどもの情報の閲覧・修正・削除を申請できます。</p>
			</section>

			<section>
				<h2>4. データの保管と安全管理</h2>
				<ul>
					<li>AWS の暗号化されたストレージに保管</li>
					<li>通信は TLS で暗号化</li>
					<li>アクセス制御と監査ログの記録</li>
					<li>定期的なセキュリティ監査の実施</li>
				</ul>
			</section>

			<section>
				<h2>5. 第三者への提供</h2>
				<p>法令に基づく場合を除き、利用者の同意なく個人情報を第三者に提供しません。決済処理に Stripe を利用しますが、Stripe は独自のプライバシーポリシーに基づき情報を管理します。</p>
			</section>

			<section>
				<h2>6. 利用者の権利（GDPR 対応）</h2>
				<ul>
					<li><strong>アクセス権</strong>: 保存されている個人情報の開示を請求できます</li>
					<li><strong>訂正権</strong>: 不正確な情報の訂正を請求できます</li>
					<li><strong>削除権</strong>: アカウント削除により全データの削除を申請できます</li>
					<li><strong>データポータビリティ</strong>: データエクスポート機能で情報を取得できます</li>
					<li><strong>同意の撤回</strong>: いつでも同意を撤回し、アカウントを削除できます</li>
				</ul>
			</section>

			<section>
				<h2>7. Cookie の使用</h2>
				<p>本サービスはセッション管理のために HTTP-only Cookie を使用します。トラッキング目的の Cookie は使用しません。</p>
			</section>

			<section>
				<h2>8. ポリシーの変更</h2>
				<p>本ポリシーを変更する場合、変更内容を本サービス上で通知し、重要な変更については再同意を求めます。</p>
			</section>

			<p class="full-text-link">
				<a href="https://takenori-kusaka.github.io/ganbari-quest/privacy.html" target="_blank" rel="noopener">全文はこちら（外部ページ）</a>
			</p>
		</div>

		<div class="legal-footer">
			<a href="/legal/terms">利用規約</a>
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
	.legal-body ul {
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
