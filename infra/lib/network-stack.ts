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

		// --- CloudFront Function: encode slash in query strings ---
		// SvelteKit form actions use ?/action-name pattern, but Lambda Function URL
		// rejects forward slashes in query strings. This function encodes them.
		const queryFixFn = new cloudfront.Function(this, 'QuerySlashEncodeFn', {
			functionName: 'ganbari-quest-query-slash-encode',
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
			...(props.domainName && certificate
				? {
						domainNames: [props.domainName, `www.${props.domainName}`],
						certificate,
					}
				: {}),
			priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
			httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
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

			// www redirect
			new route53.CnameRecord(this, 'WwwRecord', {
				zone: hostedZone,
				recordName: 'www',
				domainName: props.domainName,
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
