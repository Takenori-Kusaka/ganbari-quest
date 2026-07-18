// infra/.dependency-cruiser.cjs — CDK stack 間依存境界の宣言的 gate (#3871 AC3 / ADR-0061 Phase 2)
//
// CDK app は `bin/*.ts` (composition root) が各 stack を new し、stack 間の参照は props /
// public interface (CfnOutput / ImportValue、#3858 allowlist ratchet) 経由で渡す。
// stack module 同士 (`lib/*-stack.ts` ↛ `lib/*-stack.ts`) を直接 import すると composition root
// を迂回した暗黙結合が生まれ、循環 stack 依存や synth 順の非決定性を招く。
//
// 現状 stack 間直 import は 0 件 (共有は `env-config` のみ = 正当な public config、-stack 名でない
// ため下記ルールに非該当)。本 gate は armed-before-use の regression net。infra は規模小のため
// 軽量に「循環 (error)」+「stack 間直 import (error)」の 2 ルールに限定する。
//
// 実行環境の注意 (#3871): infra/ は typescript@^7 を使うが dependency-cruiser 18 は
// typescript >=2 <7 のみ transpile 可能。infra 配下で depcruise を実行すると TS を解析できず
// module 0 件 (rule inert) になるため、**root から root の typescript@^6 を使って実行**する
// (`npm run depcruise:infra` = `depcruise infra/lib infra/bin --config infra/.dependency-cruiser.cjs`)。
// そのため module source は repo root 相対 (`infra/lib/compute-stack.ts` 等) になり、paths も
// `^infra/lib/...` で anchor する。

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			severity: 'error',
			comment: 'CDK module の循環依存を検出した。依存を一方向に整理する (#3871 / ADR-0061)。',
			from: {},
			to: { circular: true },
		},
		{
			name: 'no-cross-stack-internal-import',
			severity: 'error',
			comment:
				'stack module が別 stack module を直接 import している。stack 間の参照は bin/ (composition ' +
				'root) の props 受け渡し / CfnOutput・ImportValue (public interface) 経由にする (#3871 AC3)。',
			from: { path: '^infra/lib/[^/]+-stack\\.ts$' },
			to: { path: '^infra/lib/[^/]+-stack\\.ts$' },
		},
	],
	options: {
		// tsConfig は指定しない: infra は path alias を持たず相対 import のみのため、root の
		// typescript@^6 (depcruise 対応版) による既定 tsc parse で解決できる。infra/tsconfig.json を
		// 指定すると include glob が infra/ 相対のため root 実行で TS18003 (No inputs found) になる。
		tsPreCompilationDeps: true,
		doNotFollow: { path: 'node_modules' },
		exclude: {
			path: '(^|/)(cdk\\.out|node_modules|test-results)/',
		},
	},
};
