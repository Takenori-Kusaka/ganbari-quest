import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends cdk.StackProps {
	functionUrl: lambda.FunctionUrl;
	domainName?: string;
	certificateArn?: string;
}

export class NetworkStack extends cdk.Stack {
	public readonly distribution: cloudfront.Distribution;

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
				certificate = acm.Certificate.fromCertificateArn(
					this,
					'Certificate',
					props.certificateArn,
				);
			}
		}

		// --- Admin IP allowlist (from CDK context, comma-separated) ---
		const adminAllowedIps = (this.node.tryGetContext('adminAllowedIps') as string | undefined) ?? '';

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
    var ALLOWED_IPS = ${JSON.stringify(adminAllowedIps.split(',').map((ip: string) => ip.trim()).filter(Boolean))};
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
				'/_app/*': {
					origin: lambdaOrigin,
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
				'/error/*': {
					origin: s3ErrorOrigin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
					cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
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
				target: route53.RecordTarget.fromAlias(
					new targets.CloudFrontTarget(this.distribution),
				),
			});

			new route53.AaaaRecord(this, 'AliasRecordAAAA', {
				zone: hostedZone,
				target: route53.RecordTarget.fromAlias(
					new targets.CloudFrontTarget(this.distribution),
				),
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
