// #1360: おやカギコード (parent lock code) constants
// DEFAULT_PIN is intentionally public — it's a household-level soft gate, not a security credential.
// Threat model: prevent children from accidentally accessing the admin panel, not protect against external attackers.
export const DEFAULT_PIN = '5086'; // "がんばり" phonetic mnemonic
