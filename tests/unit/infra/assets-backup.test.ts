// tests/unit/infra/assets-backup.test.ts
// #4724: 子供の写真・声を置く assets バケットを「戻せる」状態に保つための構造検証。
//
// ## なぜ要るか
//
// #4580 は「有償顧客のデータは DSQL に在り、off-site / 暗号化 / 失敗通知は AWS Backup で
// 充足済」として公開 blocker を下ろした。**この前提は S3 について成立していなかった** —
// 本番実測 (2026-08-19) で assets バケットはバージョニング無効かつ AWS Backup の
// selection 外だった。一方 `account-deletion-service.ts` の `deleteByPrefix` は
// `tenants/<tenantId>/` を prefix ごと物理削除するため、tenantId や猶予判定を誤ると
// 子供の写真・録音は**復元手段ゼロで消える**。
//
// 「DSQL だけ復元できて写真が戻らない」復元は顧客にとって復元ではないため、
// 以下 3 点を CDK 構造として固定する:
//
//   [V] バージョニング + 非現行バージョンの有界化 (コストが無制限に増えない)
//   [B] AWS Backup の selection に assets バケットが載り、既存の失敗通知経路を共有する
//   [S] staging の使い捨て (removalPolicy=DESTROY + autoDeleteObjects) が壊れていない

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DsqlStack } from '../../../infra/lib/dsql-stack';
import {
	assetsBucketArn,
	assetsBucketName,
	PROD_ENV_CONFIG,
	STAGING_ENV_CONFIG,
} from '../../../infra/lib/env-config';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

let prodStorage: Template;
let stagingStorage: Template;
let prodDsql: Template;

// 1 App = 1 synth。同じ App に stack を足してから 2 回目の Template.fromStack を呼ぶと
// ConstructTreeModifiedAfterSynth になるため、stack ごとに App を分ける。
beforeAll(() => {
	prodStorage = Template.fromStack(new StorageStack(new cdk.App(), 'TestStorage', { env }));
	stagingStorage = Template.fromStack(
		new StorageStack(new cdk.App(), 'TestStorageStaging', { env, envConfig: STAGING_ENV_CONFIG }),
	);
	prodDsql = Template.fromStack(
		new DsqlStack(new cdk.App(), 'TestDsql', { env, opsEmail: 'ops@example.com' }),
	);
}, 120_000);

describe('[V] assets バケットのバージョニングと有界化', () => {
	it('[V1] バージョニングが有効 (誤削除・誤上書きから戻せる)', () => {
		prodStorage.hasResourceProperties('AWS::S3::Bucket', {
			BucketName: assetsBucketName(PROD_ENV_CONFIG.resourcePrefix, '000000000000'),
			VersioningConfiguration: { Status: 'Enabled' },
		});
	});

	// バージョニングを入れると「消したつもりのバイト」が課金され続ける。30 日で切ることで
	// コストを有界にしつつ、誤削除に気付いて戻す窓は確保する (DSQL backup の 7 日より長い —
	// S3 だけ先に消えて復元時点がちぐはぐになるのを避ける)。
	it('[V2] 非現行バージョンが 30 日で expire し、delete marker も掃除される', () => {
		const buckets = prodStorage.findResources('AWS::S3::Bucket', {
			Properties: { BucketName: assetsBucketName(PROD_ENV_CONFIG.resourcePrefix, '000000000000') },
		});
		const props = Object.values(buckets)[0]?.Properties as {
			LifecycleConfiguration?: { Rules?: Array<Record<string, unknown>> };
		};
		const rules = props?.LifecycleConfiguration?.Rules ?? [];
		const noncurrent = rules.find((r) => r.Id === 'expire-noncurrent-versions');
		expect(
			noncurrent,
			'expire-noncurrent-versions rule が無い = コストが無制限に増える',
		).toBeDefined();
		expect(noncurrent?.NoncurrentVersionExpiration).toEqual({ NoncurrentDays: 30 });
		expect(noncurrent?.ExpiredObjectDeleteMarker).toBe(true);
		expect(noncurrent?.Status).toBe('Enabled');
	});

	// #4724 No-gos: 顧客データ (`tenants/` / `exports/`) の**現行**バージョンを自動削除しない。
	// 既存の expiration は `backups/` prefix 限定であることを固定する。
	it('[V3] 顧客データの現行バージョンに expiration を掛けていない', () => {
		const buckets = prodStorage.findResources('AWS::S3::Bucket', {
			Properties: { BucketName: assetsBucketName(PROD_ENV_CONFIG.resourcePrefix, '000000000000') },
		});
		const props = Object.values(buckets)[0]?.Properties as {
			LifecycleConfiguration?: { Rules?: Array<Record<string, unknown>> };
		};
		const rules = props?.LifecycleConfiguration?.Rules ?? [];
		for (const rule of rules) {
			if (rule.ExpirationInDays === undefined && rule.ExpirationDate === undefined) continue;
			// 現行バージョンを消す rule は prefix が `backups/` のものだけ
			expect(rule.Prefix, `現行バージョンを消す rule (${String(rule.Id)}) の prefix`).toBe(
				'backups/',
			);
		}
	});
});

