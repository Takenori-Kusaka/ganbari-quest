// tests/unit/scripts/check-lambda-env-drift.test.ts
// #4352: deploy 済み Lambda の env が IaC の外で足されたまま残る drift の検出 gate 回帰ガード。
//
// 実障害 (#4117 E1): 監査が手で注入した STRIPE_PRICE_*_MONTHLY が full staging deploy (success) を
// 跨いで残った。CFN はテンプレ無変更ならリソースを触らず、deploy の ORIGIN 解決 step は live env を
// read-modify-write するため、手で足した env は deploy のたびに re-commit される。
// 本テストは「extra キーを検出する / 実行時解決キーを誤検出しない」ことを機械検証する。

import { describe, expect, it } from 'vitest';
import {
	diffEnvKeys,
	extractTemplateEnvKeys,
	RUNTIME_RESOLVED_KEYS,
} from '../../../scripts/check-lambda-env-drift.mjs';

const template = (vars: Record<string, unknown>) => ({
	Resources: {
		SvelteKitFn878D7344: {
			Type: 'AWS::Lambda::Function',
			Properties: { Environment: { Variables: vars } },
		},
		SomeRole: { Type: 'AWS::IAM::Role', Properties: {} },
	},
});

describe('#4352 extractTemplateEnvKeys', () => {
	it('Lambda の env キーのみを抽出する (他リソースは無視)', () => {
		expect(extractTemplateEnvKeys(template({ AUTH_MODE: 'cognito', DATA_SOURCE: 'dsql' }))).toEqual(
			['AUTH_MODE', 'DATA_SOURCE'],
		);
	});

	it('値が Fn::* の intrinsic でもキーだけ取れる (値は読まない)', () => {
		const t = template({ DSQL_ENDPOINT: { 'Fn::ImportValue': 'x' }, PORT: '3000' });
		expect(extractTemplateEnvKeys(t)).toEqual(['DSQL_ENDPOINT', 'PORT']);
	});

	it('Lambda が無いテンプレートは空配列 (呼び出し側が参照先誤りとして扱う)', () => {
		expect(extractTemplateEnvKeys({ Resources: { R: { Type: 'AWS::S3::Bucket' } } })).toEqual([]);
	});
});

describe('#4352 diffEnvKeys', () => {
	const tpl = ['AUTH_MODE', 'DATA_SOURCE', 'STRIPE_SECRET_KEY', 'USE_LOOKUP_KEY'];

	it('IaC の外で足された env を extra として検出する (実障害の再現)', () => {
		const live = [
			...tpl,
			...RUNTIME_RESOLVED_KEYS,
			'STRIPE_PRICE_STANDARD_MONTHLY',
			'STRIPE_PRICE_FAMILY_MONTHLY',
		];
		expect(diffEnvKeys(live, tpl).extra).toEqual([
			'STRIPE_PRICE_FAMILY_MONTHLY',
			'STRIPE_PRICE_STANDARD_MONTHLY',
		]);
	});

	it('deploy 後に解決して足される 3 本 (ORIGIN 系) は drift 扱いしない', () => {
		const live = [...tpl, ...RUNTIME_RESOLVED_KEYS];
		expect(diffEnvKeys(live, tpl)).toEqual({ extra: [], missing: [] });
	});

	it('IaC にあるのに配備されていないキーを missing として返す', () => {
		const live = ['AUTH_MODE', 'DATA_SOURCE', ...RUNTIME_RESOLVED_KEYS];
		expect(diffEnvKeys(live, tpl).missing).toEqual(['STRIPE_SECRET_KEY', 'USE_LOOKUP_KEY']);
	});

	it('extra と missing は同時に報告される (片方で早期 return しない)', () => {
		const live = ['AUTH_MODE', 'SOMETHING_MANUAL'];
		const d = diffEnvKeys(live, tpl);
		expect(d.extra).toEqual(['SOMETHING_MANUAL']);
		expect(d.missing).toEqual(['DATA_SOURCE', 'STRIPE_SECRET_KEY', 'USE_LOOKUP_KEY']);
	});

	it('実行時解決キー SSOT に無い「後から足す env」を増やすと fail する (追記漏れを検出)', () => {
		// 新しく deploy 後注入キーを増やしたのに RUNTIME_RESOLVED_KEYS へ追記しない場合を模す
		expect(diffEnvKeys([...tpl, 'RESOLVED_LATER'], tpl).extra).toEqual(['RESOLVED_LATER']);
	});
});
