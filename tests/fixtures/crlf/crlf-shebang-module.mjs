#!/usr/bin/env node
/**
 * tests/fixtures/crlf/crlf-shebang-module.mjs (#3984)
 *
 * CRLF 改行 + shebang + import 文を併せ持つ最小 fixture。
 * import 文があることが必須 — vite ssr transform が import を先頭行へ hoist した結果、
 * 除去し損ねた shebang と同一行で衝突する、というのが #3984 の再現条件。
 *
 * .gitattributes の `tests/fixtures/crlf/*.mjs text eol=crlf` で全 checkout 環境で
 * CRLF に固定される (repo 既定の eol=lf を意図的に上書き)。
 * 改行を LF に直さないこと — CRLF であること自体が検証対象。
 *
 * 検証: tests/unit/scripts/crlf-shebang-import.test.ts
 */

import { basename } from 'node:path';

export const MARKER = 'crlf-shebang-ok';

// module 評価時に hoist 済み import を実際に使う (transform が壊れていれば評価できない)
export const BASE_OF_SAMPLE = basename('/tmp/foo/bar.mjs');
