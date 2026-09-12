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
;   ^#!4  Grok Bot
;   ^#!0  Claude + ChatGPT + Grok TUI
; From Main: PokeComms("chatgpt", "your text")  ; who: claude|chatgpt|codex|grok-tui|grok-bot|all
; Reload Main: Ctrl+Alt+R

PokeText := "Poke: call agent_comms with action read_room room=CommsRelay, report new messages, then stop. Do not implement."

PokeComms(who, text := "") {
    global PokeText
    saved := PokeText
    if text != ""
        PokeText := text
    try {
        switch StrLower(who) {
            case "claude", "claude-coworker":
                PokeClaude()
            case "chatgpt", "codex":
                PokeChatGPT()
            case "grok", "grok-tui", "tui":
                PokeGrokTui()
            case "grok-bot", "bot":
                PokeGrokBot()
            case "all":
                PokeClaude()
                Sleep 400
                PokeChatGPT()
                Sleep 400
                PokeGrokTui()
            default:
                TrayTip "CommsRelay poke", "Unknown recipient: " who, 2
        }
    } finally {
        PokeText := saved
    }
}

^#!1:: PokeComms("claude")
^#!2:: PokeComms("chatgpt")
^#!3:: PokeComms("grok-tui")
^#!4:: PokeComms("grok-bot")
^#!0:: PokeComms("all")

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
