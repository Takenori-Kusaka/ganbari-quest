import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
	/** Google OAuth Client ID (context or env) */
	googleClientId?: string;
	/** Google OAuth Client Secret (context or env) */
	googleClientSecret?: string;
	/** App domain for callback URLs (e.g. ganbari-quest.com) */
	appDomain?: string;
}

export class AuthStack extends cdk.Stack {
	public readonly userPool: cognito.UserPool;
	public readonly userPoolClient: cognito.UserPoolClient;
	public readonly userPoolDomain: cognito.UserPoolDomain;

	constructor(scope: Construct, id: string, props: AuthStackProps) {
		super(scope, id, props);

		// --- Cognito User Pool ---
		this.userPool = new cognito.UserPool(this, 'UserPool', {
			userPoolName: 'ganbari-quest-users',
			selfSignUpEnabled: false, // OAuth only — no self sign-up
			signInAliases: { email: true },
			autoVerify: { email: true },
			standardAttributes: {
				email: { required: true, mutable: false },
			},
			accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			passwordPolicy: {
				minLength: 8,
				requireLowercase: true,
				requireUppercase: true,
				requireDigits: true,
				requireSymbols: false,
			},
		});

		// --- Google Identity Provider ---
		if (props.googleClientId && props.googleClientSecret) {
			const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
				userPool: this.userPool,
				clientId: props.googleClientId,
				clientSecretValue: cdk.SecretValue.unsafePlainText(props.googleClientSecret),
				scopes: ['openid', 'email', 'profile'],
				attributeMapping: {
					email: cognito.ProviderAttribute.GOOGLE_EMAIL,
					fullname: cognito.ProviderAttribute.GOOGLE_NAME,
					profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
				},
			});

			// Ensure provider is created before client
			this.userPoolClient = this.createUserPoolClient(props, [googleProvider]);
		} else {
			// No Google IdP — useful for dev/test
			this.userPoolClient = this.createUserPoolClient(props, []);
		}

		// --- Cognito Hosted UI Domain ---
		this.userPoolDomain = this.userPool.addDomain('Domain', {
			cognitoDomain: {
				domainPrefix: 'ganbari-quest',
			},
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
		new cdk.CfnOutput(this, 'UserPoolDomain', {
			value: this.userPoolDomain.domainName,
		});
	}

	private createUserPoolClient(
		props: AuthStackProps,
		providers: cognito.UserPoolIdentityProviderGoogle[],
	): cognito.UserPoolClient {
		// Callback URLs
		const callbackUrls = ['http://localhost:5173/auth/callback'];
		const logoutUrls = ['http://localhost:5173/login'];

		if (props.appDomain) {
			callbackUrls.push(`https://${props.appDomain}/auth/callback`);
			logoutUrls.push(`https://${props.appDomain}/login`);
		}

		const supportedProviders: cognito.UserPoolClientIdentityProvider[] = [
			cognito.UserPoolClientIdentityProvider.COGNITO,
		];
		if (providers.length > 0) {
			supportedProviders.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
		}

		const client = this.userPool.addClient('AppClient', {
			userPoolClientName: 'ganbari-quest-app',
			generateSecret: true,
			oAuth: {
				flows: { authorizationCodeGrant: true },
				scopes: [
					cognito.OAuthScope.OPENID,
					cognito.OAuthScope.EMAIL,
					cognito.OAuthScope.PROFILE,
				],
				callbackUrls,
				logoutUrls,
			},
			supportedIdentityProviders: supportedProviders,
			authFlows: {
				userSrp: true,
			},
			accessTokenValidity: cdk.Duration.hours(1),
			idTokenValidity: cdk.Duration.hours(1),
			refreshTokenValidity: cdk.Duration.days(30),
		});

		// Ensure providers are created before client
		for (const provider of providers) {
			client.node.addDependency(provider);
		}

		return client;
	}
}
