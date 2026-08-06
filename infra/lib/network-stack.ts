import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends cdk.StackProps {
	functionUrl: lambda.FunctionUrl;
	// #4280 案 b: CloudFront → origin の shared secret (`x-origin-verify` header)。
	// **必須**。optional にすると「header を付け忘れた distribution」を型で表現できてしまい、
	// その配備は CloudFront 層の制御を Function URL 直叩きで迂回可能なまま黙って動く。
	// 値の解決と未設定時の fail-fast は `infra/lib/origin-verify-context.ts` が単一点で担う。
	originVerifySecret: string;
	domainName?: string;
	certificateArn?: string;
	// --- ADR-0048 Multi-Lambda Demo (#2097 week 4) ---
	// demo Lambda の Function URL。本番と独立した CloudFront Distribution の origin にする。
	demoFunctionUrl?: lambda.FunctionUrl;
	// demo 用 sub-domain (default: `demo.${domainName}`)。
	demoDomainName?: string;
	// demo 用 ACM 証明書 ARN。
	//   - 本番 `certificateArn` が wildcard (`*.ganbari-quest.com`) を含む場合は同じ ARN を渡せる
	//   - apex 専用証明書の場合は demo 専用証明書 ARN を新規発行して渡す
	//   - 未指定 (undefined) の場合は本番 `certificateArn` を fallback する
	demoCertificateArn?: string;
	// --- #3087 解決策 B: /_app/immutable/* の S3 origin offload ---
	// true の場合、SvelteKit の content-hash 済 immutable 静的アセット (/_app/immutable/*) を
	// Lambda(Function URL) ではなく S3 (OAC) から配信する。Lambda は HTML/API/動的のみ担う。
	// false (default) の場合は従来どおり Origin Shield 経由の Lambda origin が /_app/* 全体を
	// 配信する (#3087 解決策 A)。本番 template 不変条件 = flag OFF で従来構成と byte 一致。
	staticAssetsS3Offload?: boolean;
	// staticAssetsS3Offload=true 時に必須。`_app/immutable/` を含むディレクトリ
	// (= SvelteKit build 出力 `build/client` 相当)。deploy.yml が deploy 済 Docker image から
	// `docker cp /app/client` で抽出し `infra/static-assets` に配置する (Lambda が配信するのと
	// 同一 build artifact = content-hash 完全一致を構造的に保証)。未配置のまま flag ON だと
	// throw する (ADR-0006 silent skip 禁止)。
	staticAssetsSourceDir?: string;
	// --- #4204: staging 用 CloudFront ---
	// 物理名 prefix。既定は 'ganbari-quest' (= PROD_ENV_CONFIG.resourcePrefix) で、
	// **本番 template は byte 一致のまま**。staging は 'ganbari-quest-staging' を渡して
	// 同一アカウント・同一リージョンでの物理名衝突を避ける
	// (error pages bucket / CloudFront Function 名の 2 件がハードコードだった)。
	resourcePrefix?: string;
	// CloudFront の地域制限。既定 (未指定) は本番と同じ JP allowlist。
	// **staging は `[]` を渡して制限を外す** — post-deploy smoke を回す GitHub Actions runner が
	// 日本国外にあり、制限を残すと 403 で smoke が回らないため。
	//
	// ⚠️ staging を全世界公開にできる前提は「**staging に本番データが入っていない**」こと。
	// PO 実測 (2026-08-02): 本番 cluster 1,801,692 bytes に対し staging 1,031,956 bytes (57%)。
	// 本番 snapshot をコピーしていれば同等以上になるため、コピーされていないと判断した。
	// **staging に本番データを入れる運用が将来生まれた場合は JP allowlist を戻すこと** (PO 条件)。
	//
	// #4280: geoRestriction は **CloudFront 層の制御であり、Lambda Function URL 直叩きには効かない**
	// (authType=NONE、CloudFront → origin の shared secret / origin 制限なし)。
	// JP allowlist を戻しても「日本国外から到達できない」ことにはならない。詳細は本 file の
	// CloudFront Function 定義箇所のコメント / docs/design/14-セキュリティ設計書.md §11.5。
	geoRestrictionCountries?: string[];
}

