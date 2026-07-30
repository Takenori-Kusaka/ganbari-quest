<#
.SYNOPSIS
  がんばりクエスト: open PR / open issue を 0 件に向けて消化する無人オーケストレーター。

.DESCRIPTION
  Anthropic 公式の long-running agent harness パターン
  (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  に沿った「決定的オーケストレーター + 使い捨て worker」構成。

    - 決定的側 (このスクリプト): セッションの起動・上限管理・停止判定・進捗ゼロ検出
      → context を持たないので「長時間で止まる」問題が構造的に起きない
    - LLM 側 (1 サイクル = 1 プロセスの claude -p): 何を next にやるかの判断・実装・レビュー
      → サイクルごとに context がゼロにリセットされる

  状態の SSOT は GitHub (open PR / open issue / label / CI)。
  ローカル state はサイクル計数・コスト・反復検出のみ (state.json)。

.NOTES
  - `--bare` は絶対に使わない。hooks (heavy-run-lock / gate-approve) が無効化されるため。
  - heavy 検証の排他は既存の PreToolUse hook (machine-wide file lock) がそのまま効く。
    このスクリプトは lock を再実装しない。
#>

[CmdletBinding()]
param(
    # サイクル数の上限。0 で無制限 (非推奨)。
    [int]$MaxCycles = 40,

    # 累計コスト上限 (USD)。claude -p の total_cost_usd を加算して判定する。
    [double]$MaxCostUsd = 100.0,

    # 総経過時間の上限 (分)。
    [int]$MaxMinutes = 720,

    # 1 サイクルのタイムアウト (分)。pre-ready が 20-30 分かかるため余裕を持たせる。
    [int]$CycleTimeoutMinutes = 60,

    # 進捗ゼロがこの回数連続したら停止する。
    [int]$MaxNoProgress = 5,

    # 起動時に 1 サイクルだけ実行して終了する (動作確認用)。
    [switch]$Once,

    # 実際には claude を起動せず、判定ロジックだけ流す。
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# scripts/ 直下に置かれる前提。リポジトリルートは 1 つ上。
# 別 PC / 別クローンでも動くよう、絶対パスをハードコードしない (#4111)。
$ScriptDir = $PSScriptRoot
$RepoDir   = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$WorkDir   = Join-Path $ScriptDir '.autopilot'

$PromptFile= Join-Path $ScriptDir 'autopilot-cycle-prompt.md'
$StateFile = Join-Path $WorkDir 'state.json'
$StopFile  = Join-Path $WorkDir 'STOP'
$LogDir    = Join-Path $WorkDir 'logs'

if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir | Out-Null }

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
if (-not (Test-Path $PromptFile)) { throw "サイクル prompt がありません: $PromptFile" }
if (-not (Test-Path (Join-Path $RepoDir '.git'))) { throw "git リポジトリではありません: $RepoDir" }

# ---------------------------------------------------------------------------
# ログ
# ---------------------------------------------------------------------------

# Windows PowerShell 5.1 の既定コンソール encoding では日本語ログが文字化けするため明示する。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Line {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    Add-Content -Path (Join-Path $LogDir 'autopilot.log') -Value $line -Encoding utf8
}

# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

function Read-State {
    if (Test-Path $StateFile) {
        try { return Get-Content $StateFile -Raw -Encoding utf8 | ConvertFrom-Json }
        catch { Write-Line "state.json が壊れています。初期化します: $_" 'WARN' }
    }
    return [pscustomobject]@{
        startedAt      = (Get-Date).ToString('o')
        cycle          = 0
        totalCostUsd   = 0.0
        noProgressRuns = 0
        recentTargets  = @()
        lastOpenPr     = -1
        lastOpenIssue  = -1
    }
}

function Save-State {
    param($State)
    $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding utf8
}

# ---------------------------------------------------------------------------
# GitHub の実状態 (完了判定の根拠。worker の自己申告は使わない)
# ---------------------------------------------------------------------------

# gh の JSON 配列を件数にする。
# 実測 (#4111): `@($json | ConvertFrom-Json).Count` は Windows PowerShell 5.1 で常に 1 を返し、
# open PR 11 件 / open issue 118 件を「1 件」と誤認した。-join で 1 本の文字列に正規化してから
# 変換すると正しく列挙される。件数を誤ると完了判定と進捗ゼロ検出が両方壊れるため関数に固定する。
function Measure-JsonArray {
    param([object]$Json)
    if (-not $Json) { return -1 }
    try {
        $parsed = (@($Json) -join "`n") | ConvertFrom-Json
        if ($null -eq $parsed) { return 0 }
        return @($parsed).Count
    } catch {
        return -1
    }
}

