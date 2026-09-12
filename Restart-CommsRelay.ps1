# Kill every Agent Comms bridge spawned from this folder. Does not poke windows.
# Does not start Claude/Codex/Grok — those respawn MCP on next tool use or app reload.
# Usage:  powershell -NoProfile -File .\Restart-CommsRelay.ps1

$ErrorActionPreference = "Stop"
$needle = 'CommsRelay\\dist\\cli.js'
$killed = @()
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    if ($_.CommandLine -match $needle) {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed += $_.ProcessId
    }
}
if ($killed.Count -eq 0) {
    Write-Host "No CommsRelay cli.js processes."
} else {
    Write-Host "Killed $($killed.Count): $($killed -join ', ')"
}
