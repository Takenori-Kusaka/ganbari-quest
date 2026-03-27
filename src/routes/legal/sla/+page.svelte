<svelte:head>
	<title>サービスレベル合意（SLA） - がんばりクエスト</title>
</svelte:head>

<article class="legal-doc">
	<h1>サービスレベル合意（SLA）</h1>
	<p class="legal-meta">最終更新日: 2026年3月27日</p>

	<p class="legal-intro">
		本文書は、がんばりクエスト（以下「本サービス」）のサービスレベル目標を定めるものです。個人開発のSaaSとして現実的かつ誠実なコミットメントを示すことを目的としています。
	</p>

	<section>
		<h2>第1条（適用範囲）</h2>
		<ol>
			<li>本SLAは、本サービスのSaaS版（https://ganbari-quest.com）に適用されます。</li>
			<li>セルフホスト版（ユーザー自身の環境で動作するもの）には適用されません。</li>
			<li>本SLAは、運営者が合理的な努力により達成を目指す目標であり、法的な保証を構成するものではありません。</li>
		</ol>
	</section>

	<section>
		<h2>第2条（サービス可用性）</h2>
		<ol>
			<li>運営者は、本サービスの月間可用性 <strong>99.5%</strong> を目標とします。これは月間約3.6時間の計画外ダウンタイムに相当します。</li>
			<li>可用性は以下の計算式により算出します。
				<p class="formula">可用性（%）=（月間総時間 − 計画外ダウンタイム）÷ 月間総時間 × 100</p>
			</li>
			<li>以下は計画外ダウンタイムに含みません。
				<ul>
					<li>事前に通知された計画メンテナンス</li>
					<li>天災・戦争等の不可抗力による停止</li>
					<li>AWSの基盤障害（AWSのSLAに準拠）</li>
					<li>利用者側の環境に起因する接続障害</li>
				</ul>
			</li>
		</ol>
	</section>

	<section>
		<h2>第3条（計画メンテナンス）</h2>
		<ol>
			<li>運営者は、本サービスの改善・保守のため、計画的なメンテナンスを実施することがあります。</li>
			<li>計画メンテナンスは原則として以下の条件で実施します。
				<ul>
					<li>頻度: 月1回以内</li>
					<li>時間帯: 日本時間 2:00〜5:00（利用の少ない深夜帯）</li>
					<li>事前通知: 48時間前までにメールまたはアプリ内通知</li>
				</ul>
			</li>
			<li>緊急のセキュリティパッチ等、事前通知なく実施する場合があります。この場合は可能な限り速やかに通知します。</li>
		</ol>
	</section>

	<section>
		<h2>第4条（データ保護）</h2>
		<table class="sla-table">
			<thead>
				<tr><th>項目</th><th>内容</th></tr>
			</thead>
			<tbody>
				<tr><td>データバックアップ</td><td>日次自動バックアップ（AWS Backup）</td></tr>
				<tr><td>バックアップ保持期間</td><td>3日間</td></tr>
				<tr><td>通信時暗号化</td><td>TLS 1.2以上（HTTPS強制）</td></tr>
				<tr><td>保存時暗号化</td><td>AES-256（AWS S3/DynamoDB標準）</td></tr>
				<tr><td>障害復旧目標（RTO）</td><td>4時間以内</td></tr>
				<tr><td>復旧時点目標（RPO）</td><td>24時間以内（日次バックアップ間隔）</td></tr>
			</tbody>
		</table>
	</section>

	<section>
		<h2>第5条（障害通知）</h2>
		<ol>
			<li>サービス障害が発生した場合、運営者は以下の方法で利用者に通知します。
				<ul>
					<li>アプリ画面上のメンテナンスページ表示（自動）</li>
					<li>登録メールアドレスへの通知（重大障害時）</li>
				</ul>
			</li>
			<li>障害の検知は、CloudWatch監視アラームおよび外部死活監視により自動化されています。</li>
			<li>障害発生時の対応目標は以下の通りです。
				<ul>
					<li>検知: 5分以内（自動アラート）</li>
					<li>初期対応開始: 1時間以内</li>
					<li>サービス復旧: 4時間以内（RTO）</li>
				</ul>
			</li>
		</ol>
	</section>

	<section>
		<h2>第6条（サポート対応）</h2>
		<table class="sla-table">
			<thead>
				<tr><th>項目</th><th>内容</th></tr>
			</thead>
			<tbody>
				<tr><td>対応チャンネル</td><td>メール / Discord</td></tr>
				<tr><td>受付時間</td><td>24時間（自動受付）</td></tr>
				<tr><td>初回応答目標</td><td>48時間以内（営業日ベース）</td></tr>
				<tr><td>対応言語</td><td>日本語</td></tr>
			</tbody>
		</table>
		<p>個人運営のため、応答が遅れる場合があります。ご理解をお願いいたします。</p>
	</section>

	<section>
		<h2>第7条（免責事項）</h2>
		<ol>
			<li>本サービスは個人開発によるものであり、エンタープライズ向けサービスと同等の可用性を保証するものではありません。</li>
			<li>本SLAに定める目標値を達成できなかった場合でも、運営者は損害賠償義務を負いません。</li>
			<li>本SLAの内容は、サービスの改善に伴い変更される場合があります。重要な変更がある場合は事前に通知します。</li>
		</ol>
	</section>

	<section>
		<h2>第8条（インフラストラクチャ）</h2>
		<p>本サービスは以下のAWSサービスを基盤として運用されています。</p>
		<table class="sla-table">
			<thead>
				<tr><th>コンポーネント</th><th>AWSサービス</th><th>AWS SLA</th></tr>
			</thead>
			<tbody>
				<tr><td>アプリケーション</td><td>AWS Lambda</td><td>99.95%</td></tr>
				<tr><td>データベース</td><td>Amazon DynamoDB</td><td>99.999%</td></tr>
				<tr><td>CDN</td><td>Amazon CloudFront</td><td>99.9%</td></tr>
				<tr><td>認証</td><td>Amazon Cognito</td><td>99.9%</td></tr>
				<tr><td>ストレージ</td><td>Amazon S3</td><td>99.9%</td></tr>
			</tbody>
		</table>
	</section>

	<div class="legal-effective">
		<p>制定日: 2026年3月27日</p>
		<p>がんばりクエスト運営者</p>
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

	.formula {
		background: #f1f5f9;
		padding: 12px 16px;
		border-radius: 8px;
		font-family: monospace;
		font-size: 0.85rem;
		margin: 12px 0;
	}

	.sla-table {
		width: 100%;
		border-collapse: collapse;
		margin: 12px 0;
		font-size: 0.85rem;
	}

	.sla-table th,
	.sla-table td {
		border: 1px solid #e2e8f0;
		padding: 8px 12px;
		text-align: left;
	}

	.sla-table th {
		background: #f8fafc;
		font-weight: 600;
		color: #475569;
	}

	.sla-table td {
		color: #334155;
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
