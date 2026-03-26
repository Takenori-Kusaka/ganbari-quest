<svelte:head>
	<title>特定商取引法に基づく表記 - がんばりクエスト</title>
</svelte:head>

<article class="legal-doc">
	<h1>特定商取引法に基づく表記</h1>
	<p class="legal-meta">最終更新日: 2026年3月26日</p>

	<div class="commerce-table">
		<div class="commerce-row">
			<div class="commerce-label">販売事業者</div>
			<div class="commerce-value">日下 武紀（個人事業主）</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">運営統括責任者</div>
			<div class="commerce-value">日下 武紀</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">所在地</div>
			<div class="commerce-value">
				請求があった場合、遅滞なく開示いたします。<br />
				<span class="commerce-note">※ 個人情報保護のため、住所の公開は請求ベースとさせていただいております。</span>
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">電話番号</div>
			<div class="commerce-value">
				請求があった場合、遅滞なく開示いたします。<br />
				<span class="commerce-note">※ お問い合わせはメールにてお願いいたします。</span>
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">メールアドレス</div>
			<div class="commerce-value">support@ganbari-quest.com</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">URL</div>
			<div class="commerce-value">https://ganbari-quest.com</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">販売価格</div>
			<div class="commerce-value">
				各プランの料金は、本サービスの料金ページに記載されたとおりです。<br />
				全て税込み価格で表示しています。
				<ul>
					<li>月額プラン: 500円（税込）/ 月</li>
					<li>年額プラン: 5,000円（税込）/ 年</li>
				</ul>
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">商品代金以外の必要料金</div>
			<div class="commerce-value">
				インターネット接続に必要な通信料は利用者のご負担となります。<br />
				その他の追加料金は発生しません。
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">支払方法</div>
			<div class="commerce-value">
				クレジットカード（Visa, Mastercard, American Express, JCB）<br />
				<span class="commerce-note">※ 決済処理は Stripe, Inc. を通じて安全に行われます。</span>
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">支払時期</div>
			<div class="commerce-value">
				<strong>月額プラン:</strong> 無料トライアル期間終了後、毎月自動課金<br />
				<strong>年額プラン:</strong> 無料トライアル期間終了後、毎年自動課金
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">商品の引き渡し時期</div>
			<div class="commerce-value">決済完了後、直ちにサービスをご利用いただけます。</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">返品・キャンセルについて</div>
			<div class="commerce-value">
				<ul>
					<li>7日間の無料トライアル期間中はいつでもキャンセル可能です（料金は発生しません）。</li>
					<li>有料期間中の解約は、次回更新日の前日までに本サービスの設定画面から手続きいただけます。</li>
					<li>解約後も、支払い済み期間の終了日まで有料プランの機能をご利用いただけます。</li>
					<li>デジタルサービスの性質上、日割り計算による返金は行っておりません。</li>
				</ul>
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">動作環境</div>
			<div class="commerce-value">
				以下のWebブラウザの最新版を推奨します。<br />
				Google Chrome, Safari, Firefox, Microsoft Edge<br />
				<span class="commerce-note">※ JavaScript が有効である必要があります。</span>
			</div>
		</div>

		<div class="commerce-row">
			<div class="commerce-label">特別な販売条件</div>
			<div class="commerce-value">
				<ul>
					<li>サブスクリプション（定期課金）サービスです。解約手続きを行わない限り自動更新されます。</li>
					<li>1アカウントにつき1つの家族グループを管理できます。</li>
					<li>サービスの利用には、有効なメールアドレスとインターネット接続が必要です。</li>
				</ul>
			</div>
		</div>
	</div>
</article>

<style>
	.legal-doc {
		background: white;
		border-radius: 12px;
		padding: 32px 24px;
		border: 1px solid #e2e8f0;
		line-height: 1.8;
		color: #334155;
	}

	.legal-doc h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e293b;
		margin: 0 0 8px;
	}

	.legal-meta {
		font-size: 0.8rem;
		color: #94a3b8;
		margin: 0 0 24px;
	}

	.commerce-table {
		display: flex;
		flex-direction: column;
	}

	.commerce-row {
		display: flex;
		border-bottom: 1px solid #e2e8f0;
		padding: 16px 0;
	}

	.commerce-row:last-child {
		border-bottom: none;
	}

	.commerce-label {
		width: 180px;
		min-width: 180px;
		font-size: 0.85rem;
		font-weight: 600;
		color: #475569;
		padding-right: 16px;
	}

	.commerce-value {
		flex: 1;
		font-size: 0.9rem;
		color: #334155;
	}

	.commerce-value ul {
		margin: 8px 0 0;
		padding-left: 20px;
	}

	.commerce-value li {
		margin: 4px 0;
		font-size: 0.85rem;
	}

	.commerce-note {
		font-size: 0.8rem;
		color: #94a3b8;
	}

	@media (max-width: 640px) {
		.commerce-row {
			flex-direction: column;
			gap: 4px;
		}

		.commerce-label {
			width: auto;
			min-width: auto;
			padding-right: 0;
		}
	}
</style>
