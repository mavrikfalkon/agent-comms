#Requires AutoHotkey v2.0
#SingleInstance Force
#UseHook
SetTitleMatchMode 2

; Lives in this project folder. Do not put CommsRelay AHK under C:\Users\mavri\AHK\.
; Leader poke — drain agent_comms on another harness.
; Chords are Ctrl+Win+Alt so they do not collide with Win+G.
;   ^#!1  Claude
;   ^#!2  ChatGPT
;   ^#!3  Grok TUI (Windows Terminal title Grok)
;   ^#!4  Grok Bot (restore + best-effort; not on the mesh yet)
;   ^#!0  Claude + ChatGPT + Grok TUI
;
; Stops: close this script from the tray, or replace this file and reload.

PokeText := "Poke: call agent_comms with action list_agents, then stop. Do not implement."

^#!1:: PokeClaude()
^#!2:: PokeChatGPT()
^#!3:: PokeGrokTui()
^#!4:: PokeGrokBot()
^#!0:: {
    PokeClaude()
    Sleep 400
    PokeChatGPT()
    Sleep 400
    PokeGrokTui()
}

PokeClaude() {
    ; Edit "Write your prompt to Claude" — window-relative click from live UIA.
    PokeElectron("Claude", "claude.exe", 842, 594)
}

PokeChatGPT() {
    ; Edit "Do anything" — window-relative click from live UIA.
    PokeElectron("ChatGPT", "ChatGPT.exe", 832, 610)
}

PokeGrokTui() {
    hwnd := WinExist("Grok ahk_exe WindowsTerminal.exe")
    if !hwnd {
        TrayTip "CommsRelay poke", "Grok TUI window not found (title Grok, WindowsTerminal).", 2
        return
    }
    WinRestore "ahk_id " hwnd
    WinActivate "ahk_id " hwnd
    if !WinWaitActive("ahk_id " hwnd, , 2) {
        TrayTip "CommsRelay poke", "Grok TUI did not activate.", 2
        return
    }
    Sleep 80
    PasteAndEnter()
}

PokeGrokBot() {
    hwnd := WinExist("ahk_exe Grok Bot.exe")
    if !hwnd {
        TrayTip "CommsRelay poke", "Grok Bot window not found.", 2
        return
    }
    WinRestore "ahk_id " hwnd
    WinActivate "ahk_id " hwnd
    if !WinWaitActive("ahk_id " hwnd, , 2) {
        TrayTip "CommsRelay poke", "Grok Bot did not activate.", 2
        return
    }
    Sleep 200
    ; Minimized earlier; no UIA Edit while off-screen. Click lower-center of client.
    WinGetClientPos(&x, &y, &w, &h, "ahk_id " hwnd)
    CoordMode "Mouse", "Window"
    Click w // 2, h - 80
    Sleep 80
    PasteAndEnter()
}

PokeElectron(title, exe, relX, relY) {
    hwnd := WinExist(title " ahk_exe " exe)
    if !hwnd {
        TrayTip "CommsRelay poke", title " not found (" exe ").", 2
        return
    }
    WinRestore "ahk_id " hwnd
    WinActivate "ahk_id " hwnd
    if !WinWaitActive("ahk_id " hwnd, , 2) {
        TrayTip "CommsRelay poke", title " did not activate.", 2
        return
    }
    Sleep 80
    CoordMode "Mouse", "Window"
    Click relX, relY
    Sleep 80
    PasteAndEnter()
}

PasteAndEnter() {
    global PokeText
    old := ClipboardAll()
    A_Clipboard := PokeText
    if !ClipWait(0.8) {
        A_Clipboard := old
        TrayTip "CommsRelay poke", "Clipboard did not accept poke text.", 2
        return
    }
    Send "^a"
    Sleep 40
    Send "^v"
    Sleep 60
    Send "{Enter}"
    Sleep 40
    A_Clipboard := old
}
