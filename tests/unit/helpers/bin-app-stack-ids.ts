// tests/unit/helpers/bin-app-stack-ids.ts
//
// infra/bin/app.ts が instantiate し得る stack id を、ソースから抽出する。
//
// synth して全 stack を検査する infra の fitness test (cross-stack export / IAM description /
// 明示物理名) は、stack の組み立てを test 側で手書きしている。bin/app.ts に stack が増えても
// test は追随しないため、「検査した stack の集合 = bin/app.ts の stack の集合」をこの抽出結果と
// 突き合わせて、検査からの漏れを fail させる。本数を数字で書くと、その数字ごと古くなる。
//
// bin/app.ts は module scope で `app.synth()` まで実行する実行スクリプトのため import できない。
// `new XxxStack(app, `${appName}<Id>`, ...)` の定型 instantiation をソースから拾う
// (`if (stagingEnabled)` 等の context gate の内側も含めた「instantiate し得る全 stack」を返す)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `infra/bin/app.ts` の `appName` (stack 名の prefix)。 */
export const BIN_APP_NAME = 'GanbariQuest';

const BIN_APP_TS_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../infra/bin/app.ts',
);

/** bin/app.ts のソースから stack id (`${appName}` prefix 抜き) を抽出する。 */
export function parseBinStackIds(source: string): string[] {
	return [...source.matchAll(/new \w+Stack\(\s*app,\s*`\$\{appName\}(\w+)`/g)].flatMap((m) =>
		m[1] === undefined ? [] : [m[1]],
	);
}

/** infra/bin/app.ts を読み、stack id (`${appName}` prefix 抜き) を返す。 */
export function readBinStackIds(): string[] {
	return parseBinStackIds(readFileSync(BIN_APP_TS_PATH, 'utf8'));
}

/** infra/bin/app.ts を読み、stack 名 (`GanbariQuest<Id>`) を昇順で返す。 */
export function readBinStackNames(): string[] {
	return readBinStackIds()
		.map((id) => `${BIN_APP_NAME}${id}`)
		.sort();
}
