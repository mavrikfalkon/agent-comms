#Requires AutoHotkey v2.0
#SingleInstance Force
#UseHook
SetTitleMatchMode 2

; Lives in this project folder. Do not put CommsRelay AHK under C:\Users\mavri\AHK\.
; Leader poke — drain agent_comms. Never uses screen-absolute clicks (those locked the PC).
; Match process + title, not hwnd. Electron: click lower-center of THAT window's client.
; Terminal (Grok TUI): activate + SendText only — never Ctrl+A (readline beginning-of-line).
;
;   ^#!1  Claude Code  (claude.exe, title Claude)
;   ^#!2  ChatGPT/Codex (ChatGPT.exe, title ChatGPT)
;   ^#!3  Grok TUI      (WindowsTerminal.exe, title Grok)
;   ^#!4  Grok Bot
;   ^#!0  Claude + ChatGPT + Grok TUI
;   ^#!Esc  unload this script
;
; Stop: tray Exit, or Ctrl+Win+Alt+Esc. Reload after editing this file.

PokeText := "Poke: call agent_comms with action read_room room=CommsRelay, report new messages, then stop. Do not implement."

^#!Esc:: ExitApp
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
    ; Claude Code: Electron, prompt is Edit "Prompt" near the bottom of the client.
    PokeElectron("Claude", "claude.exe")
}

PokeChatGPT() {
    ; Codex desktop still shows title ChatGPT / process ChatGPT.exe.
    PokeElectron("ChatGPT", "ChatGPT.exe")
}

PokeGrokTui() {
    hwnd := WinExist("Grok ahk_exe WindowsTerminal.exe")
    if !hwnd {
        TrayTip "CommsRelay poke", "Grok TUI not found (title Grok, WindowsTerminal).", 2
        return
    }
    if !ActivateHwnd(hwnd, "Grok TUI")
        return
    ReleaseChord()
    ; No click. No Ctrl+A.
    SendText PokeText
    Send "{Enter}"
}

PokeGrokBot() {
    hwnd := WinExist("ahk_exe Grok Bot.exe")
    if !hwnd {
        TrayTip "CommsRelay poke", "Grok Bot window not found.", 2
        return
    }
    PokeElectronHwnd(hwnd, "Grok Bot")
}

PokeElectron(title, exe) {
    hwnd := WinExist(title " ahk_exe " exe)
    if !hwnd {
        TrayTip "CommsRelay poke", title " not found (" exe ").", 2
        return
    }
    PokeElectronHwnd(hwnd, title)
}

PokeElectronHwnd(hwnd, label) {
    if !ActivateHwnd(hwnd, label)
        return
    WinGetClientPos(, , &w, &h, "ahk_id " hwnd)
    if w < 80 || h < 80 {
        TrayTip "CommsRelay poke", label " client size too small; not clicking.", 2
        return
    }
    ReleaseChord()
    CoordMode "Mouse", "Client"
    ; Prompt sits at the bottom of Claude Code / ChatGPT. Stay inside THIS window.
    Click w // 2, h - 56
    Sleep 80
    PasteReplaceElectron()
}

ActivateHwnd(hwnd, label) {
    WinRestore "ahk_id " hwnd
    WinActivate "ahk_id " hwnd
    if !WinWaitActive("ahk_id " hwnd, , 2) {
        TrayTip "CommsRelay poke", label " did not activate.", 2
        return false
    }
    Sleep 80
    return true
}

ReleaseChord() {
    KeyWait "Ctrl"
    KeyWait "Alt"
    KeyWait "LWin"
    KeyWait "RWin"
}

PasteReplaceElectron() {
    global PokeText
    old := ClipboardAll()
    try {
        A_Clipboard := PokeText
        if !ClipWait(0.8) {
            TrayTip "CommsRelay poke", "Clipboard did not accept poke text.", 2
            return
        }
        Send "^a"
        Sleep 40
        Send "^v"
        Sleep 60
        Send "{Enter}"
    } finally {
        A_Clipboard := old
    }
}
