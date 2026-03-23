import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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
		this.userPoolClient = this.userPool.addClient('AppClient', {
			userPoolClientName: 'ganbari-quest-app',
			generateSecret: false, // InitiateAuth (USER_PASSWORD_AUTH) はパブリッククライアント必須
			authFlows: {
				userPassword: true, // cognito-direct-auth.ts の USER_PASSWORD_AUTH
				userSrp: true, // 将来 SRP に移行する場合
			},
			accessTokenValidity: cdk.Duration.hours(1),
			idTokenValidity: cdk.Duration.hours(1),
			refreshTokenValidity: cdk.Duration.days(30),
		});

		// --- Outputs ---
		new cdk.CfnOutput(this, 'UserPoolId', {
			value: this.userPool.userPoolId,
			exportName: 'GanbariQuestUserPoolId',
		});
		new cdk.CfnOutput(this, 'UserPoolClientId', {
			value: this.userPoolClient.userPoolClientId,
			exportName: 'GanbariQuestUserPoolClientId',
		});
	}
}