describe('[B] AWS Backup の保護対象', () => {
	// #3437 時点の selection は DSQL cluster 1 本だけで、S3 は保護対象外だった。
	it('[B1] assets バケットが BackupSelection に載っている', () => {
		const selections = prodDsql.findResources('AWS::Backup::BackupSelection');
		const serialized = JSON.stringify(Object.values(selections));
		expect(serialized).toContain(assetsBucketArn(PROD_ENV_CONFIG.resourcePrefix, '000000000000'));
	});

	// 同じ vault に載せることで、既存の DsqlBackupJobFailed rule (vault 名で scope) が
	// S3 backup job の失敗もそのまま拾う。別 vault にすると失敗が誰にも届かなくなる。
	it('[B2] DSQL と同じ plan / vault を共有し、既存の失敗通知 rule の scope 内にある', () => {
		prodDsql.resourceCountIs('AWS::Backup::BackupPlan', 1);
		prodDsql.resourceCountIs('AWS::Backup::BackupSelection', 2);

		const rules = prodDsql.findResources('AWS::Events::Rule', {
			Properties: { EventPattern: Match.objectLike({ source: ['aws.backup'] }) },
		});
		const failRule = Object.values(rules)[0];
		const pattern = (failRule?.Properties as { EventPattern: { detail: Record<string, unknown> } })
			.EventPattern.detail;
		// #4724: PARTIAL を含む。S3 backup は一部オブジェクトだけ失敗すると PARTIAL で終わるため、
		// 3 値のままだと「毎晩走っているが写真が入っていない」が通知ゼロで成立する。
		expect(pattern.state).toEqual(['FAILED', 'ABORTED', 'EXPIRED', 'PARTIAL']);

		// rule は vault 名で scope する。その vault が、2 つの selection が載る plan の
		// backup 先と同一であることを logical ID で突き合わせる (別 vault なら S3 の失敗が届かない)。
		const vaultLogicalIds = Object.keys(prodDsql.findResources('AWS::Backup::BackupVault'));
		expect(vaultLogicalIds).toHaveLength(1);
		const ruleVaults = pattern.backupVaultName as Array<{ 'Fn::GetAtt': [string, string] }>;
		expect(ruleVaults).toHaveLength(1);
		expect(ruleVaults[0]?.['Fn::GetAtt']?.[0]).toBe(vaultLogicalIds[0]);
		expect(ruleVaults[0]?.['Fn::GetAtt']?.[1]).toBe('BackupVaultName');

		const planBody = JSON.stringify(
			Object.values(prodDsql.findResources('AWS::Backup::BackupPlan')),
		);
		expect(planBody).toContain(vaultLogicalIds[0]);
	});

	// AWS Backup の S3 backup / restore は汎用の 2 policy では認可されない。
	// 欠けると backup job が AccessDenied で落ち続ける (= 保護しているつもりで保護されない)。
	it('[B3] backup role が S3 backup / restore の managed policy を持つ', () => {
		const roles = prodDsql.findResources('AWS::IAM::Role', {
			Properties: { RoleName: 'ganbari-quest-dsql-backup-role' },
		});
		const serialized = JSON.stringify(Object.values(roles));
		for (const policy of [
			'AWSBackupServiceRolePolicyForBackup',
			'AWSBackupServiceRolePolicyForRestores',
			'AWSBackupServiceRolePolicyForS3Backup',
			'AWSBackupServiceRolePolicyForS3Restore',
		]) {
			expect(serialized, `${policy} が backup role に付いていない`).toContain(policy);
		}
	});

	// バケット名を 2 箇所に書くと「バックアップしているつもりで別のバケットを見ている」に
	// なり、しかも成功扱いで気付けない。SSOT 関数 1 本に閉じていることを固定する。
	it('[B4] selection の ARN が StorageStack の実バケット名と一致する', () => {
		const buckets = prodStorage.findResources('AWS::S3::Bucket', {
			Properties: { BucketName: assetsBucketName(PROD_ENV_CONFIG.resourcePrefix, '000000000000') },
		});
		expect(Object.keys(buckets), 'assets バケットが 1 本だけ存在する').toHaveLength(1);

		const bucketName = (Object.values(buckets)[0]?.Properties as { BucketName: string }).BucketName;
		const selections = JSON.stringify(
			Object.values(prodDsql.findResources('AWS::Backup::BackupSelection')),
		);
		expect(selections).toContain(`arn:aws:s3:::${bucketName}`);
	});
});

