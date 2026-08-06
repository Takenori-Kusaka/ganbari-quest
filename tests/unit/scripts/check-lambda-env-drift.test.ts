// tests/unit/scripts/check-lambda-env-drift.test.ts
// #4352: deploy 済み Lambda の env が IaC の外で足されたまま残る drift の検出 gate 回帰ガード。
//
// 実障害 (#4117 E1): 監査が手で注入した STRIPE_PRICE_*_MONTHLY が full staging deploy (success) を
// 跨いで残った。CFN はテンプレ無変更ならリソースを触らず、deploy の ORIGIN 解決 step は live env を
// read-modify-write するため、手で足した env は deploy のたびに re-commit される。
// 本テストは「extra キーを検出する / 実行時解決キーを誤検出しない」ことを機械検証する。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	classifyMissingKeys,
	diffEnvKeys,
	extractTemplateEnvKeys,
	REQUIRED_ALWAYS_PRESENT_KEYS,
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

	it('--logical-id-prefix で対象 Lambda を絞る (別関数のキーを許容しない)', () => {
		// 1 stack に app / cron-dispatcher / demo が同居する実構成を模す
		const multi = {
			Resources: {
				SvelteKitFn878D7344: {
					Type: 'AWS::Lambda::Function',
					Properties: { Environment: { Variables: { AUTH_MODE: 'cognito' } } },
				},
				CronDispatcherFn48591636: {
					Type: 'AWS::Lambda::Function',
					Properties: { Environment: { Variables: { FUNCTION_URL: 'https://…' } } },
				},
				SvelteKitDemoFn03A257DF: {
					Type: 'AWS::Lambda::Function',
					Properties: { Environment: { Variables: { DATA_SOURCE: 'demo' } } },
				},
			},
		};
		expect(extractTemplateEnvKeys(multi, 'SvelteKitFn')).toEqual(['AUTH_MODE']);
		// prefix 省略時は和集合 = 検査が緩む。既定値の挙動を固定して意図しない緩和を検出する
		expect(extractTemplateEnvKeys(multi)).toEqual(['AUTH_MODE', 'DATA_SOURCE', 'FUNCTION_URL']);
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

describe('#4365 follow-up classifyMissingKeys', () => {
	it('REQUIRED_ALWAYS_PRESENT_KEYS に含まれる missing を requiredMissing に分類する', () => {
		const missing = ['AUTH_MODE', 'COGNITO_USER_POOL_ID', 'STRIPE_SECRET_KEY'];
		const { requiredMissing, optionalMissing } = classifyMissingKeys(missing);
		expect(requiredMissing.sort()).toEqual(['AUTH_MODE', 'COGNITO_USER_POOL_ID']);
		expect(optionalMissing).toEqual(['STRIPE_SECRET_KEY']);
	});

	it('必須キーが missing に無ければ requiredMissing は空', () => {
		const { requiredMissing, optionalMissing } = classifyMissingKeys(['STRIPE_SECRET_KEY']);
		expect(requiredMissing).toEqual([]);
		expect(optionalMissing).toEqual(['STRIPE_SECRET_KEY']);
	});

	it('requiredKeys を差し替えられる (デフォルトは REQUIRED_ALWAYS_PRESENT_KEYS)', () => {
		expect(classifyMissingKeys(['FOO'], ['FOO']).requiredMissing).toEqual(['FOO']);
	});
});

describe('#4365 follow-up main() の hard-fail 挙動 (--strict 無指定でも必須キー欠落は fail)', () => {
	// main() は AWS SDK 呼び出し (fetchLiveEnvKeys) を含むため直接叩けないが、
	// main() 内の分岐が委譲する classifyMissingKeys が「missingIsFatal」判定の実体。
	// ここでは main() が実際に使う REQUIRED_ALWAYS_PRESENT_KEYS を用いて、
	// strict オプション無指定でも fatal 判定になることを固定する (回帰ガード)。
	it('strict=false でも REQUIRED_ALWAYS_PRESENT_KEYS の欠落は fatal 相当に分類される', () => {
		const missing = ['COGNITO_CLIENT_ID', 'MAINTENANCE_MODE'];
		const { requiredMissing } = classifyMissingKeys(missing);
		// COGNITO_CLIENT_ID は必須。strict フラグを見ずに fatal と判定できることを確認する。
		expect(requiredMissing).toContain('COGNITO_CLIENT_ID');
		expect(requiredMissing.length).toBeGreaterThan(0);
	});

	it('REQUIRED_ALWAYS_PRESENT_KEYS の対象外キーのみの欠落は fatal に分類されない (従来通り strict 依存)', () => {
		const missing = ['MAINTENANCE_MODE', 'SES_SENDER_EMAIL'];
		const { requiredMissing, optionalMissing } = classifyMissingKeys(missing);
		expect(requiredMissing).toEqual([]);
		expect(optionalMissing).toEqual(['MAINTENANCE_MODE', 'SES_SENDER_EMAIL']);
	});
});

describe('#4365 follow-up REQUIRED_ALWAYS_PRESENT_KEYS SSOT整合 (compute-stack.ts 実態照合)', () => {
	// RUNTIME_RESOLVED_KEYS には既存の照合テストが無いため本テストが初導入。
	// REQUIRED_ALWAYS_PRESENT_KEYS の各キーが infra/lib/compute-stack.ts で
	// 「条件付き spread (`...(x ? {…} : {})`) を経由しない無条件の直接代入」として
	// 存在することを実ファイルから機械検証する (SSOT が実態から乖離するのを防ぐ)。
	const computeStackPath = path.join(__dirname, '../../../infra/lib/compute-stack.ts');
	const computeStackSource = fs.readFileSync(computeStackPath, 'utf8');
	const lines = computeStackSource.split('\n');

	it.each(
		REQUIRED_ALWAYS_PRESENT_KEYS,
	)('%s は compute-stack.ts に無条件の直接代入として存在する', (key) => {
		// `KEY: value,` 形式の行を探し、同じ行に条件付き spread (`...(`) を含まないことを確認する。
		const directAssignmentLines = lines.filter((line) => {
			const trimmed = line.trim();
			return trimmed.startsWith(`${key}:`) && !trimmed.includes('...(');
		});
		expect(
			directAssignmentLines.length,
			`${key} の無条件直接代入が compute-stack.ts に見つかりません (条件付き spread に変わった可能性)`,
		).toBeGreaterThan(0);
	});

	it('REQUIRED_ALWAYS_PRESENT_KEYS に条件付き spread のみのキーを混入させていない', () => {
		// 逆方向の回帰ガード: 各 key が「条件付き spread の行にのみ」出現していないか確認する
		// (無条件代入が 1 つも無く、条件付きの行にしか出現しないキーを検出したら fail)
		for (const key of REQUIRED_ALWAYS_PRESENT_KEYS) {
			const conditionalOnlyLines = lines.filter((line) => {
				const trimmed = line.trim();
				return trimmed.includes(`{ ${key}:`) && trimmed.includes('...(');
			});
			const directLines = lines.filter((line) => {
				const trimmed = line.trim();
				return trimmed.startsWith(`${key}:`) && !trimmed.includes('...(');
			});
			if (conditionalOnlyLines.length > 0) {
				expect(
					directLines.length,
					`${key} は条件付き spread でのみ出現しており、無条件代入が見つかりません`,
				).toBeGreaterThan(0);
			}
		}
	});
});
