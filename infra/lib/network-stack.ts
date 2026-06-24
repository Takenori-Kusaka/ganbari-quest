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
}

export class NetworkStack extends cdk.Stack {
	public readonly distribution: cloudfront.Distribution;
	public readonly demoDistribution?: cloudfront.Distribution;

	constructor(scope: Construct, id: string, props: NetworkStackProps) {
		super(scope, id, props);

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

		// --- Admin IP allowlist (from CDK context, comma-separated) ---
		const adminAllowedIps =
			(this.node.tryGetContext('adminAllowedIps') as string | undefined) ?? '';

		// --- CloudFront Function: query slash encode + admin IP filter ---
		// 1. Admin IP restriction: /admin/* and /api/v1/admin/* require allowlisted IPs
		// 2. Query slash encode: SvelteKit form actions use ?/action-name pattern,
		//    but Lambda Function URL rejects forward slashes in query strings.
		const cfFunctionCode = adminAllowedIps
			? `
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Admin IP restriction
  if (uri.startsWith('/admin') || uri.startsWith('/api/v1/admin') || uri.startsWith('/ops')) {
    var ALLOWED_IPS = ${JSON.stringify(
			adminAllowedIps
				.split(',')
				.map((ip: string) => ip.trim())
				.filter(Boolean),
		)};
    var clientIp = event.viewer.ip;
    if (ALLOWED_IPS.indexOf(clientIp) === -1) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden',
        headers: { 'content-type': { value: 'text/html; charset=utf-8' } },
        body: '<html><body><h1>Access Restricted</h1></body></html>',
      };
    }
  }

  // Query string slash encode
  var qs = request.querystring;
  var newQs = {};
  for (var key in qs) {
    var encodedKey = key.replace(/\\//g, '%2F');
    newQs[encodedKey] = qs[key];
  }
  request.querystring = newQs;
  return request;
}
`
			: `
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
			functionName: 'ganbari-quest-query-slash-encode',
			code: cloudfront.FunctionCode.fromInline(cfFunctionCode),
			runtime: cloudfront.FunctionRuntime.JS_2_0,
		});

		// --- S3 error pages bucket (Network-local to avoid cross-stack cycle) ---
		const errorPagesBucket = new s3.Bucket(this, 'ErrorPagesBucket', {
			bucketName: `ganbari-quest-error-pages-${this.account}`,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
		});

		// --- S3 Origin for error pages (served from S3 even when Lambda is down) ---
		const s3ErrorOrigin = origins.S3BucketOrigin.withOriginAccessControl(errorPagesBucket);

		// --- CloudFront Distribution ---
		const lambdaOrigin = new origins.HttpOrigin(fnUrlDomain, {
			protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
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
		});

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
			additionalBehaviors: {
				// #3087: /error/* を /_app/* より先に宣言する。CDK は behavior の宣言順に origin
				// index (CDNOrigin2/3...) を採番するため、既存 s3ErrorOrigin の index を 2 のまま
				// 維持し、新規追加する staticAssetOrigin を末尾 (index 3) に置く。これにより既存
				// error origin の OriginAccessControl 論理 ID が変わらず、cdk diff の不要な
				// destroy/recreate (ADR-0019 gate ノイズ) を避ける。path pattern は非重複のため
				// 宣言順は CloudFront のマッチング結果に影響しない。
				'/error/*': {
					origin: s3ErrorOrigin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
					cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
				},
				'/_app/*': {
					origin: staticAssetOrigin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
					cachePolicy: new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
						cachePolicyName: 'GanbariQuestStaticAssets',
						defaultTtl: cdk.Duration.days(365),
						maxTtl: cdk.Duration.days(365),
						minTtl: cdk.Duration.days(1),
						enableAcceptEncodingGzip: true,
						enableAcceptEncodingBrotli: true,
					}),
				},
			},
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
			geoRestriction: cloudfront.GeoRestriction.allowlist('JP'),
		});

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
		//   - admin IP 制限は demo には適用しない (anonymous public demo のため)
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

			// demo 用 CloudFront Function: query slash encode のみ (admin IP 制限なし)。
			const demoQueryFixFn = new cloudfront.Function(this, 'DemoQuerySlashEncodeFn', {
				functionName: 'ganbari-quest-demo-query-slash-encode',
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
				additionalBehaviors: {
					'/_app/*': {
						origin: demoStaticAssetOrigin,
						viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
						cachePolicy: new cloudfront.CachePolicy(this, 'DemoStaticAssetsCachePolicy', {
							cachePolicyName: 'GanbariQuestDemoStaticAssets',
							defaultTtl: cdk.Duration.days(365),
							maxTtl: cdk.Duration.days(365),
							minTtl: cdk.Duration.days(1),
							enableAcceptEncodingGzip: true,
							enableAcceptEncodingBrotli: true,
						}),
					},
				},
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
