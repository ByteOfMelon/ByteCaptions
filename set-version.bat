@echo off
rem Sets the app version in every file that stores it. Usage: set-version 1.0.0
cd /d "%~dp0" && node scripts\set-version.mjs %*
