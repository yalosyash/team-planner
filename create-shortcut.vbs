' ============================================================
'  create-shortcut.vbs - shortcut with the app icon
'  Called from start.bat on first run. Windows cannot show an
'  icon for .bat, so a .lnk file appears on the user's desktop.
'
'  The file must stay ASCII: Windows Script Host reads .vbs in
'  the ANSI code page, so Russian text is assembled from char
'  codes with U() instead of being typed literally.
'  (ParamArray does not exist in VBScript - hence the Split.)
' ============================================================
Option Explicit

Dim fso, sh, dir, lnk, name, desc, target, icon, link
Dim dataDir, settings, answer, question

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)

' "Planirovshchik" (the shortcut name, Cyrillic)
name = U("1055 1083 1072 1085 1080 1088 1086 1074 1097 1080 1082")
' "Planirovshchik zagruzki komandy" (shortcut description)
desc = name & " " & U("1079 1072 1075 1088 1091 1079 1082 1080") & _
       " " & U("1082 1086 1084 1072 1085 1076 1099")

lnk = fso.BuildPath(sh.SpecialFolders("Desktop"), name & ".lnk")

target = fso.BuildPath(dir, "start.bat")
icon = fso.BuildPath(dir, "app\assets\planner-calendar.ico")
dataDir = fso.BuildPath(dir, "data")
settings = fso.BuildPath(dataDir, "launcher.json")

' Upgrade the icon on existing shortcuts without resetting their settings.
If fso.FileExists(lnk) Then
  Set link = sh.CreateShortcut(lnk)
  If fso.FileExists(icon) Then
    If LCase(link.IconLocation) <> LCase(icon & ",0") Then
      link.IconLocation = icon & ",0"
      link.Save
    End If
  End If
  If Not fso.FileExists(settings) Then SaveAnswer True
  WScript.Quit 0
End If

If fso.FileExists(settings) Then WScript.Quit 0
If Not fso.FileExists(target) Then WScript.Quit 0

' Ask once. Keep this file ASCII for Windows Script Host.
question = U("1057 1086 1079 1076 1072 1090 1100 32 1103 1088 1083 1099 1082 32 1085 1072 32 1088 1072 1073 1086 1095 1077 1084 32 1089 1090 1086 1083 1077 63")
answer = MsgBox(question, vbYesNo + vbQuestion + vbDefaultButton2, name)
If answer <> vbYes Then
  SaveAnswer False
  WScript.Quit 0
End If

Set link = sh.CreateShortcut(lnk)
link.TargetPath = target
link.WorkingDirectory = dir
link.Description = desc
' the bat window flashes for a moment - keep it minimized
link.WindowStyle = 7
If fso.FileExists(icon) Then link.IconLocation = icon & ",0"
link.Save
SaveAnswer True

WScript.Quit 0

Sub SaveAnswer(created)
  Dim file, value
  If Not fso.FolderExists(dataDir) Then fso.CreateFolder dataDir
  value = "false"
  If created Then value = "true"
  Set file = fso.CreateTextFile(settings, True, False)
  file.WriteLine "{""desktopShortcutAsked"":true,""desktopShortcutCreated"":" & value & "}"
  file.Close
End Sub

' Build a string from space-separated char codes
Function U(codes)
  Dim parts, i, s
  parts = Split(codes, " ")
  s = ""
  For i = 0 To UBound(parts)
    s = s & ChrW(CInt(parts(i)))
  Next
  U = s
End Function
