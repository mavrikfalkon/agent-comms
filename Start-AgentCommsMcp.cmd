@echo off
REM Canonical MCP start on this PC. Do not use npx agent-comms (git+SSH / missing @exadev/wire-mesh-core).
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" "%~dp0dist\cli.js" bridge mcp

