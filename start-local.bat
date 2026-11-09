@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  echo FPGA Playground: http://localhost:8000/
  echo Keep this window open while using the application.
  start "" "http://localhost:8000/"
  py -3 -m http.server 8000 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  echo FPGA Playground: http://localhost:8000/
  echo Keep this window open while using the application.
  start "" "http://localhost:8000/"
  python -m http.server 8000 --bind 127.0.0.1
  goto :eof
)
echo Python 3 was not found. Install Python 3 and enable the "py" launcher.
pause
