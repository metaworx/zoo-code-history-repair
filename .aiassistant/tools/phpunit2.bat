@ECHO OFF
setlocal ENABLEDELAYEDEXPANSION

SET BIN_TARGET=%~dp0/phpunit
SET COMPOSER_RUNTIME_BIN_DIR=%~dp0

:: Variables to hold parsed Xdebug settings
SET "XDEBUG_MODE="
SET "XDEBUG_CLIENT_PORT="
SET "XDEBUG_CLIENT_HOST="
SET "XDEBUG_OTHERS="
SET "ARGS="

:: Process all arguments, preserving original quoting
CALL :parse %*
GOTO :run

:parse
IF "%~1"=="" GOTO :EOF
SET "arg=%~1"

:: Handle bare --xdebug / -xdebug (sets all three defaults)
IF /I "!arg!"=="--xdebug" GOTO :setDefaults
IF /I "!arg!"=="-xdebug"  GOTO :setDefaults

:: Handle --xdebug.key=value / -xdebug.key=value
ECHO !arg! | FINDSTR /R /C:"^-\{1,2\}xdebug\.[^=][^=]*=.*" >NUL
IF NOT ERRORLEVEL 1 (
    FOR /F "TOKENS=1,2 DELIMS==" %%A IN ("!arg!") DO (
        SET "opt=%%A"
        SET "val=%%B"
        :: Remove leading dashes and "xdebug." prefix to get the key
        SET "key=!opt:-=!"
        SET "key=!key:xdebug.=!"

        :: Assign to the appropriate variable or append to "other" options
        IF /I "!key!"=="mode"        SET "XDEBUG_MODE=!val!"
        IF /I "!key!"=="client_port" SET "XDEBUG_CLIENT_PORT=!val!"
        IF /I "!key!"=="client_host" SET "XDEBUG_CLIENT_HOST=!val!"
        IF NOT "!key!"=="mode" IF NOT "!key!"=="client_port" IF NOT "!key!"=="client_host" (
            IF DEFINED XDEBUG_OTHERS (
                SET "XDEBUG_OTHERS=!XDEBUG_OTHERS! -dxdebug.!key!=!val!"
            ) ELSE (
                SET "XDEBUG_OTHERS=-dxdebug.!key!=!val!"
            )
        )
    )
    SHIFT
    GOTO :parse
)

:: Not an Xdebug argument – keep it (with original quoting)
SET "ARGS=!ARGS! %1"
SHIFT
GOTO :parse

:setDefaults
SET "XDEBUG_MODE=debug"
SET "XDEBUG_CLIENT_PORT=9000"
SET "XDEBUG_CLIENT_HOST=127.0.0.1"
SHIFT
GOTO :parse

:run
:: Build the -d options string
SET "XDEBUG_OPTS="
IF DEFINED XDEBUG_MODE        SET "XDEBUG_OPTS=!XDEBUG_OPTS! -dxdebug.mode=!XDEBUG_MODE!"
IF DEFINED XDEBUG_CLIENT_PORT SET "XDEBUG_OPTS=!XDEBUG_OPTS! -dxdebug.client_port=!XDEBUG_CLIENT_PORT!"
IF DEFINED XDEBUG_CLIENT_HOST SET "XDEBUG_OPTS=!XDEBUG_OPTS! -dxdebug.client_host=!XDEBUG_CLIENT_HOST!"
IF DEFINED XDEBUG_OTHERS      SET "XDEBUG_OPTS=!XDEBUG_OPTS! !XDEBUG_OTHERS!"

:: Execute PHPUnit with the extracted options and the remaining arguments
echo php !XDEBUG_OPTS! "%BIN_TARGET%"!ARGS!
php !XDEBUG_OPTS! "%BIN_TARGET%"!ARGS!