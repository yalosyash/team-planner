' ============================================================
'  create-shortcut.vbs - shortcut with the app icon
'  Called from start.bat on first run. Windows cannot show an
'  icon for .bat, so a .lnk file appears next to it.
'
'  The file must stay ASCII: Windows Script Host reads .vbs in
'  the ANSI code page, so Russian text is assembled from char
'  codes with U() instead of being typed literally.
'  (ParamArray does not exist in VBScript - hence the Split.)
' ============================================================
Option Explicit

Dim fso, sh, dir, lnk, name, desc, target, icon, link

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)

' "Planirovshchik" (the shortcut name, Cyrillic)
name = U("1055 1083 1072 1085 1080 1088 1086 1074 1097 1080 1082")
' "Planirovshchik zagruzki komandy" (shortcut description)
desc = name & " " & U("1079 1072 1075 1088 1091 1079 1082 1080") & _
       " " & U("1082 1086 1084 1072 1085 1076 1099")

lnk = fso.BuildPath(dir, name & ".lnk")

' already created - do not touch the user's icon twice
If fso.FileExists(lnk) Then WScript.Quit 0

target = fso.BuildPath(dir, "start.bat")
icon = fso.BuildPath(dir, "app\favicon.ico")

If Not fso.FileExists(target) Then WScript.Quit 0

Set link = sh.CreateShortcut(lnk)
link.TargetPath = target
link.WorkingDirectory = dir
link.Description = desc
' the bat window flashes for a moment - keep it minimized
link.WindowStyle = 7
If fso.FileExists(icon) Then link.IconLocation = icon & ",0"
link.Save

WScript.Quit 0

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
