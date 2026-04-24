#!/usr/bin/env node

// scripts/cognito/import-users.mjs
// #1399: Cognito ユーザーインポートスクリプト
//
// export-users.mjs で生成した JSON を新しい Cognito User Pool にインポートする。
// Pool 再作成後に実行して、ユーザーを復元する。
//
// 使用方法:
//   node scripts/cognito/import-users.mjs \
//     --pool-id <NEW_USER_POOL_ID> \
//     --input <EXPORT_FILE> \
//     [--region <AWS_REGION>] \
//     [--dry-run]
//
// 注意事項:
//   - email/password ユーザー: admin-create-user (SUPPRESS) で再作成。パスワードはリセット必要。
//   - federated ユーザー (Google等): admin-create-user + admin-link-provider-for-user で再作成。
//   - DynamoDB 側は変更不要 (email natural key で既存レコードが再利用される)。
//   - --dry-run フラグで実際の API コールなしに検証のみ実行可能。

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminGetUserCommand,
	AdminLinkProviderForUserCommand,
	CognitoIdentityProviderClient,
	DeliveryMediumType,
	MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';

const { values: args } = parseArgs({
	args: process.argv.slice(2),
	options: {
		'pool-id': { type: 'string' },
		input: { type: 'string', default: 'cognito-users-export.json' },
		region: { type: 'string', default: 'ap-northeast-1' },
		'dry-run': { type: 'boolean', default: false },
		help: { type: 'boolean', default: false },
	},
});

if (args.help || !args['pool-id']) {
	console.log(`
使用方法:
  node scripts/cognito/import-users.mjs --pool-id <POOL_ID> [--input <FILE>] [--region <REGION>] [--dry-run]

オプション:
  --pool-id  インポート先の Cognito User Pool ID (必須)
  --input    エクスポートファイルパス (デフォルト: cognito-users-export.json)
  --region   AWS リージョン (デフォルト: ap-northeast-1)
  --dry-run  実際の API コールなしに動作を検証
`);
	process.exit(args.help ? 0 : 1);
}

const client = new CognitoIdentityProviderClient({ region: args.region });
const newPoolId = args['pool-id'];
const dryRun = args['dry-run'];

/**
 * 一時パスワード生成 (8文字以上、大小英数字含む)
 * @returns {string}
 */
function generateTempPassword() {
	const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
	const buf = randomBytes(16);
	let pwd = '';
	for (const b of buf) {
		pwd += chars[b % chars.length];
	}
	// 大文字・小文字・数字を確実に含める
	return `${pwd.slice(0, 6)}Aa1!`;
}

/**
 * ユーザーが既に存在するかチェック
 * @param {string} email
 * @returns {Promise<boolean>}
 */
async function userExists(email) {
	try {
		await client.send(new AdminGetUserCommand({ UserPoolId: newPoolId, Username: email }));
		return true;
	} catch (err) {
		if (err.name === 'UserNotFoundException') return false;
		throw err;
	}
}

/**
 * email/password ユーザーを再作成 (パスワードリセット招待付き)
 * @param {object} user
 * @returns {Promise<{status: 'created'|'skipped'|'error', reason?: string}>}
 */
async function importPasswordUser(user) {
	const exists = await userExists(user.email);
	if (exists) {
		return { status: 'skipped', reason: '既存ユーザー' };
	}

	const userAttributes = [
		{ Name: 'email', Value: user.email },
		{ Name: 'email_verified', Value: String(user.emailVerified) },
	];
	for (const [key, value] of Object.entries(user.customAttributes ?? {})) {
		userAttributes.push({ Name: `custom:${key}`, Value: String(value) });
	}

	if (dryRun) {
		return { status: 'created' };
	}

	await client.send(
		new AdminCreateUserCommand({
			UserPoolId: newPoolId,
			Username: user.email,
			UserAttributes: userAttributes,
			// SUPPRESS: welcome メールを送らない。後でパスワードリセットメールを送る。
			MessageAction: MessageActionType.SUPPRESS,
			TemporaryPassword: generateTempPassword(),
			DesiredDeliveryMediums: [DeliveryMediumType.EMAIL],
		}),
	);
	return { status: 'created' };
}

/**
 * federated (Google等) ユーザーを再作成
 * @param {object} user
 * @param {Array} federatedIdentities
 * @returns {Promise<{status: 'created'|'skipped'|'error', reason?: string}>}
 */
