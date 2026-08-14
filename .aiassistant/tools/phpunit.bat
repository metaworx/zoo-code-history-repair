@ECHO OFF
setlocal ENABLEDELAYEDEXPANSION

SET "BIN_TARGET=%~dp0/phpunit"

SET "PHP_OPTS="
SET "ARGS="

:parse
IF "%~1"=="" GOTO :run

SET "arg=%~1"

:: keep for PHPUnit (DISABLE IF YOU DO NOT WANT TO PASS IT TO PHPUnit, ENABLE BELOW INSTEAD)
SET "ARGS=!ARGS! %1"

:: Bare --xdebug / -xdebug → inject defaults
IF /I "!arg!"=="--xdebug" GOTO :xdebug_defaults

:: Any -dxdebug option → add as PHP option
IF /I "!arg:~0,9!"=="-dxdebug." (
    SET "PHP_OPTS=!PHP_OPTS! !arg!"
    SHIFT
    GOTO :parse
)

:: Everything else → keep for PHPUnit
:: ENABLE IF YOU DISABLED ABOVE:: SET "ARGS=!ARGS! %1"
SHIFT
GOTO :parse

:xdebug_defaults
SET "PHP_OPTS=!PHP_OPTS! -dxdebug.mode=debug -dxdebug.client_port=9000 -dxdebug.client_host=127.0.0.1 -dxdebug.start_with_request=yes"
SHIFT
GOTO :parse

:run
echo.
echo php !PHP_OPTS! "%BIN_TARGET%"!ARGS!
echo.
php !PHP_OPTS! "%BIN_TARGET%"!ARGS!
