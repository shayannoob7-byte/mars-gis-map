$ErrorActionPreference = 'Stop'
$marsUrl = 'http://127.0.0.1:8765/'
function Test-MarsServer {
    try {
        $response = Invoke-WebRequest -Uri ($marsUrl + '__mars_health') -UseBasicParsing -TimeoutSec 2
        return $response.Content -eq 'mars-gis-local-v1'
    } catch { return $false }
}
try {
    if (-not (Test-MarsServer)) {
        $nodeCommand = Get-Command node -ErrorAction Stop
        $serverPath = Join-Path $PSScriptRoot 'local-server.cjs'
        $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 200
            if (Test-MarsServer) { $ready = $true; break }
            if ($serverProcess.HasExited) { break }
        }
        if (-not $ready) { throw 'Cannot start the Mars preview on port 8765. Another application may be using that port.' }
    }
    Start-Process $marsUrl
} catch {
    Write-Host ('Could not open Mars Globe: ' + $_.Exception.Message) -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
