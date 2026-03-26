<svelte:head>
	<title>プライバシーポリシー - がんばりクエスト</title>
</svelte:head>

<article class="legal-doc">
	<h1>プライバシーポリシー</h1>
	<p class="legal-meta">最終更新日: 2026年3月26日</p>

	<p class="legal-intro">
		がんばりクエスト運営者（以下「運営者」）は、Webアプリケーション「がんばりクエスト」（以下「本サービス」）における利用者の個人情報の取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。本サービスは家庭内でこどもが利用することを想定しており、こどもの個人情報の保護には特に配慮しています。
	</p>

	<section>
		<h2>第1条（収集する情報）</h2>
		<p>運営者は、本サービスの提供にあたり、以下の情報を収集します。</p>

		<h3>1. アカウント情報</h3>
		<table>
			<thead>
				<tr><th>情報</th><th>用途</th><th>保存期間</th></tr>
			</thead>
			<tbody>
				<tr><td>メールアドレス</td><td>認証・通知</td><td>契約期間中</td></tr>
				<tr><td>表示名</td><td>サービス内表示</td><td>契約期間中</td></tr>
				<tr><td>パスワード（ハッシュ化）</td><td>認証</td><td>契約期間中</td></tr>
			</tbody>
		</table>

		<h3>2. こどもの情報</h3>
		<table>
			<thead>
				<tr><th>情報</th><th>用途</th><th>保存期間</th></tr>
			</thead>
			<tbody>
				<tr><td>ニックネーム</td><td>サービス内表示</td><td>契約期間中</td></tr>
				<tr><td>年齢区分</td><td>年齢に適した表示</td><td>契約期間中</td></tr>
				<tr><td>アバター画像</td><td>プロフィール表示</td><td>契約期間中</td></tr>
			</tbody>
		</table>

		<div class="privacy-highlight">
			<strong>こどもの個人情報保護について</strong>
			<ul>
				<li>こどもの本名の入力は必須ではありません。ニックネームでご利用いただけます。</li>
				<li>こどもが直接個人情報を入力する機能はありません。全ての登録は保護者が行います。</li>
				<li>学校名、住所、生年月日等の個人を特定できる情報は収集しません。</li>
			</ul>
		</div>

		<h3>3. 活動データ</h3>
		<table>
			<thead>
				<tr><th>情報</th><th>用途</th><th>保存期間</th></tr>
			</thead>
			<tbody>
				<tr><td>活動記録（ポイント、レベル等）</td><td>サービス機能提供</td><td>契約期間中</td></tr>
				<tr><td>実績・称号</td><td>サービス機能提供</td><td>契約期間中</td></tr>
				<tr><td>チェックリスト記録</td><td>サービス機能提供</td><td>契約期間中</td></tr>
			</tbody>
		</table>

		<h3>4. 利用ログ</h3>
		<table>
			<thead>
				<tr><th>情報</th><th>用途</th><th>保存期間</th></tr>
			</thead>
			<tbody>
				<tr><td>アクセス日時</td><td>セキュリティ・分析</td><td>90日間</td></tr>
				<tr><td>IPアドレス</td><td>不正アクセス防止</td><td>90日間</td></tr>
				<tr><td>デバイス情報（ブラウザ種別等）</td><td>表示最適化</td><td>90日間</td></tr>
			</tbody>
		</table>

		<h3>5. 決済情報</h3>
		<p>クレジットカード番号等の決済情報は、運営者のサーバーには保存されません。決済処理は全て Stripe, Inc. のシステムを通じて行われ、Stripeのプライバシーポリシーが適用されます。</p>
	</section>

	<section>
		<h2>第2条（情報の利用目的）</h2>
		<p>運営者は、収集した情報を以下の目的で利用します。</p>
		<ol>
			<li>本サービスの提供・運営・維持</li>
			<li>利用者の認証・本人確認</li>
			<li>サービスの改善・新機能の開発</li>
			<li>利用状況の分析・統計処理（個人を特定しない形式）</li>
			<li>重要なお知らせ・サービス変更の通知</li>
			<li>不正利用の防止・セキュリティの確保</li>
			<li>利用者からの問い合わせへの対応</li>
		</ol>
	</section>

	<section>
		<h2>第3条（情報の第三者提供）</h2>
		<ol>
			<li>運営者は、以下の場合を除き、利用者の個人情報を第三者に提供しません。
				<ul>
					<li>利用者の同意がある場合</li>
					<li>法令に基づく場合</li>
					<li>人の生命、身体または財産の保護のために必要がある場合であって、利用者の同意を得ることが困難な場合</li>
				</ul>
			</li>
			<li>運営者は、サービス提供のために以下の外部サービスを利用しています。
				<ul>
					<li><strong>Amazon Web Services (AWS)</strong> — サーバーインフラ、データベース、ファイルストレージ</li>
					<li><strong>Amazon Cognito</strong> — 認証基盤</li>
					<li><strong>Stripe, Inc.</strong> — 決済処理</li>
				</ul>
				各サービスは、それぞれのプライバシーポリシーに基づきデータを取り扱います。
			</li>
		</ol>
	</section>

	<section>
		<h2>第4条（データの安全管理）</h2>
		<ol>
			<li>通信は全て TLS 1.2 以上で暗号化されます。</li>
			<li>保存データは AES-256 で暗号化されます。</li>
			<li>パスワードは不可逆のハッシュ化処理（bcrypt）を施して保存されます。</li>
			<li>データベースは日次で自動バックアップされ、35日間保持されます。</li>
			<li>運営者は、個人情報への不正アクセス、紛失、破壊、改ざん、漏洩の防止のため、適切な安全管理措置を講じます。</li>
		</ol>
	</section>

	<section>
		<h2>第5条（利用者の権利）</h2>
		<p>利用者は、自己の個人情報について、以下の権利を有します。</p>
		<ol>
			<li><strong>開示請求</strong> — 運営者が保有する自己の個人情報の開示を請求できます。</li>
			<li><strong>訂正請求</strong> — 個人情報の内容が事実でない場合、訂正を請求できます。</li>
			<li><strong>削除請求</strong> — 個人情報の削除を請求できます。</li>
			<li><strong>利用停止請求</strong> — 個人情報の利用停止を請求できます。</li>
		</ol>
		<p>上記の請求は、本サービスの設定画面から行うか、下記のお問い合わせ先までご連絡ください。</p>
	</section>

	<section>
		<h2>第6条（データの削除）</h2>
		<ol>
			<li><strong>個別データの削除</strong>: 特定の活動記録やこどもの情報の削除は、本サービスの管理画面から即時実行できます。</li>
			<li><strong>アカウント全体の削除</strong>: アカウント削除を申請後、30日間の猶予期間を設けます。猶予期間中は削除の取消しが可能です。</li>
			<li><strong>バックアップからの完全消去</strong>: アカウント削除後90日以内に、バックアップデータからも完全に消去されます。</li>
		</ol>
	</section>

	<section>
		<h2>第7条（Cookieの使用）</h2>
		<ol>
			<li>本サービスは、認証状態の維持のためにCookieを使用します。</li>
			<li>本サービスが使用するCookieは、機能に必須のもののみであり、広告目的のトラッキングCookieは使用しません。</li>
			<li>使用するCookie:
				<ul>
					<li><strong>認証Cookie</strong> — ログイン状態の維持（セッション終了時またはTTL経過時に削除）</li>
					<li><strong>コンテキストCookie</strong> — 利用者のロール・テナント情報（セッション中のみ）</li>
				</ul>
			</li>
			<li>ブラウザの設定によりCookieを無効にすることができますが、本サービスの一部機能が利用できなくなる場合があります。</li>
		</ol>
	</section>

	<section>
		<h2>第8条（本ポリシーの変更）</h2>
		<ol>
			<li>運営者は、法令の改正、社会情勢の変化、またはサービス内容の変更に伴い、本ポリシーを変更することがあります。</li>
			<li>重要な変更を行う場合は、本サービス上での通知またはメールにより、変更内容と施行日をお知らせします。</li>
		</ol>
	</section>

	<section>
		<h2>第9条（お問い合わせ）</h2>
		<p>個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。</p>
		<div class="contact-info">
			<p>がんばりクエスト運営者</p>
			<p>メール: support@ganbari-quest.com</p>
		</div>
	</section>

	<section class="legal-effective">
		<p>以上</p>
		<p>制定日: 2026年3月26日</p>
	</section>
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

	.legal-intro {
		font-size: 0.9rem;
		margin-bottom: 32px;
		padding-bottom: 24px;
		border-bottom: 1px solid #e2e8f0;
	}

	.legal-doc h2 {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1e293b;
		margin: 32px 0 12px;
	}

	.legal-doc h3 {
		font-size: 0.95rem;
		font-weight: 600;
		color: #475569;
		margin: 20px 0 8px;
	}

	.legal-doc section {
		margin-bottom: 8px;
	}

	.legal-doc p {
		font-size: 0.9rem;
		margin: 8px 0;
	}

	.legal-doc ol,
	.legal-doc ul {
		font-size: 0.9rem;
		padding-left: 24px;
		margin: 8px 0;
	}

	.legal-doc li {
		margin: 6px 0;
	}

	.legal-doc a {
		color: #667eea;
		text-decoration: none;
	}

	.legal-doc a:hover {
		text-decoration: underline;
	}

	.legal-doc table {
		width: 100%;
		border-collapse: collapse;
		margin: 12px 0;
		font-size: 0.85rem;
	}

	.legal-doc th,
	.legal-doc td {
		padding: 8px 12px;
		border: 1px solid #e2e8f0;
		text-align: left;
	}

	.legal-doc th {
		background: #f8fafc;
		font-weight: 600;
		color: #475569;
	}

	.privacy-highlight {
		margin: 16px 0;
		padding: 16px;
		background: #f0f9ff;
		border: 1px solid #bae6fd;
		border-radius: 8px;
	}

	.privacy-highlight strong {
		display: block;
		margin-bottom: 8px;
		color: #0369a1;
	}

	.privacy-highlight ul {
		margin: 0;
		padding-left: 20px;
	}

	.privacy-highlight li {
		font-size: 0.85rem;
		color: #0c4a6e;
	}

	.contact-info {
		margin: 12px 0;
		padding: 16px;
		background: #f8fafc;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
	}

	.contact-info p {
		margin: 4px 0;
		font-size: 0.9rem;
	}

	.legal-effective {
		margin-top: 40px;
		padding-top: 24px;
		border-top: 1px solid #e2e8f0;
		text-align: right;
	}

	.legal-effective p {
		font-size: 0.85rem;
		color: #64748b;
		margin: 4px 0;
	}
</style>
