@echo off
echo ========================================
echo   Servidor HTTP Local - Sistema Caldeira
echo ========================================
echo.
echo Iniciando servidor na porta 8000...
echo.
echo Acesse o sistema em: http://localhost:8000
echo.
echo Pressione Ctrl+C para parar o servidor
echo ========================================
echo.

cd /d "%~dp0"
python -m http.server 8000
