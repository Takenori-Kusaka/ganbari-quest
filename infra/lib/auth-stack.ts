import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
	/** App domain for future use (e.g. ganbari-quest.com) */
	appDomain?: string;
	/** Google OAuth Client ID (GCP Console で作成したもの) */
	googleClientId?: string;
	/** Google OAuth Client Secret */
	googleClientSecret?: string;
	/** ACM certificate ARN covering auth.<appDomain> (us-east-1) */
	certificateArn?: string;
}

export class AuthStack extends cdk.Stack {
	public readonly userPool: cognito.UserPool;
	public readonly userPoolClient: cognito.UserPoolClient;

	constructor(scope: Construct, id: string, props: AuthStackProps) {
		super(scope, id, props);

		// GoogleIdP を UserPoolClient より先に用意し、CloudFormation に明示依存を付けるために
		// ローカル変数として保持する。supportedIdentityProviders に Google を含めるクライアントは
		// IdP がまだ作成途中だと "The provider Google does not exist" で失敗するため。
		let googleIdP: cognito.UserPoolIdentityProviderGoogle | undefined;

		// --- SES domain ARN (us-east-1 固定 — Cognito はメール送信を us-east-1 SES で行う) ---
		// biome-ignore lint/correctness/noUnusedVariables: prepared for SES configuration in email settings below
		const sesDomainArn = `arn:aws:ses:us-east-1:${this.account}:identity/ganbari-quest.com`;

		// --- Cognito User Pool (Email/Password + MFA) ---
		// 論理 ID は 'UserPoolV2' を使用 (ADR-0018)。
		// 旧 'UserPool' は ADR-0017 deploy 失敗後に UPDATE_ROLLBACK_COMPLETE 状態で残存しており、
		// `mutable: true` に変更するには CloudFormation に Replacement を強制する必要がある。
		// 論理 ID を変えることで新 Pool を新規作成 → 旧 Pool は RETAIN により orphan として残る
		// (deploy 成功後に手動で削除する)。Pre-PMF 境界内で既存 federated ユーザー消失を許容。
		this.userPool = new cognito.UserPool(this, 'UserPoolV2', {
			userPoolName: 'ganbari-quest-users-v2',
			selfSignUpEnabled: true,
			signInAliases: { email: true },
			autoVerify: { email: true },
			standardAttributes: {
				// federated IdP (Google OAuth) 経由の email 更新を許容する (#1366 根本解決)。
				email: { required: true, mutable: true },
			},
			// SES 経由でメール送信（DKIM/SPF 付き ganbari-quest.com ドメインから）
			email: cognito.UserPoolEmail.withSES({
				sesRegion: 'us-east-1',
				fromEmail: 'noreply@ganbari-quest.com',
				fromName: 'がんばりクエスト',
				sesVerifiedDomain: 'ganbari-quest.com',
			}),
			// Email OTP is enforced at the application layer (not Cognito MFA)
			// after USER_PASSWORD_AUTH succeeds, app sends OTP via SES and verifies
			mfa: cognito.Mfa.OPTIONAL,
			mfaSecondFactor: {
				sms: false,
				otp: true, // TOTP (Google Authenticator) remains as optional extra
			},
			passwordPolicy: {
				minLength: 8,
				requireLowercase: true,
				requireUppercase: true,
				requireDigits: true,
				requireSymbols: false, // ユーザビリティ優先
			},
			accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
			userVerification: {
				emailSubject: 'がんばりクエスト — メールアドレスの確認',
				emailBody:
					'がんばりクエストへのご登録ありがとうございます。\n\n確認コード: {####}\n\nこのコードをアプリの確認画面に入力してください。',
				emailStyle: cognito.VerificationEmailStyle.CODE,
			},
			customAttributes: {
				tenantId: new cognito.StringAttribute({ mutable: true }),
				role: new cognito.StringAttribute({ mutable: true }),
			},
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		// --- #820 PR-C: /ops ダッシュボード用 Cognito group ---
		// 所属ユーザーのみが /ops/* にアクセスできる（+layout.server.ts で isOpsMember チェック）。
		// group 名は src/lib/server/auth/ops-authz.ts の OPS_GROUP 定数と一致させること。
		// 運用メモ（#820）:
		//   - ユーザーを追加: AWS Console or `aws cognito-idp admin-add-user-to-group --group-name ops`
		//   - 権限剥奪: `aws cognito-idp admin-remove-user-from-group --group-name ops`
		new cognito.CfnUserPoolGroup(this, 'OpsGroup', {
			userPoolId: this.userPool.userPoolId,
			groupName: 'ops',
			description: 'Ganbari Quest operations dashboard (/ops) access',
			precedence: 0,
		});

		// --- CustomMessage Lambda Trigger (日本語HTML メールテンプレート) ---
		const customMessageFn = new lambda.Function(this, 'CustomMessageFn', {
			functionName: 'ganbari-quest-cognito-custom-message',
			runtime: lambda.Runtime.NODEJS_20_X,
			handler: 'index.handler',
			timeout: cdk.Duration.seconds(5),
			memorySize: 128,
			code: lambda.Code.fromInline(customMessageLambdaCode()),
		});

		this.userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

		// --- App domain (OAuth コールバック / カスタムドメインで使用) ---
		const appDomain = props.appDomain ?? 'ganbari-quest.com';

		// --- Google Identity Provider（条件付き: googleClientId が指定された場合のみ） ---
		const googleClientId = props.googleClientId;
		const googleClientSecret = props.googleClientSecret;
		const googleEnabled = !!(googleClientId && googleClientSecret);
		if (googleEnabled) {
			// Cognito Hosted UI ドメイン（OAuth フローに必要）
			const certificateArn = props.certificateArn;
			const useCustomDomain = !!(certificateArn && appDomain);
			if (useCustomDomain) {
				const certificateArnComponents = cdk.Arn.split(
					certificateArn,
					cdk.ArnFormat.SLASH_RESOURCE_NAME,
				);
				if (certificateArnComponents.region !== 'us-east-1') {
					throw new Error(
						`Cognito custom domain requires an ACM certificate in us-east-1, but got: ${certificateArn}`,
					);
				}
			}
			let domainValue: string;

			if (useCustomDomain) {
				// カスタムドメイン: auth.ganbari-quest.com
				const authDomainName = `auth.${appDomain}`;
				const authCertificate = acm.Certificate.fromCertificateArn(
					this,
					'AuthCertificate',
					certificateArn!,
				);

				const domain = this.userPool.addDomain('CognitoDomain', {
					customDomain: {
						domainName: authDomainName,
						certificate: authCertificate,
					},
				});

				// Route53 A / AAAA レコード（エイリアス → Cognito CloudFront）
				const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
					domainName: appDomain,
				});
				const authDomainAliasTarget = route53.RecordTarget.fromAlias(
					new targets.UserPoolDomainTarget(domain),
				);
				new route53.ARecord(this, 'AuthDomainAlias', {
					zone: hostedZone,
					recordName: 'auth',
					target: authDomainAliasTarget,
				});
				new route53.AaaaRecord(this, 'AuthDomainAliasIpv6', {
					zone: hostedZone,
					recordName: 'auth',
					target: authDomainAliasTarget,
				});

				domainValue = authDomainName;
			} else {
				// フォールバック: Cognito デフォルトドメイン
				const domain = this.userPool.addDomain('CognitoDomain', {
					cognitoDomain: {
						domainPrefix: 'ganbari-quest',
					},
				});
				domainValue = `${domain.domainName}.auth.${this.region}.amazoncognito.com`;
			}

			googleIdP = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
				userPool: this.userPool,
				clientId: googleClientId,
				clientSecretValue: cdk.SecretValue.unsafePlainText(googleClientSecret),
				scopes: ['openid', 'email'],
				attributeMapping: {
					email: cognito.ProviderAttribute.GOOGLE_EMAIL,
				},
			});