export class NetworkStack extends cdk.Stack {
	public readonly distribution: cloudfront.Distribution;
	public readonly demoDistribution?: cloudfront.Distribution;
	// #3402-1: staticAssetsS3Offload=true 時のみ生成される immutable アセット bucket。OpsStack が
	// S3 origin 専用 4xx/5xx alarm を張るため公開する (offload OFF 時は undefined = alarm も作らない)。
	public readonly staticAssetsBucket?: s3.Bucket;

	constructor(scope: Construct, id: string, props: NetworkStackProps) {
		super(scope, id, props);

		// #4204: 物理名 prefix。既定は本番値なので **prod template は byte 一致**のまま。
		const prefix = props.resourcePrefix ?? 'ganbari-quest';
		// CloudFront の CachePolicy 名は **アカウント全体で一意**。kebab の prefix をそのまま使えないため
		// PascalCase に変換する (既定は 'GanbariQuest' = 現行 prod 値と一致)。
		const namePascal = prefix
			.split('-')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join('');

		// Parse Lambda Function URL to get the hostname
		const fnUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', props.functionUrl.url));

		// --- Route 53 + ACM (use existing resources) ---
		let hostedZone: route53.IHostedZone | undefined;
		let certificate: acm.ICertificate | undefined;

		if (props.domainName) {
			// Lookup existing hosted zone (created manually in Route53)
			hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
				domainName: props.domainName,
			});

