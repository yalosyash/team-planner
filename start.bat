@echo off
rem This file is UTF-8. cmd.exe parses .bat in the console code page, so the
rem comments above chcp must stay ASCII; switch to 65001 first, then the
rem Russian text below is read correctly.
setlocal
cd /d "%~dp0"

rem Запоминаем кодовую страницу консоли и переходим на UTF-8, иначе русский
rem текст ниже превращается в мусор. В конце вернём её обратно.
rem chcp печатает "Активная кодовая страница: 866"; в других локалях
rem бывает точка в конце, поэтому оставляем от ответа одни цифры.
set "OLDPAGE="
for /f "tokens=2 delims=:" %%P in ('chcp') do set "OLDPAGE=%%P"
set "OLDPAGE=%OLDPAGE: =%"
set "OLDPAGE=%OLDPAGE:.=%"
chcp 65001 >nul

rem Ярлык с иконкой рядом с папкой: у .bat своей иконки в Windows нет.
rem Скрипт сам выходит, если ярлык уже есть, и ничего не ломает, если
rem Windows запрещает .vbs - тогда просто запустится start.bat.
start "" wscript.exe //nologo "%~dp0create-shortcut.vbs"

for /f "delims=" %%N in ('where node 2^>nul') do (
  set "NODE=%%N"
  goto :have_node
)

echo Node.js не найден. Без него планировщик не запустится.
echo.
echo Установите Node.js (LTS-версию) с https://nodejs.org и запустите start.bat снова.
echo Проверить установку: node -v
echo.
pause
goto :done

:have_node
rem Запуск без консольного окна. Сервер работает в фоне и сам выключается,
rem когда закрыта последняя вкладка планировщика (см. app/js/core/keepalive.js).
rem Если сервер уже запущен, второй не поднимается - просто откроется браузер.
start "" wscript.exe //nologo "%~dp0start-hidden.vbs" "%NODE%"

:done
rem Возвращаем кодовую страницу, из которой запустили ярлык: иначе 65001
rem осталась бы в консоли и мешала другим программам.
if defined OLDPAGE chcp %OLDPAGE% >nul 2>nul
exit /b
