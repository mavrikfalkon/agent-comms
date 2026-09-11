# Drain pending agent-comms events for Claude Code asyncRewake (Windows).
# Matches channel.ts pending file when findClaudeCodePid fails (no `ps` here):
#   ~/.agents/bus/pending/claude-code--<cwd-slug>.jsonl
# Exit 2 with stderr content wakes idle Claude. Exit 0 if nothing pending.

$ErrorActionPreference = "Stop"
$slug = [regex]::Replace((Get-Location).Path, "[^a-zA-Z0-9]", "_")
$dir = Join-Path $env:USERPROFILE ".agents\bus\pending"
$pending = Join-Path $dir "claude-code--$slug.jsonl"
if (-not (Test-Path -LiteralPath $pending)) {
    exit 0
}
$draining = "$pending.draining-$PID-$(Get-Date -UFormat %s)"
try {
    Move-Item -LiteralPath $pending -Destination $draining -Force
} catch {
    exit 0
}
$content = Get-Content -LiteralPath $draining -Raw -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $draining -Force -ErrorAction SilentlyContinue
if ([string]::IsNullOrWhiteSpace($content)) {
    exit 0
}
[Console]::Error.WriteLine("Pending agent-comms messages:")
foreach ($line in ($content -split "`n")) {
    $t = $line.Trim()
    if ($t.Length -gt 0) {
        [Console]::Error.WriteLine("  📬 $t")
    }
}
exit 2
