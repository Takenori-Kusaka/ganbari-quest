import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
	/** App domain for future use (e.g. ganbari-quest.com) */
	appDomain?: string;
}

export class AuthStack extends cdk.Stack {
	public readonly userPool: cognito.UserPool;
	public readonly userPoolClient: cognito.UserPoolClient;

	constructor(scope: Construct, id: string, props: AuthStackProps) {
		super(scope, id, props);

		// --- Cognito User Pool (Email/Password + MFA) ---
		this.userPool = new cognito.UserPool(this, 'UserPool', {
			userPoolName: 'ganbari-quest-users',
			selfSignUpEnabled: true,
			signInAliases: { email: true },
			autoVerify: { email: true },
			standardAttributes: {
				email: { required: true, mutable: false },
			},
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

		// --- User Pool Client (パブリッククライアント、USER_PASSWORD_AUTH) ---
		// 新しい論理ID 'PublicClient' を使い、旧 'AppClient' の export への依存を回避
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
		});

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
