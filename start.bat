@echo off
rem Keep ASCII before chcp: cmd.exe reads this UTF-8 file in the console code page.
setlocal
cd /d "%~dp0"
set "OLDPAGE="
for /f "tokens=2 delims=:" %%P in ('chcp') do set "OLDPAGE=%%P"
set "OLDPAGE=%OLDPAGE: =%"
set "OLDPAGE=%OLDPAGE:.=%"
chcp 65001 >nul

for /f "delims=" %%N in ('where node 2^>nul') do (
  set "NODE=%%N"
  goto :have_node
)
echo Node.js не найден. Без него планировщик не запустится.
echo Установите Node.js LTS с https://nodejs.org и запустите start.bat снова.
pause
goto :done

:have_node
rem Сначала подготовка хранения, затем одноразовый вопрос о ярлыке.
cscript.exe //nologo "%~dp0create-shortcut.vbs" "%NODE%"
if errorlevel 1 (
  echo Запуск отменён: не удалось подготовить данные или настройки ярлыка.
  pause
  goto :done
)
rem Сервер работает без окна и завершается после закрытия последней вкладки.
start "" wscript.exe //nologo "%~dp0start-hidden.vbs" "%NODE%"

:done
if defined OLDPAGE chcp %OLDPAGE% >nul 2>nul
exit /b
