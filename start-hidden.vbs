' Запускает server.js полностью без консольного окна.
' Используется из start.bat. Останавливать вручную не нужно:
' сервер завершится сам, когда закроется последняя вкладка планировщика.
Option Explicit

Dim fso, sh, dir, nodePath
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' Путь к node передаёт start.bat первым аргументом
If WScript.Arguments.Count > 0 Then
  nodePath = WScript.Arguments(0)
Else
  nodePath = "node"
End If

' 0 — скрытое окно, False — не ждать завершения процесса
sh.Run Chr(34) & nodePath & Chr(34) & " " & Chr(34) & dir & "\server.js" & Chr(34) & " --hidden", 0, False
