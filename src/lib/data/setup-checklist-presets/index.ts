/**
 * Setup questionnaire checklist preset loader — build-time bundled JSON (#4907).
 *
 * `/setup/questionnaire` Q3 (「チェックリストを自動作成する？」) が選択したプリセットを
 * `applyChecklistPresets` (`$lib/server/services/questionnaire-service.ts`) で読み込むための
 * データ SSOT。以前は `static/checklist-presets/*.json` を **実行時に**
 * `fetch('/checklist-presets/<id>.json')` → 失敗時 `fs.readFileSync(resolve('static', ...))`
 * で読んでいたが、両方とも `process.cwd()` に依存する経路で **packaged deploy
 * (Lambda / NUC Docker) では必ず失敗していた**:
 *
 *   - Node の `fetch()` は相対 URL を常に reject する (`event.fetch` ではなく直接
 *     `fetch()` を呼んでいたため origin を持たない)
 *   - `fs` fallback の `resolve('static', 'checklist-presets', ...)` は cwd 起点。
 *     `Dockerfile.lambda` / `Dockerfile` は `COPY --from=build /app/build/ ./` で
 *     adapter-node の出力のみを配置するが、adapter-node は `static/` を `build/client/`
 *     にマージするため `build/static/` は存在しない。よって本番コンテナの cwd (`/app`)
 *     には `static/` が無く、fetch も fs も失敗し `loadPreset` は例外を投げずに `null` を
 *     返していた (呼び出し側は `if (!preset) continue;` で無言スキップ)
 *   - `npm run dev` / `vitest` / CI の `vite preview` は cwd = repo root なので
 *     `static/checklist-presets/*.json` を読めてしまい、この失敗が E2E では再現しなかった
 *
 * `src/lib/data/marketplace/index.ts` (「build-time bundled JSON for Lambda compatibility」)
 * と同じパターンで、実行時 I/O を排し cwd に依存しない build-time import に統一する。
 */

import afterSchool from './after-school.json';
import beyondGames from './beyond-games.json';
import eveningRoutine from './evening-routine.json';
import morningRoutine from './morning-routine.json';
import weekendChores from './weekend-chores.json';

/** チェックリストプリセットの 1 項目 */
export interface SetupChecklistPresetItem {
	name: string;
	icon: string;
	sortOrder: number;
}

/** チェックリストプリセット (`applyChecklistPresets` が読み込む形) */
export interface SetupChecklistPreset {
	presetId: string;
	name: string;
	icon: string;
	pointsPerItem: number;
	completionBonus: number;
	items: SetupChecklistPresetItem[];
}

/** presetId → preset 定義 (build-time bundled、実行時 I/O 無し) */
export const SETUP_CHECKLIST_PRESETS: Readonly<Record<string, SetupChecklistPreset>> = {
	'morning-routine': morningRoutine,
	'evening-routine': eveningRoutine,
	'after-school': afterSchool,
	'weekend-chores': weekendChores,
	'beyond-games': beyondGames,
};

/** presetId からプリセット定義を引く。未知の id は `undefined`。 */
export function getSetupChecklistPreset(presetId: string): SetupChecklistPreset | undefined {
	return SETUP_CHECKLIST_PRESETS[presetId];
}
