Get-Process mysqld, qdrant -ErrorAction SilentlyContinue | Stop-Process
Write-Host "Stopped MySQL and Qdrant."
