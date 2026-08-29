@echo off
REM Inicia o backend MusicPlayer
cd /d "%~dp0"
echo Instalando dependencias (se necessario)...
call npm install 2>nul
echo Iniciando backend em http://localhost:4000
echo A janela vai ficar aberta. Nao feche enquanto usar o app.
call npm start
