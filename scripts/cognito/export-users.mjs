#!/usr/bin/env node

// scripts/cognito/export-users.mjs
// #1399: Cognito ユーザーエクスポートスクリプト
//
// 指定した Cognito User Pool の全ユーザーを JSON にエクスポートする。
// Pool 再作成前に実行して、ユーザーデータを保全する。
//
// 使用方法:
//   node scripts/cognito/export-users.mjs \
//     --pool-id <USER_POOL_ID> \
//     --region <AWS_REGION> \
//     --output <OUTPUT_FILE>
//
// 環境変数で AWS 認証情報を設定すること (AWS_PROFILE, AWS_ACCESS_KEY_ID 等)
//
// 出力フォーマット: { exportedAt, poolId, region, users: CognitoUser[] }
// 注意: パスワードハッシュはエクスポート不可。インポート時にリセット案内を送信する。

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
	AdminListGroupsForUserCommand,
	CognitoIdentityProviderClient,
	ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const { values: args } = parseArgs({
	args: process.argv.slice(2),
	options: {
		'pool-id': { type: 'string' },
		region: { type: 'string', default: 'ap-northeast-1' },
		output: { type: 'string', default: 'cognito-users-export.json' },
		help: { type: 'boolean', default: false },
	},
});

if (args.help || !args['pool-id']) {
	console.log(`
使用方法:
  node scripts/cognito/export-users.mjs --pool-id <POOL_ID> [--region <REGION>] [--output <FILE>]

オプション:
  --pool-id  Cognito User Pool ID (必須, 例: ap-northeast-1_XXXXXXXXX)
  --region   AWS リージョン (デフォルト: ap-northeast-1)
  --output   出力ファイルパス (デフォルト: cognito-users-export.json)
`);
	process.exit(args.help ? 0 : 1);
}

const client = new CognitoIdentityProviderClient({ region: args.region });
const poolId = args['pool-id'];

/**
 * Cognito ユーザーの attributes 配列を Record に変換
 * @param {Array<{Name: string, Value: string}>} attrs
 * @returns {Record<string, string>}
 */
function attrsToMap(attrs = []) {
	return Object.fromEntries(attrs.map((a) => [a.Name, a.Value]));
}

/**
 * identities attribute をパースして federated プロバイダー情報を取得
 * @param {Record<string, string>} attrMap
 * @returns {Array<{providerName: string, providerType: string, userId: string}> | null}
 */
function parseFederatedIdentities(attrMap) {
	const raw = attrMap.identities;
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * 全ユーザーをページネーションで取得
 * @returns {Promise<import('@aws-sdk/client-cognito-identity-provider').UserType[]>}
 */
async function listAllUsers() {
	const users = [];
	let paginationToken;
	let page = 0;
	do {
		page++;
		process.stderr.write(`\rユーザー一覧取得中... ページ ${page} (累計: ${users.length} 件)`);
		const cmd = new ListUsersCommand({
			UserPoolId: poolId,
			PaginationToken: paginationToken,
			Limit: 60, // max allowed
		});
		const res = await client.send(cmd);
		users.push(...(res.Users ?? []));
		paginationToken = res.PaginationToken;
	} while (paginationToken);
	process.stderr.write('\n');
	return users;
}

/**
 * ユーザーが所属するグループを取得
 * @param {string} username
 * @returns {Promise<string[]>}
 */
async function getUserGroups(username) {
	const groups = [];
	let nextToken;
	do {
		const res = await client.send(
			new AdminListGroupsForUserCommand({
				UserPoolId: poolId,
				Username: username,
				NextToken: nextToken,
			}),
		);
		groups.push(...(res.Groups ?? []).map((g) => g.GroupName));
		nextToken = res.NextToken;
	} while (nextToken);
	return groups;
}

async function main() {
	console.log(`[export] Pool: ${poolId} (${args.region})`);
	const rawUsers = await listAllUsers();
	console.log(`[export] ${rawUsers.length} ユーザーを取得`);

	const users = [];
	for (let i = 0; i < rawUsers.length; i++) {
		const u = rawUsers[i];
		process.stderr.write(`\r詳細取得中... ${i + 1}/${rawUsers.length}`);

		const attrMap = attrsToMap(u.Attributes);
		const federatedIdentities = parseFederatedIdentities(attrMap);

		let groups = [];
		try {
			groups = await getUserGroups(u.Username);
		} catch {
			// グループ取得失敗は非致命的
		}

		users.push({
			username: u.Username,
			userStatus: u.UserStatus, // CONFIRMED / FORCE_CHANGE_PASSWORD / UNCONFIRMED
			enabled: u.Enabled,
			userCreateDate: u.UserCreateDate?.toISOString(),
			userLastModifiedDate: u.UserLastModifiedDate?.toISOString(),
			email: attrMap.email,
			emailVerified: attrMap.email_verified === 'true',
			// カスタム属性 (custom: prefix)
			customAttributes: Object.fromEntries(
				Object.entries(attrMap)
					.filter(([k]) => k.startsWith('custom:'))
					.map(([k, v]) => [k.slice('custom:'.length), v]),
			),
			// フェデレーション情報: null = email/password ユーザー
			federatedIdentities,
			groups,
		});
	}
	process.stderr.write('\n');

	const result = {
		exportedAt: new Date().toISOString(),
		poolId,
		region: args.region,
		totalUsers: users.length,
		users,
	};

	writeFileSync(args.output, JSON.stringify(result, null, 2), 'utf-8');

	const fedCount = users.filter((u) => u.federatedIdentities).length;
	const pwCount = users.filter((u) => !u.federatedIdentities).length;
	console.log(`[export] 完了: ${args.output}`);
	console.log(`  - email/password ユーザー: ${pwCount} 件`);
	console.log(`  - federated (Google等) ユーザー: ${fedCount} 件`);
	console.log(`  - 合計: ${users.length} 件`);
}

main().catch((err) => {
	console.error('[export] エラー:', err);
	process.exit(1);
});