			// Cognito Domain を SSM に出力（アプリ側で参照）
			new ssm.StringParameter(this, 'CognitoDomainParam', {
				parameterName: '/ganbari-quest/cognito/domain',
				stringValue: domainValue,
			});

			new cdk.CfnOutput(this, 'CognitoDomainOutput', {
				value: domainValue,
				description: 'Cognito Hosted UI Domain',
			});
			new cdk.CfnOutput(this, 'GoogleIdPEnabled', {
				value: 'true',
				description: 'Google Identity Provider is configured',
			});
		}

		// --- User Pool Client (パブリッククライアント、USER_PASSWORD_AUTH + OAuth) ---
		// 新しい論理ID 'PublicClient' を使い、旧 'AppClient' の export への依存を回避
		// GoogleIdP 作成完了を待ってから UserPoolClient を作成する (race 回避)。
		// Deploy 失敗ログ: "The provider Google does not exist for User Pool ..." (2026-04-21)
		this.userPoolClient = this.userPool.addClient('PublicClient', {
			userPoolClientName: 'ganbari-quest-public',
			generateSecret: false, // InitiateAuth (USER_PASSWORD_AUTH) はパブリッククライアント必須
			authFlows: {
				userPassword: true, // cognito-direct-auth.ts の USER_PASSWORD_AUTH
				userSrp: true, // 将来 SRP に移行する場合
			},
			accessTokenValidity: cdk.Duration.hours(1),
			idTokenValidity: cdk.Duration.hours(1),
			refreshTokenValidity: cdk.Duration.days(30),
			// Google IdP が有効な場合、OAuth フロー設定を追加
			...(googleEnabled
				? {
						oAuth: {
							flows: { authorizationCodeGrant: true },
							scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
							callbackUrls: [
								`https://${appDomain}/auth/callback`,
								'http://localhost:5173/auth/callback',
							],
							logoutUrls: [`https://${appDomain}/auth/login`, 'http://localhost:5173/auth/login'],
						},
						supportedIdentityProviders: [
							cognito.UserPoolClientIdentityProvider.COGNITO,
							cognito.UserPoolClientIdentityProvider.GOOGLE,
						],
					}
				: {}),
		});

		// 明示的依存: UserPoolClient は GoogleIdP の作成完了後に作成される必要がある
		// (supportedIdentityProviders に GOOGLE を含むため)。CDK/CloudFormation の暗黙依存では
		// 並列作成されて race が発生する (2026-04-21 deploy 失敗の直接原因)。
		if (googleIdP) {
			this.userPoolClient.node.addDependency(googleIdP);
		}

		// --- SSM Parameters (スタック間依存の切り離し) ---
		new ssm.StringParameter(this, 'UserPoolIdParam', {
			parameterName: '/ganbari-quest/cognito/user-pool-id',
			stringValue: this.userPool.userPoolId,
		});
		new ssm.StringParameter(this, 'UserPoolClientIdParam', {
			parameterName: '/ganbari-quest/cognito/client-id',
			stringValue: this.userPoolClient.userPoolClientId,
		});

		// --- Outputs (参考用、cross-stack reference には使わない) ---
		new cdk.CfnOutput(this, 'UserPoolId', {
			value: this.userPool.userPoolId,
		});
		new cdk.CfnOutput(this, 'UserPoolClientId', {
			value: this.userPoolClient.userPoolClientId,
		});
	}
}

