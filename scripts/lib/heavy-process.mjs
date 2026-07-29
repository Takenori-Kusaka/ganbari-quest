/** 現状再現 shim (failing-test-first 用の一時実装。次コミットで本実装に差し替える)。 */
export function isHeavyProcessCmdline() {
	return false;
}
export function findHeavyProcesses() {
	return [];
}
export function collectDescendants() {
	return [];
}
export function planProcessCleanup() {
	return { targets: [], excluded: [] };
}