async function importFederatedUser(user, federatedIdentities) {
	const exists = await userExists(user.email);
	if (exists) {
		return { status: 'skipped', reason: '既存ユーザー' };
	}

	const userAttributes = [
		{ Name: 'email', Value: user.email },
		{ Name: 'email_verified', Value: 'true' }, // federated は verified 扱い
	];
	for (const [key, value] of Object.entries(user.customAttributes ?? {})) {
		userAttributes.push({ Name: `custom:${key}`, Value: String(value) });
	}

	if (dryRun) {
		return { status: 'created' };
	}

	// Step 1: Cognito native ユーザーとして作成 (shell ユーザー)
	await client.send(
		new AdminCreateUserCommand({
			UserPoolId: newPoolId,
			Username: user.email,
			UserAttributes: userAttributes,
			MessageAction: MessageActionType.SUPPRESS,
		}),
	);

	// Step 2: federated identity を再紐付け
	for (const identity of federatedIdentities) {
		await client.send(
			new AdminLinkProviderForUserCommand({
				UserPoolId: newPoolId,
				DestinationUser: {
					ProviderName: 'Cognito',
					ProviderAttributeValue: user.email,
				},
				SourceUser: {
					ProviderName: identity.providerName ?? identity.ProviderName,
					ProviderAttributeName: 'Cognito_Subject',
					ProviderAttributeValue: identity.userId ?? identity.userId,
				},
			}),
		);
	}

	return { status: 'created' };
}

/**
 * ユーザーをグループに追加
 * @param {object} user
 */
async function addUserToGroups(user) {
	if (!user.groups?.length) return;
	for (const group of user.groups) {
		try {
			await client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: newPoolId,
					Username: user.email,
					GroupName: group,
				}),
			);
		} catch (err) {
			console.warn(`\n[import] グループ追加警告 ${user.email} → ${group}: ${err.message}`);
		}
	}
}

/**
 * 1 ユーザーの import 処理
 * @param {object} user
 * @returns {Promise<{status: 'created'|'skipped'|'error', reason?: string}>}
 */
async function importOneUser(user) {
	const result = user.federatedIdentities?.length
		? await importFederatedUser(user, user.federatedIdentities)
		: await importPasswordUser(user);

	if (result.status === 'created' && !dryRun) {
		await addUserToGroups(user);
	}
	return result;
}

async function main() {
	const exportData = JSON.parse(readFileSync(args.input, 'utf-8'));
	const { users, exportedAt, poolId: srcPoolId } = exportData;

	console.log(`[import] ソース Pool: ${srcPoolId}`);
	console.log(`[import] 対象 Pool:   ${newPoolId} (${args.region})`);
	console.log(`[import] エクスポート日時: ${exportedAt}`);
	console.log(`[import] ユーザー数: ${users.length} 件`);
	if (dryRun) console.log('[import] *** DRY RUN モード (実際の変更なし) ***');
	console.log('');

	const results = { created: 0, skipped: 0, errors: 0 };
	const errorDetails = [];

	for (let i = 0; i < users.length; i++) {
		const user = users[i];
		process.stderr.write(`\r処理中... ${i + 1}/${users.length} (${user.email})`);

		try {
			const result = await importOneUser(user);
			if (result.status === 'created') {
				results.created++;
			} else {
				results.skipped++;
			}
		} catch (err) {
			results.errors++;
			errorDetails.push({ email: user.email, error: err.message });
		}
	}
	process.stderr.write('\n');

	console.log('\n[import] 結果:');
	console.log(`  作成: ${results.created} 件`);
	console.log(`  スキップ (既存): ${results.skipped} 件`);
	console.log(`  エラー: ${results.errors} 件`);

	if (errorDetails.length) {
		console.error('\n[import] エラー詳細:');
		for (const { email, error } of errorDetails) {
			console.error(`  - ${email}: ${error}`);
		}
	}

	if (!dryRun && results.created > 0) {
		console.log(`
[import] 重要: email/password ユーザーはパスワードリセットが必要です。
  以下のいずれかの方法でユーザーに通知してください:
  1. AWS Console → User Pool → ユーザー一覧 → パスワードリセット送信
  2. AWS CLI: aws cognito-idp admin-reset-user-password --user-pool-id ${newPoolId} --username <email>
  3. アプリの「パスワードを忘れた場合」フローを案内する`);
	}

	if (results.errors > 0) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('[import] 致命的エラー:', err);
	process.exit(1);
});
