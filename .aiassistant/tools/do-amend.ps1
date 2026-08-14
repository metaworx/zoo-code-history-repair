# do-amend.ps1
# Amends the last commit using the message in .aiassistant/tools/commit-msg.txt.
# Usage: powershell -File .aiassistant/tools/do-amend.ps1
$msgFile = Join-Path $PSScriptRoot "commit-msg.txt"
git commit --amend -F $msgFile --trailer "Co-authored-by: Junie <junie@jetbrains.com>"
