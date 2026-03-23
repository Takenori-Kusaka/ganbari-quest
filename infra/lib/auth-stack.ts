import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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
			mfa: cognito.Mfa.OPTIONAL,
			mfaSecondFactor: {
				sms: false, // SNS サンドボックス回避のため初期は無効
				otp: true, // TOTP (Google Authenticator 等)
			},
			passwordPolicy: {
				minLength: 8,
				requireLowercase: true,
				requireUppercase: true,
				requireDigits: true,
				requireSymbols: false, // ユーザビリティ優先
			},
			accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
			customAttributes: {
				tenantId: new cognito.StringAttribute({ mutable: true }),
				role: new cognito.StringAttribute({ mutable: true }),
			},
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

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