			// Use existing ACM certificate (created and validated manually)
			if (props.certificateArn) {
				certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn);
			}
		}

		// --- CloudFront Function: query slash encode ---
		// SvelteKit form actions use ?/action-name pattern, but Lambda Function URL rejects
		// forward slashes in query strings.
		//
		// #4266 (PO 決裁 2026-08-05): 旧 admin IP allowlist (`adminAllowedIps` context で
		// /admin・/api/v1/admin・/ops を許可 IP 以外 403 にする分岐) を**撤去**した。
		//   - 対象 path に `/admin` (= 保護者 = 顧客の見守り画面) が含まれ、有効化すると全顧客が 403
		//   - 運営者のグローバル IP は固定でなく、プロキシ経由では event.viewer.ip が回線 IP と不一致
		// /ops の防御はアプリ層 (ops group + MFA、src/lib/server/auth/ops-authz.ts hasOpsAccess) が担う。
		// 復活させない不変条件は tests/unit/infra/admin-no-ip-allowlist.test.ts が assert する。
		//
		// #4280: **CloudFront Function は viewer request にしか介在しない**。本 stack が掛ける
		// CloudFront 層の制御 (本 Function / 下記 geoRestriction / 将来もし IP allowlist を戻す場合) は、
		// **Lambda Function URL を直接叩く経路には一切効かない**。Function URL は
		// compute-stack.ts で authType=NONE で公開されており、CloudFront → origin 間に
		// 共有シークレット header の検証も origin 制限 (OAC 相当) も無いため、URL を知る者は
		// CloudFront を迂回できる。**URL の推測困難さは防御層として数えない**
		// (ログ / エラー画面 / 外部サービスへの登録値から漏れた時点で無効になる)。
		// /admin・/ops を実際に守っているのはアプリ層 (Cognito 認証 + 親 PIN gate / ops group + MFA) だけである。
		// 迂回を塞ぐ方式 (CloudFront → origin の custom header 等値検査) は #4280 で別途扱う。
		// 防御層マトリクスの SSOT: docs/design/14-セキュリティ設計書.md §11.5。
		const cfFunctionCode = `
function handler(event) {
  var request = event.request;
  var qs = request.querystring;
  var newQs = {};
  for (var key in qs) {
    var encodedKey = key.replace(/\\//g, '%2F');
    newQs[encodedKey] = qs[key];
  }
  request.querystring = newQs;
  return request;
}
`;

		const queryFixFn = new cloudfront.Function(this, 'QuerySlashEncodeFn', {
			functionName: `${prefix}-query-slash-encode`,
			code: cloudfront.FunctionCode.fromInline(cfFunctionCode),
			runtime: cloudfront.FunctionRuntime.JS_2_0,
		});

		// --- S3 error pages bucket (Network-local to avoid cross-stack cycle) ---
		const errorPagesBucket = new s3.Bucket(this, 'ErrorPagesBucket', {
			bucketName: `${prefix}-error-pages-${this.account}`,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
		});

		// --- S3 Origin for error pages (served from S3 even when Lambda is down) ---
		const s3ErrorOrigin = origins.S3BucketOrigin.withOriginAccessControl(errorPagesBucket);

		// --- front door 証明 header (#4280 案 b) ---
		// Lambda Function URL は authType: NONE で公開されており、URL を知っていれば
		// CloudFront を経由せず直接到達できる。CloudFront 層に置いた制御 (geoRestriction JP 等)
		// は**その経路には効かない**。origin custom header で「CloudFront を通った」ことを
		// 証明し、origin (hooks.server.ts) が /admin ・ /api/v1/admin ・ /ops で一致を要求する。
		//
		// CloudFront は viewer が同名 header を送ってきても**設定値で上書き**するため、
		// 外部から偽装して通ることはできない。origin への転送は HTTPS_ONLY。
		//
		// 対象は Lambda を指す 2 origin (default 動作の lambdaOrigin と /_app/* の
		// staticAssetOrigin)。同一 Lambda なので両方に同じ header を付ける。S3 origin
		// (error pages / immutable assets) は OAC で守られており本 header の対象外。
		const originVerifyHeaders = { 'x-origin-verify': props.originVerifySecret };

		// --- CloudFront Distribution ---
		const lambdaOrigin = new origins.HttpOrigin(fnUrlDomain, {
			protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
			customHeaders: originVerifyHeaders,
		});

		// --- Origin Shield origin for /_app/* static assets (#3087) ---
		// adapter-node + Lambda Web Adapter 構成では SvelteKit の build 済 client 静的
		// アセット (/_app/immutable/*) も Lambda(Function URL) が配信する。エッジ cache が
		// cold の間、親画面 1 表示で ~224 本のチャンクが Lambda origin を一斉直撃し、
		// Lambda 同時実行スロットル (TooManyRequestsException / 429) + HTTP/1.1 接続キュー
		// 輻輳で最遅 ~16s に達していた (HAR 実測、#3087)。
		// Origin Shield (regional mid-tier cache) を /_app/* 専用 origin に有効化し、
		// cold-miss burst を 1 リージョンに集約 = 同一アセットの同時 origin fetch を 1 本に
		// collapse + 二次キャッシュで Lambda 直撃を激減させる。region は origin (Lambda) と
		// 同一の us-east-1 (infra/CLAUDE.md「全リソース us-east-1 固定」整合)。
		// default behavior (HTML/API、CACHING_DISABLED) は Origin Shield 経由にすると
		// キャッシュ無しの動的応答に余計な hop が乗るため、shield なしの lambdaOrigin を維持し、
		// 静的アセットのみ別 origin (staticAssetOrigin) に分離する。
		const staticAssetOrigin = new origins.HttpOrigin(fnUrlDomain, {
			protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
			originShieldEnabled: true,
			originShieldRegion: 'us-east-1',
			customHeaders: originVerifyHeaders,
		});

		// 静的アセット用 cache policy (365 日 immutable)。/_app/* (shield lambda) と
		// /_app/immutable/* (S3 offload 時) で共有する。
		const staticAssetsCachePolicy = new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
			cachePolicyName: `${namePascal}StaticAssets`,
			defaultTtl: cdk.Duration.days(365),
			maxTtl: cdk.Duration.days(365),
			minTtl: cdk.Duration.days(1),
			enableAcceptEncodingGzip: true,
			enableAcceptEncodingBrotli: true,
		});

		// --- #3087 解決策 B: /_app/immutable/* を S3 (OAC) から配信する ---
		// adapter-node の build 済 client immutable アセット (content-hash 付き) を S3 に upload し、
		// /_app/immutable/* behavior の origin を S3 (OAC) にする。Lambda は HTML/API のみ担うため
		// cold-miss burst でも Lambda を 0 本直撃 = TooManyRequestsException (429) が構造的に消滅する。
		// flag OFF (default) の場合は何も生成せず従来構成 (Lambda + Origin Shield が /_app/* 全体配信)
		// を維持する (本番 template 不変条件)。
		// 宣言順注意: behavior は /error/* → /_app/immutable/* → /_app/* の順に宣言し、既存
		// s3ErrorOrigin を origin index 2 に preempt し続ける (OAC 論理 ID churn = CloudFront
		// replacement を防ぐ、#3102 / ADR-0019)。
		let prodImmutableS3Origin: cloudfront.IOrigin | undefined;
		let demoImmutableS3Origin: cloudfront.IOrigin | undefined;
		// #3402-2: distribution が S3 immutable origin を指すより前に BucketDeployment (upload) を
		// 完了させるため、後段で distribution.node.addDependency() に渡す。
		let staticAssetsDeploy: s3deploy.BucketDeployment | undefined;
		if (props.staticAssetsS3Offload) {
			const srcDir = props.staticAssetsSourceDir;
			const immutableDir = srcDir ? path.join(srcDir, '_app', 'immutable') : undefined;
			if (!immutableDir || !fs.existsSync(immutableDir)) {
				// ADR-0006: silent skip 禁止。flag ON で asset 不在は build / 抽出漏れの hard error。
				throw new Error(
					`[network-stack] staticAssetsS3Offload=true requires SvelteKit immutable assets at ${immutableDir ?? '<staticAssetsSourceDir unset>'}. ` +
						'Run `npm run build` and extract `build/client` (deploy.yml: docker cp <image>:/app/client) into the source dir before synth (#3087 / ADR-0006).',
				);
			}

			// network-local bucket (cross-stack cycle 回避、errorPagesBucket と同方針)。
			// immutable 静的アセット専用。各 deploy で再 upload されるため DESTROY + autoDelete で良い。
			const staticAssetsBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
				bucketName: `${prefix}-static-assets-${this.account}`,
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				autoDeleteObjects: true,
				blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
				encryption: s3.BucketEncryption.S3_MANAGED,
				// #3402-3: prune:false で旧 hash を残す運用のため、放置すると deploy ごとに旧 immutable
				// hash が無限蓄積する。deploy window (数分) を大きく超える 30 日で expiration し剪定する。
				// content-hash 付き immutable アセットは 30 日以上前の HTML から参照されることはない
				// (HTML は Lambda が毎 deploy 更新、旧 HTML の TTL も短い)。誤削除リスクなし。
				lifecycleRules: [
					{
						id: 'expire-old-immutable-hashes',
						enabled: true,
						prefix: '_app/immutable/',
						expiration: cdk.Duration.days(30),
					},
				],
				// #3402-1: S3 origin 専用 4xx/5xx alarm (OpsStack) のため request metrics を有効化する
				// (#3939: BucketProps.metrics が L2 で公開されているため escape hatch 不要)。
				metrics: [{ id: 'EntireBucket' }],
			});
			this.staticAssetsBucket = staticAssetsBucket;

			// content-hash 付きで immutable。prune:false で旧 hash を残し、deploy window 中に
			// 旧 HTML (Lambda 由来) が参照する旧 chunk が 403 にならないようにする。
			staticAssetsDeploy = new s3deploy.BucketDeployment(this, 'StaticAssetsDeploy', {
				sources: [s3deploy.Source.asset(immutableDir)],
				destinationBucket: staticAssetsBucket,
				destinationKeyPrefix: '_app/immutable',
				prune: false,
				cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
			});

			// 本番 / demo は同一 Docker image (= 同一 build) の immutable アセットを配信するため
			// 1 つの bucket を共有する。distribution ごとに OAC + bucket policy が必要なため origin は
			// それぞれ生成する (同一 bucket を参照)。
			prodImmutableS3Origin = origins.S3BucketOrigin.withOriginAccessControl(staticAssetsBucket);
			demoImmutableS3Origin = origins.S3BucketOrigin.withOriginAccessControl(staticAssetsBucket);
		}

		// 本番 distribution の additionalBehaviors を宣言順 (origin index) に組み立てる。
		const prodAdditionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {
			// #3087: /error/* を最初に宣言し s3ErrorOrigin を origin index 2 に固定する。
			'/error/*': {
				origin: s3ErrorOrigin,
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
			},
		};
		if (prodImmutableS3Origin) {
			// /_app/immutable/* は /_app/* より specific なため CloudFront が優先 match する。
			prodAdditionalBehaviors['/_app/immutable/*'] = {
				origin: prodImmutableS3Origin,
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				cachePolicy: staticAssetsCachePolicy,
			};
		}
		// /_app/* (version.json 等 non-immutable / offload OFF 時は immutable も含む) は引き続き
		// Lambda + Origin Shield。offload ON でも /_app/version.json (no-cache、burst しない) はここ。
		prodAdditionalBehaviors['/_app/*'] = {
			origin: staticAssetOrigin,
			viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
			cachePolicy: staticAssetsCachePolicy,
		};

		this.distribution = new cloudfront.Distribution(this, 'CDN', {
			comment: 'Ganbari Quest',
			defaultBehavior: {
				origin: lambdaOrigin,
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
				originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
				allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
				responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
				functionAssociations: [
					{
						function: queryFixFn,
						eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
					},
				],
			},
			additionalBehaviors: prodAdditionalBehaviors,
			errorResponses: [
				{
					httpStatus: 500,
					responsePagePath: '/error/500.html',
					responseHttpStatus: 500,
					ttl: cdk.Duration.seconds(30),
				},
				{
					httpStatus: 502,
					responsePagePath: '/error/502.html',
					responseHttpStatus: 502,
					ttl: cdk.Duration.seconds(30),
				},
				{
					httpStatus: 503,
					responsePagePath: '/error/503.html',
					responseHttpStatus: 503,
					ttl: cdk.Duration.seconds(60),
				},
				{
					httpStatus: 504,
					responsePagePath: '/error/504.html',
					responseHttpStatus: 504,
					ttl: cdk.Duration.seconds(30),
				},
			],
			// Custom domain settings (applied only when domain + certificate are provided)
			// www is served by GitHub Pages (not CloudFront) — see #0160
			...(props.domainName && certificate
				? {
						domainNames: [props.domainName],
						certificate,
					}
				: {}),
			priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
			httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
			// #4204: 既定 (未指定) は本番と同じ JP allowlist。staging は `[]` で制限なし。
			// 空配列で allowlist を作ると CDK が throw するため、指定なし扱いに分岐する。
			...(props.geoRestrictionCountries?.length === 0
				? {}
				: {
						geoRestriction: cloudfront.GeoRestriction.allowlist(
							...(props.geoRestrictionCountries ?? ['JP']),
						),
					}),
		});

		// #3402-2: offload 初回有効化時、distribution が /_app/immutable/* を S3 に向ける更新と
		// BucketDeployment(upload) の CFN 順序が保証されないと、短い propagation 窓で S3 が空を指し
		// 403 (親画面 JS 白画面化) になり得る。distribution を BucketDeployment に依存させ、upload 完了後に
		// distribution を更新する順序を強制してこの窓を塞ぐ (Origin Group failover は #3087 の origin
		// index preempt 不変条件を churn させるため不採用、CFN 依存で低リスクに解決)。
		if (staticAssetsDeploy) {
			this.distribution.node.addDependency(staticAssetsDeploy);
		}

		// --- Deploy error pages to S3 ---
		new s3deploy.BucketDeployment(this, 'ErrorPagesDeploy', {
			sources: [s3deploy.Source.asset(path.join(__dirname, '../error-pages'))],
			destinationBucket: errorPagesBucket,
			destinationKeyPrefix: 'error',
		});

		// --- Route 53 Alias Records ---
		if (hostedZone && props.domainName) {
			new route53.ARecord(this, 'AliasRecord', {
				zone: hostedZone,
				target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
			});

			new route53.AaaaRecord(this, 'AliasRecordAAAA', {
				zone: hostedZone,
				target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
			});

			// www → GitHub Pages LP
			new route53.CnameRecord(this, 'WwwRecord', {
				zone: hostedZone,
				recordName: 'www',
				domainName: 'kokor.github.io',
			});

			// --- Apex ドメイン TXT レコード（統合） ---
			// Google Search Console ドメイン所有確認 (#328)
			// Stripe ドメイン所有確認 (#0246)
			// ※ 同一ドメインのTXTレコードは1つに統合する必要がある（Route 53制約）
			new route53.TxtRecord(this, 'ApexTxtRecords', {
				zone: hostedZone,
				values: [
					'google-site-verification=WhDKAgGbFDHHgi-1hXJSo344zNmTY1j0BdYc09dy4Lk',
					'stripe-verification=b0276ff8bdfbb406277f328df069e3125243dcc66dbab67a879e40a9a41775bf',
				],
			});

			// TXT: DMARC ポリシー
			new route53.TxtRecord(this, 'StripeDmarc', {
				zone: hostedZone,
				recordName: '_dmarc',
				values: ['v=DMARC1; p=none; rua=mailto:dmarc@ganbari-quest.com'],
			});

			// DKIM CNAME レコード (6件)
			const stripeDkimRecords: [string, string][] = [
				[
					'2lxhcyzg45h3ki74cqu2q62disli3r2i._domainkey',
					'2lxhcyzg45h3ki74cqu2q62disli3r2i.dkim.custom-email-domain.stripe.com.',
				],
				[
					'p2whjut6rekn3vb327dzc32uit4iheln._domainkey',
					'p2whjut6rekn3vb327dzc32uit4iheln.dkim.custom-email-domain.stripe.com.',
				],
				[
					'u7pyxxke42xi3xirfzegpgaha7zu7mo6._domainkey',
					'u7pyxxke42xi3xirfzegpgaha7zu7mo6.dkim.custom-email-domain.stripe.com.',
				],
				[
					'zfuvjoxtlyzdq243t2tpavrf7xaplkat._domainkey',
					'zfuvjoxtlyzdq243t2tpavrf7xaplkat.dkim.custom-email-domain.stripe.com.',
				],
				[
					'6khrfj5mxtz4beixdyeyk7fkhl4an3as._domainkey',
					'6khrfj5mxtz4beixdyeyk7fkhl4an3as.dkim.custom-email-domain.stripe.com.',
				],
				[
					'pzztpaebpfqf3b5rowr2cbyohxnlojds._domainkey',
					'pzztpaebpfqf3b5rowr2cbyohxnlojds.dkim.custom-email-domain.stripe.com.',
				],
			];

			stripeDkimRecords.forEach(([name, value], i) => {
				new route53.CnameRecord(this, `StripeDkim${i + 1}`, {
					zone: hostedZone!,
					recordName: name,
					domainName: value,
				});
			});

			// Stripe bounce CNAME
			new route53.CnameRecord(this, 'StripeBounce', {
				zone: hostedZone,
				recordName: 'bounce',
				domainName: 'custom-email-domain.stripe.com.',
			});
		}

		// --- ADR-0048 Multi-Lambda Demo Distribution (#2097 week 4) ---
		// 本番と独立した CloudFront Distribution を `demo.ganbari-quest.com` に配置する。
		//   - Origin = demo Lambda の Function URL
		//   - 同じ cache policy / origin request policy / security headers / CF function (query slash encode)
		//   - geoRestriction も本番と同じ JP 限定 (Pre-PMF 段階)
		if (props.demoFunctionUrl && props.domainName) {
			const demoDomainName = props.demoDomainName ?? `demo.${props.domainName}`;
			const demoCertArn = props.demoCertificateArn ?? props.certificateArn;

			const demoCertificate = demoCertArn
				? acm.Certificate.fromCertificateArn(this, 'DemoCertificate', demoCertArn)
				: undefined;

			const demoFnUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', props.demoFunctionUrl.url));
			const demoLambdaOrigin = new origins.HttpOrigin(demoFnUrlDomain, {
				protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
			});

			// /_app/* 静的アセット用 Origin Shield origin (#3087、本番と同型)。
			const demoStaticAssetOrigin = new origins.HttpOrigin(demoFnUrlDomain, {
				protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
				originShieldEnabled: true,
				originShieldRegion: 'us-east-1',
			});

			const demoStaticAssetsCachePolicy = new cloudfront.CachePolicy(
				this,
				'DemoStaticAssetsCachePolicy',
				{
					cachePolicyName: `${namePascal}DemoStaticAssets`,
					defaultTtl: cdk.Duration.days(365),
					maxTtl: cdk.Duration.days(365),
					minTtl: cdk.Duration.days(1),
					enableAcceptEncodingGzip: true,
					enableAcceptEncodingBrotli: true,
				},
			);

			// #3087 解決策 B (本番と同型): /_app/immutable/* を S3 (OAC) から配信。
			// 宣言順 /_app/immutable/* → /_app/* で immutable S3 origin を先に採番する。
			const demoAdditionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
			if (demoImmutableS3Origin) {
				demoAdditionalBehaviors['/_app/immutable/*'] = {
					origin: demoImmutableS3Origin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
					cachePolicy: demoStaticAssetsCachePolicy,
				};
			}
			demoAdditionalBehaviors['/_app/*'] = {
				origin: demoStaticAssetOrigin,
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				cachePolicy: demoStaticAssetsCachePolicy,
			};

			// demo 用 CloudFront Function: query slash encode のみ。
			const demoQueryFixFn = new cloudfront.Function(this, 'DemoQuerySlashEncodeFn', {
				functionName: `${prefix}-demo-query-slash-encode`,
				code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var qs = request.querystring;
  var newQs = {};
  for (var key in qs) {
    var encodedKey = key.replace(/\\//g, '%2F');
    newQs[encodedKey] = qs[key];
  }
  request.querystring = newQs;
  return request;
}
`),
				runtime: cloudfront.FunctionRuntime.JS_2_0,
			});

			this.demoDistribution = new cloudfront.Distribution(this, 'DemoCDN', {
				comment: 'Ganbari Quest Demo (ADR-0048)',
				defaultBehavior: {
					origin: demoLambdaOrigin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
					cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
					originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
					allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
					responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
					functionAssociations: [
						{
							function: demoQueryFixFn,
							eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
						},
					],
				},
				additionalBehaviors: demoAdditionalBehaviors,
				...(demoCertificate
					? {
							domainNames: [demoDomainName],
							certificate: demoCertificate,
						}
					: {}),
				priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
				httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
				geoRestriction: cloudfront.GeoRestriction.allowlist('JP'),
			});

			// #3402-2: demo distribution も本番同型で BucketDeployment(upload) 完了後に更新する順序を強制。
			if (staticAssetsDeploy) {
				this.demoDistribution.node.addDependency(staticAssetsDeploy);
			}

			// Route 53 ALIAS A + AAAA レコード: demo.ganbari-quest.com → demoDistribution
			if (hostedZone) {
				new route53.ARecord(this, 'DemoAliasRecord', {
					zone: hostedZone,
					recordName: demoDomainName,
					target: route53.RecordTarget.fromAlias(
						new targets.CloudFrontTarget(this.demoDistribution),
					),
				});

				new route53.AaaaRecord(this, 'DemoAliasRecordAAAA', {
					zone: hostedZone,
					recordName: demoDomainName,
					target: route53.RecordTarget.fromAlias(
						new targets.CloudFrontTarget(this.demoDistribution),
					),
				});
			}

			new cdk.CfnOutput(this, 'DemoDistributionDomainName', {
				value: this.demoDistribution.distributionDomainName,
			});
			new cdk.CfnOutput(this, 'DemoDistributionId', {
				value: this.demoDistribution.distributionId,
			});
			new cdk.CfnOutput(this, 'DemoAppUrl', {
				value: `https://${demoDomainName}`,
			});
		}

		// --- Outputs ---
		new cdk.CfnOutput(this, 'DistributionDomainName', {
			value: this.distribution.distributionDomainName,
		});
		new cdk.CfnOutput(this, 'DistributionId', {
			value: this.distribution.distributionId,
		});
		if (props.domainName) {
			new cdk.CfnOutput(this, 'AppUrl', {
				value: `https://${props.domainName}`,
			});
		}
	}
}
