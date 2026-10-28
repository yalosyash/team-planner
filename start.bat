@echo off
setlocal
title Планировщик загрузки команды
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Открываю приложение без автосохранения в файл.
  echo Данные будут храниться в браузере, используйте кнопки Экспорт/Импорт.
  echo.
  start "" "%~dp0index.html"
  timeout /t 3 >nul
  exit /b
)

node "%~dp0server.js"