function Get-OpenCounts {
    Push-Location $RepoDir
    try {
        $prJson    = & gh pr list --state open --limit 100 --json number 2>$null
        $issueJson = & gh issue list --state open --limit 300 --json number 2>$null
        return @{ pr = (Measure-JsonArray $prJson); issue = (Measure-JsonArray $issueJson) }
    } finally { Pop-Location }
}

# ---------------------------------------------------------------------------
# 1 サイクル = claude -p を 1 プロセス起動 (新しい context)
# ---------------------------------------------------------------------------

function Invoke-Cycle {
    param([int]$CycleNo)

    $outFile = Join-Path $LogDir ("cycle-{0:D3}.json" -f $CycleNo)
    $errFile = Join-Path $LogDir ("cycle-{0:D3}.err" -f $CycleNo)

    if ($DryRun) {
        Write-Line "DryRun: claude は起動しません" 'WARN'
        return @{ ok = $true; cost = 0.0; result = 'AUTOPILOT_RESULT target=NONE action=noop detail=dry run' }
    }

    # prompt は stdin から渡す。
    # 実測 (#4111): `ProcessStartInfo.ArgumentList` は .NET Framework 4.x (Windows PowerShell 5.1)
    # に存在せず PropertyNotFoundException になる。長い多行 prompt をコマンドライン引数として
    # quoting するのも壊れやすいため、`claude -p` が stdin から prompt を読む経路を使う。
    #
    # --bare は付けない (hooks を殺さないため)。
    # --permission-mode bypassPermissions は無人実行のため。承認プロンプトで止まらせない。
    $claudeArgs = '-p --permission-mode bypassPermissions --output-format json'

    $proc = Start-Process -FilePath 'claude' `
        -ArgumentList $claudeArgs `
        -WorkingDirectory $RepoDir `
        -NoNewWindow -PassThru `
        -RedirectStandardInput $PromptFile `
        -RedirectStandardOutput $outFile `
        -RedirectStandardError $errFile

    $timeoutMs = $CycleTimeoutMinutes * 60 * 1000
    if (-not $proc.WaitForExit($timeoutMs)) {
        Write-Line "サイクル $CycleNo がタイムアウト ($CycleTimeoutMinutes 分)。プロセスツリーを終了します" 'WARN'
        try { & taskkill /F /T /PID $proc.Id | Out-Null } catch { Write-Line "taskkill 失敗: $_" 'WARN' }
        return @{ ok = $false; cost = 0.0; result = 'AUTOPILOT_RESULT target=NONE action=blocked detail=cycle timeout' }
    }

    $stdout = if (Test-Path $outFile) { Get-Content $outFile -Raw -Encoding utf8 } else { '' }

    $cost = 0.0
    $resultText = ''
    # 成否は claude の JSON (`is_error`) を第一の根拠にする。
    # 実測 (#4111): Start-Process -PassThru の `$proc.ExitCode` は、JSON が
    # `is_error:false` / `subtype:success` / `stop_reason:end_turn` を返した成功サイクルでも
    # 非 0 になった。exit code だけを見ると成功を失敗と記録してしまう。
    $okFromJson = $null
    try {
        $json = $stdout | ConvertFrom-Json
        $names = $json.PSObject.Properties.Name
        if ($names -contains 'total_cost_usd') { $cost = [double]$json.total_cost_usd }
        if ($names -contains 'result')         { $resultText = [string]$json.result }
        if ($names -contains 'is_error')       { $okFromJson = -not [bool]$json.is_error }
    } catch {
        Write-Line "サイクル $CycleNo の出力を JSON として解釈できませんでした (exit=$($proc.ExitCode))" 'WARN'
        $resultText = $stdout
    }

    $ok = if ($null -ne $okFromJson) { $okFromJson } else { $proc.ExitCode -eq 0 }
    return @{ ok = $ok; cost = $cost; result = $resultText; exitCode = $proc.ExitCode }
}

function Get-TargetFromResult {
    param([string]$Text)
    if (-not $Text) { return 'NONE' }
    $m = [regex]::Match($Text, 'AUTOPILOT_RESULT\s+target=(\S+)')
    if ($m.Success) { return $m.Groups[1].Value }
    return 'UNPARSED'
}

# ---------------------------------------------------------------------------
# メインループ
# ---------------------------------------------------------------------------

$state = Read-State
$startTime = [datetime]::Parse($state.startedAt)

Write-Line "=== autopilot 開始 ==="
Write-Line "上限: cycles=$MaxCycles / cost=`$$MaxCostUsd / minutes=$MaxMinutes / no-progress=$MaxNoProgress"
Write-Line "停止するには: New-Item '$StopFile' を作成してください"

