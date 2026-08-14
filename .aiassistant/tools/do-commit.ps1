# do-commit.ps1
# Commits staged changes using the message in .aiassistant/tools/commit-msg.txt.
# Usage: powershell -File .aiassistant/tools/do-commit.ps1
$msgFile = Join-Path $PSScriptRoot "commit-msg.txt"
git commit -F $msgFile --trailer "Co-authored-by: Junie <junie@jetbrains.com>"
