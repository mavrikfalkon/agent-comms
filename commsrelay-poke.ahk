#Requires AutoHotkey v2.0
SetTitleMatchMode 2
#Include "C:\Users\mavri\Projects\GrokOnPC\AHKScripts\upstream\UIA-v2\Lib\UIA.ahk"

; Lives in this project. Included from GrokOnPC\AHKScripts\Main.ahk — do not #SingleInstance
; or ExitApp here (that would kill Main). Do not copy into C:\Users\mavri\AHK\.
; Leader poke — drain agent_comms. No screen-absolute clicks. Match process + title.
; Electron: click the BOTTOM-MOST Edit/Document in that window (the composer).
; Do not match by accessible name — Claude Code already renamed Prompt / placeholder.
; Sidebars shift the field off window-center; the control's own rect is the target.
; Terminal (Grok TUI): activate + SendText only — never Ctrl+A.
;
;   ^#!1  Claude Code  (claude.exe, title Claude)
;   ^#!2  ChatGPT/Codex (ChatGPT.exe, title ChatGPT)
;   ^#!3  Grok TUI      (WindowsTerminal.exe, title Grok)
;   ^#!4  Grok Bot (not on CommsRelay yet — named who only, not in all)
;   ^#!0  all mesh: claude + chatgpt + grok-tui (except from). Not grok-bot.
; From Main: PokeComms("chatgpt", "your text")  ; who + message, from=butch
; Agents / this TUI (does not touch running Main):
;   AutoHotkey64.exe commsrelay-poke.ahk from who "message"
;   from = grok-tui|claude-coworker|codex|butch
;   who  = claude|chatgpt|codex|grok-tui|grok-bot|all
;   all  = claude + chatgpt + grok-tui except from. grok-bot is not in the room.
; Reload Main: Ctrl+Alt+R

PokeText := "Poke: call agent_comms with action read_room room=CommsRelay, report new messages, then stop. Do not implement."

; One-shot CLI when this file is the launched script (not when included by Main).
if (A_ScriptFullPath = A_LineFile && A_Args.Length >= 2) {
    from := A_Args[1]
    who := A_Args[2]
    msg := ""
    n := 3
    while n <= A_Args.Length {
        msg .= (msg = "" ? "" : " ") A_Args[n]
        n++
    }
    Poke(from, who, msg)
    ExitApp
}

; from + who + message. Skips the window that belongs to from.
Poke(from, who, message := "") {
    global PokeText
    saved := PokeText
    body := message != "" ? message : saved
    PokeText := from != "" ? "[" from "] " body : body
    skip := PokeSkipTarget(from)
    try {
        switch StrLower(who) {
            case "claude", "claude-coworker", "claude-code":
                if skip != "claude"
                    PokeClaude()
            case "chatgpt", "codex":
                if skip != "chatgpt"
                    PokeChatGPT()
            case "grok", "grok-tui", "tui":
                if skip != "grok-tui"
                    PokeGrokTui()
            case "grok-bot", "bot":
                if skip != "grok-bot"
                    PokeGrokBot()
            case "all":
                if skip != "claude" {
                    PokeClaude()
                    Sleep 400
                }
                if skip != "chatgpt" {
                    PokeChatGPT()
                    Sleep 400
                }
                if skip != "grok-tui"
                    PokeGrokTui()
                ; grok-bot is not on CommsRelay; use who=grok-bot when it is.
            default:
                TrayTip "CommsRelay poke", "Unknown recipient: " who, 2
        }
    } finally {
        PokeText := saved
    }
}

PokeSkipTarget(from) {
    switch StrLower(from) {
        case "claude", "claude-coworker", "claude-code":
            return "claude"
        case "chatgpt", "codex":
            return "chatgpt"
        case "grok-tui", "grok", "tui":
            return "grok-tui"
        case "grok-bot", "bot":
            return "grok-bot"
        default:
            return ""
    }
}

; Main F19/F20: who + message, from = butch (does not skip any agent window).
PokeComms(who, text := "") {
    Poke("butch", who, text)
}

^#!1:: Poke("butch", "claude")
^#!2:: Poke("butch", "chatgpt")
^#!3:: Poke("butch", "grok-tui")
^#!4:: Poke("butch", "grok-bot")
^#!0:: Poke("butch", "all")

PokeClaude() {
    PokeElectron("Claude", "claude.exe")
}

PokeChatGPT() {
    ; Codex desktop still shows title ChatGPT / process ChatGPT.exe.
    PokeElectron("ChatGPT", "ChatGPT.exe")
}

PokeGrokTui() {
    global PokeText
    hwnd := WinExist("Grok ahk_exe WindowsTerminal.exe")
    if !hwnd {
        TrayTip "CommsRelay poke", "Grok TUI not found (title Grok, WindowsTerminal).", 2
        return
    }
    if !ActivateHwnd(hwnd, "Grok TUI")
        return
    ReleaseChord()
    if WinGetID("A") != hwnd {
        TrayTip "CommsRelay poke", "Grok TUI not focused; not sending (would hit the wrong window).", 2
        return
    }
    ; No click. No Ctrl+A. Send only if this hwnd is active.
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
    if WinGetID("A") != hwnd {
        TrayTip "CommsRelay poke", label " not focused; not sending.", 2
        return
    }
    if !ClickBottomComposer(hwnd, w, h) {
        ; Right sidebar (your Claude layout) puts the field left of window-center.
        CoordMode "Mouse", "Client"
        Click w // 3, h - 56
    }
    Sleep 80
    PasteReplaceElectron()
}

; Bottom-most Edit or Document with a composer-sized height. Not by Name.
ClickBottomComposer(hwnd, clientW, clientH) {
    try {
        win := UIA.ElementFromHandle(hwnd)
    } catch {
        return false
    }
    best := 0
    bestBottom := -1
    for typeName in ["Edit", "Document"] {
        try
            list := win.FindAll({ Type: typeName })
        catch
            continue
        for el in list {
            try {
                if el.IsOffscreen
                    continue
                loc := el.Location
                if loc.w < 80 || loc.h < 18 || loc.h > 280
                    continue
                bottom := loc.y + loc.h
                if bottom > bestBottom {
                    bestBottom := bottom
                    best := el
                }
            }
        }
    }
    if !best
        return false
    try {
        best.Click()
        return true
    } catch {
        try {
            loc := best.Location
            CoordMode "Mouse", "Screen"
            Click loc.x + loc.w // 2, loc.y + loc.h // 2
            return true
        } catch {
            return false
        }
    }
}

ActivateHwnd(hwnd, label) {
    ; Only restore if actually minimized. WinRestore on a normal/max window
    ; resizes Grok TUI (Windows Terminal) every doorbell.
    if WinGetMinMax("ahk_id " hwnd) = -1
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
    ; Do not use the clipboard. A leftover bitmap (screenshot) wins over text on Ctrl+V.
    Send "^a"
    Sleep 40
    SendText PokeText
    Sleep 40
    Send "{Enter}"
}