while ($true) {

    # --- 安全弁 1: 停止フラグ --------------------------------------------
    if (Test-Path $StopFile) {
        Write-Line "STOP フラグを検出しました。終了します" 'STOP'
        Remove-Item $StopFile -Force -ErrorAction SilentlyContinue
        break
    }

    # --- 安全弁 2: サイクル数 --------------------------------------------
    if ($MaxCycles -gt 0 -and $state.cycle -ge $MaxCycles) {
        Write-Line "サイクル上限 $MaxCycles に到達しました。終了します" 'STOP'
        break
    }

    # --- 安全弁 3: 累計コスト --------------------------------------------
    if ($state.totalCostUsd -ge $MaxCostUsd) {
        Write-Line ("累計コスト上限に到達しました (`${0:N2} >= `${1:N2})。終了します" -f $state.totalCostUsd, $MaxCostUsd) 'STOP'
        break
    }

    # --- 安全弁 4: 総経過時間 --------------------------------------------
    $elapsed = (Get-Date) - $startTime
    if ($elapsed.TotalMinutes -ge $MaxMinutes) {
        Write-Line ("経過時間上限に到達しました ({0:N0} 分)。終了します" -f $elapsed.TotalMinutes) 'STOP'
        break
    }

    # --- 完了判定 (GitHub の実状態で判断する) ----------------------------
    $before = Get-OpenCounts
    if ($before.pr -eq 0 -and $before.issue -eq 0) {
        Write-Line "open PR / open issue がともに 0 件になりました。完了です" 'DONE'
        break
    }
    if ($before.pr -lt 0 -or $before.issue -lt 0) {
        Write-Line "gh から状態を取得できませんでした (認証切れ?)。5 分待って再試行します" 'WARN'
        Start-Sleep -Seconds 300
        continue
    }

    $state.cycle++
    Write-Line "--- cycle $($state.cycle) 開始 (open PR=$($before.pr) / open issue=$($before.issue)) ---"

    $r = Invoke-Cycle -CycleNo $state.cycle
    $state.totalCostUsd += $r.cost
    $target = Get-TargetFromResult -Text $r.result

    Write-Line ("cycle $($state.cycle) 終了: ok=$($r.ok) target=$target cost=`${0:N4} 累計=`${1:N2}" -f $r.cost, $state.totalCostUsd)
    if ($r.result) {
        $line = ($r.result -split "`n" | Where-Object { $_ -match 'AUTOPILOT_RESULT' } | Select-Object -Last 1)
        if ($line) { Write-Line "  $line" }
    }

    # --- 進捗ゼロ検出 -----------------------------------------------------
    $after = Get-OpenCounts
    $progressed = ($after.pr -lt $before.pr) -or ($after.issue -lt $before.issue)

    # 件数が減らなくても「同じ対象を繰り返していない」なら前進とみなす
    # (Draft→Ready、QA 修正、body 整備は件数を減らさないため)
    $recent = @($state.recentTargets)
    $repeating = ($target -ne 'NONE') -and ($recent.Count -ge 2) -and
                 ($recent[-1] -eq $target) -and ($recent[-2] -eq $target)

    if ($progressed) {
        $state.noProgressRuns = 0
    } elseif ($repeating -or $target -eq 'NONE') {
        $state.noProgressRuns++
        Write-Line "進捗ゼロ ($($state.noProgressRuns)/$MaxNoProgress): target=$target repeating=$repeating" 'WARN'
    } else {
        $state.noProgressRuns = 0
    }

    $recent += $target
    if ($recent.Count -gt 6) { $recent = $recent[-6..-1] }
    $state.recentTargets = $recent
    $state.lastOpenPr    = $after.pr
    $state.lastOpenIssue = $after.issue
    Save-State $state

    # --- 安全弁 5: 進捗ゼロ連続 -------------------------------------------
    if ($state.noProgressRuns -ge $MaxNoProgress) {
        Write-Line "進捗ゼロが $MaxNoProgress 回連続しました。人間の判断が要ると判断して終了します" 'STOP'
        break
    }

    if ($Once) { Write-Line "-Once が指定されているため 1 サイクルで終了します" 'STOP'; break }

    # --- バックオフ (進捗が無いほど長く待つ = 他セッションの lock 解放を待つ) --
    $sleepSec = [Math]::Min(60 + ($state.noProgressRuns * 120), 900)
    Write-Line "次のサイクルまで $sleepSec 秒待機します"
    Start-Sleep -Seconds $sleepSec
}

Write-Line "=== autopilot 終了 (cycle=$($state.cycle) / 累計コスト=`$$([Math]::Round($state.totalCostUsd,2))) ==="
Save-State $state