/**
 * Cognito CustomMessage Lambda トリガーのインラインコード
 * メール確認コード・パスワードリセットを日本語HTMLテンプレートで送信
 */
function customMessageLambdaCode(): string {
	return `
exports.handler = async (event) => {
  const code = event.request.codeParameter;
  const header = '<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;text-align:center"><h1 style="color:#fff;font-size:20px;margin:0">がんばりクエスト</h1></div>';
  const footer = '<div style="padding:16px 24px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb"><p>このメールは「がんばりクエスト」から自動送信されています。</p></div>';
  const wrap = (content) => '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5"><div style="max-width:600px;margin:0 auto;background:#fff">' + header + '<div style="padding:32px 24px;color:#333;line-height:1.7">' + content + '</div>' + footer + '</div></body></html>';

  if (event.triggerSource === 'CustomMessage_SignUp' || event.triggerSource === 'CustomMessage_ResendCode') {
    event.response.emailSubject = 'がんばりクエスト — メールアドレスの確認';
    event.response.emailMessage = wrap(
      '<h2 style="color:#4f46e5;font-size:18px;margin-top:0">メールアドレスの確認</h2>' +
      '<p>がんばりクエストへのご登録ありがとうございます。</p>' +
      '<p>以下の確認コードをアプリの確認画面に入力してください:</p>' +
      '<div style="text-align:center;margin:24px 0"><span style="display:inline-block;padding:16px 32px;background:#f0f0ff;border:2px solid #6366f1;border-radius:8px;font-size:28px;font-weight:bold;letter-spacing:8px;color:#4f46e5">' + code + '</span></div>' +
      '<p style="font-size:14px;color:#666">このコードは24時間有効です。身に覚えのない場合は、このメールを無視してください。</p>'
    );
  } else if (event.triggerSource === 'CustomMessage_ForgotPassword') {
    event.response.emailSubject = 'がんばりクエスト — パスワードのリセット';
    event.response.emailMessage = wrap(
      '<h2 style="color:#4f46e5;font-size:18px;margin-top:0">パスワードのリセット</h2>' +
      '<p>パスワードリセットのリクエストを受け付けました。</p>' +
      '<p>以下の確認コードを入力して、新しいパスワードを設定してください:</p>' +
      '<div style="text-align:center;margin:24px 0"><span style="display:inline-block;padding:16px 32px;background:#f0f0ff;border:2px solid #6366f1;border-radius:8px;font-size:28px;font-weight:bold;letter-spacing:8px;color:#4f46e5">' + code + '</span></div>' +
      '<p style="font-size:14px;color:#666">このコードは24時間有効です。リクエストした覚えがない場合は、このメールを無視してください。</p>'
    );
  }

  return event;
};
`;
}
