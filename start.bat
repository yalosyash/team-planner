@echo off
setlocal
cd /d "%~dp0"

rem Ярлык с иконкой рядом с папкой: у .bat своей иконки в Windows нет.
rem Скрипт сам выходит, если ярлык уже есть, и ничего не ломает, если
rem Windows запрещает .vbs - тогда просто запустится start.bat.
start "" wscript.exe //nologo "%~dp0create-shortcut.vbs"

for /f "delims=" %%N in ('where node 2^>nul') do (
  set "NODE=%%N"
  goto :have_node
)

echo Node.js не найден. Открываю приложение без автосохранения в файл.
echo Данные будут храниться в браузере, используйте кнопки Экспорт/Импорт.
echo.
start "" "%~dp0app\index.html"
timeout /t 3 >nul
exit /b

:have_node
rem Запуск без консольного окна. Сервер работает в фоне и сам выключается,
rem когда закрыта последняя вкладка планировщика (см. app/js/keepalive.js).
rem Если сервер уже запущен, второй не поднимается - просто откроется браузер.
start "" wscript.exe //nologo "%~dp0start-hidden.vbs" "%NODE%"
exit /b
