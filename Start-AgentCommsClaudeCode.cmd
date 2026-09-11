@echo off
REM Claude Code only. Codex and this TUI keep Start-AgentCommsMcp.cmd (bridge mcp).
cd /d "%~dp0"
if not defined AGENT_COMMS_TRACE_DIR set "AGENT_COMMS_TRACE_DIR=%LOCALAPPDATA%\CommsRelay\logs"
"C:\Program Files\nodejs\node.exe" "%~dp0dist\cli.js" bridge claude-code
