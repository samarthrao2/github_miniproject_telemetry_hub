# Starts the portable MySQL 8.4 and Qdrant binaries in tools/ (no Docker, no install, no admin).
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$envMap = @{}
Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)=(.*)$') { $envMap[$Matches[1]] = $Matches[2] }
}
$mysqlHome = (Get-ChildItem "$root\tools" -Directory -Filter "mysql-*").FullName | Select-Object -First 1
# Data lives outside the project: mysqld fails to start when the datadir path contains spaces.
$data ="$env:USERPROFILE\fleet-hub-db\mysql"
$port = $envMap["MYSQL_PORT"]
$ini = "$env:USERPROFILE\fleet-hub-db\my.ini"

function Test-Port($p) { (Test-NetConnection 127.0.0.1 -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded }

# my.ini avoids command-line quoting problems.
New-Item -ItemType Directory -Force (Split-Path $ini) | Out-Null
$fw ={ param($s) $s -replace '\\', '/' }
@"
[mysqld]
basedir=$(& $fw $mysqlHome)
datadir=$(& $fw $data)
port=$port
bind-address=127.0.0.1
mysqlx=OFF
log-error=$(& $fw $data)/error.log
"@ | Set-Content $ini -Encoding ascii

# ---- MySQL ----
$fresh = $false
if (-not (Test-Path "$data\mysql.ibd")) {
  Write-Host "Initializing MySQL data directory..."
  New-Item -ItemType Directory -Force $data | Out-Null
  Start-Process "$mysqlHome\bin\mysqld.exe" -Wait -WindowStyle Hidden -ArgumentList "--defaults-file=`"$ini`"", "--initialize-insecure"
  $fresh = $true
}
if (-not (Test-Port $port)) {
  Write-Host "Starting MySQL on port $port..."
  Start-Process "$mysqlHome\bin\mysqld.exe" -WindowStyle Hidden -ArgumentList "--defaults-file=`"$ini`""
  for ($i = 0; $i -lt 60 -and -not (Test-Port $port); $i++) { Start-Sleep 1 }
  if (-not (Test-Port $port)) { throw "MySQL did not start; see $data\error.log" }
}
if ($fresh) {
  & "$mysqlHome\bin\mysql.exe" --user=root --host=127.0.0.1 --port=$port -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$($envMap['MYSQL_ROOT_PASSWORD'])';"
}
Write-Host "MySQL ready on 127.0.0.1:$port"

# ---- Qdrant ----
if (-not (Test-Port 6333)) {
  Write-Host "Starting Qdrant on port 6333..."
  $env:QDRANT__STORAGE__STORAGE_PATH = "$root\.qdrant-data\storage"
  $env:QDRANT__STORAGE__SNAPSHOTS_PATH = "$root\.qdrant-data\snapshots"
  Start-Process "$root\tools\qdrant\qdrant.exe" -WindowStyle Hidden -WorkingDirectory "$root\tools\qdrant"
  for ($i = 0; $i -lt 60 -and -not (Test-Port 6333); $i++) { Start-Sleep 1 }
  if (-not (Test-Port 6333)) { throw "Qdrant did not start" }
}
Write-Host "Qdrant ready on http://localhost:6333"

