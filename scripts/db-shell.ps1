# Opens the MySQL command-line client against the project database.
#   npm run db:shell                                   interactive, as root
#   npm run db:shell -- -Query "SHOW TRIGGERS"         run one statement and exit
#   npm run db:shell -- -File changes.sql              run a .sql file (DELIMITER is supported)
#   npm run db:shell -- -Role viewer                   connect as the read-only fleet_viewer account
param(
  [string]$Query,
  [string]$File,
  [ValidateSet("root", "admin", "viewer")][string]$Role = "root"
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$envMap = @{}
Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)=(.*)$') { $envMap[$Matches[1]] = $Matches[2] }
}
$mysql = (Get-ChildItem "$root\tools" -Directory -Filter "mysql-*" | Select-Object -First 1).FullName + "\bin\mysql.exe"

switch ($Role) {
  "root"   { $user = "root";                    $pw = $envMap["MYSQL_ROOT_PASSWORD"] }
  "admin"  { $user = $envMap["DB_ADMIN_USER"];  $pw = $envMap["DB_ADMIN_PASSWORD"] }
  "viewer" { $user = $envMap["DB_VIEWER_USER"]; $pw = $envMap["DB_VIEWER_PASSWORD"] }
}
$env:MYSQL_PWD = $pw   # keeps the password off the command line
$common = @("--host=127.0.0.1", "--port=$($envMap['MYSQL_PORT'])", "--user=$user", "--default-character-set=utf8mb4", $envMap["MYSQL_DATABASE"])

if ($File) {
  Get-Content -Raw $File | & $mysql @common
} elseif ($Query) {
  & $mysql @common --table "--execute=$Query"
} else {
  & $mysql @common
}