describe('[S] staging の使い捨てを壊していない', () => {
	// バージョニング有効時も CDK の autoDeleteObjects custom resource は全バージョンを消すため
	// staging の DESTROY は成立する。ここが壊れると staging 再構築のたびに手作業が要る。
	it('[S1] staging bucket は DESTROY + autoDeleteObjects のまま', () => {
		stagingStorage.hasResource('AWS::S3::Bucket', {
			Properties: Match.objectLike({
				BucketName: assetsBucketName(STAGING_ENV_CONFIG.resourcePrefix, '000000000000'),
				VersioningConfiguration: { Status: 'Enabled' },
			}),
			DeletionPolicy: 'Delete',
			UpdateReplacePolicy: 'Delete',
		});
		// autoDeleteObjects は Custom::S3AutoDeleteObjects として現れる
		stagingStorage.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
	});

	it('[S2] staging は AWS Backup を作らない (#3437 N4 の不変条件を維持)', () => {
		const staging = Template.fromStack(new DsqlStack(new cdk.App(), 'TestDsqlStaging', { env }));
		staging.resourceCountIs('AWS::Backup::BackupSelection', 0);
		staging.resourceCountIs('AWS::Backup::BackupPlan', 0);
		staging.resourceCountIs('AWS::Backup::BackupVault', 0);
	});
});

/**
 * [D] バージョニングと「完全削除の約束」の整合 (#4724)。
 *
 * バージョニングを有効にすると `deleteByPrefix` は delete marker を立てるだけになり、実体は
 * lifecycle (30 日) まで残る。**退会は法務文書 (privacy 第 6 条 / 利用規約) が「猶予期間後に
 * 完全削除」と約束している**ため、退会経路だけは全バージョンを消す `purgeByPrefix` を通す。
 *
 * ここが `deleteByPrefix` に戻ると、CI は緑のまま「約束より 30 日長く保持する」状態になる
 * (画面にも log にも出ない = 誰も気付けない)。経路そのものを固定する。
 */
describe('[D] 退会の完全削除がバージョンごと消す経路を通る', () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, '../../..', 'src/lib/server/services/account-deletion-service.ts'),
		'utf-8',
	);

	it('[D1] account-deletion-service は purgeByPrefix を使い deleteByPrefix を使わない', () => {
		// biome の template-placeholder 警告を避けるため文字列を組み立てる (検査対象は実ソース)
		const tenantPrefixLiteral = ['tenants/$', '{tenantId}/'].join('');
		expect(source).toContain(`purgeByPrefix(\`${tenantPrefixLiteral}\`)`);
		// 対照: 検査が空振りしていないこと (対象文字列が実在する)
		expect(source).toContain(tenantPrefixLiteral);
		expect(
			source.includes('deleteByPrefix('),
			'退会経路で deleteByPrefix を使うと delete marker が立つだけで実体が 30 日残る',
		).toBe(false);
	});

	// 全 backend に purge 経路があること。1 つでも欠けると、その backend の退会だけ
	// ファイルが消えない / 例外になる silent な差が生まれる。
	it('[D2] storage backend 3 実装すべてが purgeByPrefix を持つ', () => {
		for (const rel of [
			'src/lib/server/db/s3/storage-repo.ts',
			'src/lib/server/db/sqlite/storage-repo.ts',
			'src/lib/server/db/demo/storage-repo.ts',
		]) {
			const body = fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf-8');
			expect(body, `${rel} に purgeByPrefix が無い`).toContain('purgeByPrefix');
		}
	});
});
