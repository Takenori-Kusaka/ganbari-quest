import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends cdk.StackProps {
	functionUrl: lambda.FunctionUrl;
	assetsBucket: s3.Bucket;
	domainName?: string;
}

export class NetworkStack extends cdk.Stack {
	public readonly distribution: cloudfront.Distribution;

	constructor(scope: Construct, id: string, props: NetworkStackProps) {
		super(scope, id, props);

		// Parse Lambda Function URL to get the hostname
		const fnUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', props.functionUrl.url));

		// --- Route 53 + ACM (only when domainName is provided) ---
		let hostedZone: route53.IHostedZone | undefined;
		let certificate: acm.ICertificate | undefined;

		if (props.domainName) {
			hostedZone = new route53.HostedZone(this, 'HostedZone', {
				zoneName: props.domainName,
			});

			certificate = new acm.Certificate(this, 'Certificate', {
				domainName: props.domainName,
				subjectAlternativeNames: [`*.${props.domainName}`],
				validation: acm.CertificateValidation.fromDns(hostedZone),
			});

			new cdk.CfnOutput(this, 'NameServers', {
				value: cdk.Fn.join(', ', hostedZone.hostedZoneNameServers!),
				description: 'Set these NS records at your domain registrar',
			});
		}

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
			},
			// Custom domain settings (applied only when domain is provided)
			...(props.domainName && certificate
				? {
						domainNames: [props.domainName, `www.${props.domainName}`],
						certificate,
					}
				: {}),
			// Japan-focused geo restriction (optional, uncomment to enable)
			// geoRestriction: cloudfront.GeoRestriction.allowlist('JP'),
			priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
			httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
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
