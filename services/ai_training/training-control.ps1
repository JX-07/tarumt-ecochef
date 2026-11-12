param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "resume", "run", "run-resume", "stop", "status")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [ValidateSet("vision", "detector", "enose", "all")]
    [string]$Target,

    [ValidateSet("accurate-s", "fast-n")]
    [string]$DetectorProfile = "accurate-s",

    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Data = Join-Path $Root "data\processed_v2"
$Runs = Join-Path $Root "runs"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Training environment is missing. Run setup-training.cmd cuda first."
}

$Tasks = if ($Target -eq "all") { @("detector", "vision", "enose") } else { @($Target) }
if ($Target -eq "all" -and $Action -in @("start", "resume")) {
    throw "Start one model at a time. Running both vision models together can exceed the 8 GB GPU memory."
}

function Get-TaskConfig([string]$Name) {
    $RunDirectory = Join-Path $Runs $Name
    switch ($Name) {
        "vision" {
            return @{
                RunDirectory = $RunDirectory
                Script = Join-Path $Root "scripts\train_vision.py"
                Arguments = @("--manifest", (Join-Path $Data "vision_freshness_manifest.csv"), "--run-dir", $RunDirectory)
            }
        }
        "detector" {
            # Keep model profiles separate so checkpoints, optimizer state and metrics
            # cannot be accidentally mixed when switching between N and S.
            $ProfileSettings = switch ($DetectorProfile) {
                "fast-n" {
                    @{
                        RunName = "detector_yolo26n_fast_all_sources"
                        Profile = "fast-n"
                    }
                }
                default {
                    @{
                        RunName = "detector_yolo26s_accurate_all_sources"
                        Profile = "accurate-s"
                    }
                }
            }
            $RunDirectory = Join-Path $Runs $ProfileSettings.RunName
            return @{
                RunDirectory = $RunDirectory
                Script = Join-Path $Root "scripts\train_detector.py"
                Arguments = @(
                    "--data", (Join-Path $Data "ingredient_detection\dataset.yaml"),
                    "--run-dir", $RunDirectory,
                    "--profile", $ProfileSettings.Profile
                )
            }
        }
        "enose" {
            return @{
                RunDirectory = $RunDirectory
                Script = Join-Path $Root "scripts\train_enose.py"
                Arguments = @("--data", (Join-Path $Data "enose_spoilage.csv"), "--run-dir", $RunDirectory)
            }
        }
    }
}

function Read-TaskProcess([hashtable]$Config) {
    $PidFile = Join-Path $Config.RunDirectory "training.pid"
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    $SavedPid = [int](Get-Content -LiteralPath $PidFile -Raw)
    return Get-Process -Id $SavedPid -ErrorAction SilentlyContinue
}

foreach ($Task in $Tasks) {
    $Config = Get-TaskConfig $Task
    $PidFile = Join-Path $Config.RunDirectory "training.pid"
    $StopFile = Join-Path $Config.RunDirectory "STOP"
    $Process = Read-TaskProcess $Config

    if ($Action -eq "status") {
        if ($null -ne $Process) {
            Write-Host "$Task is running (PID $($Process.Id))."
        } elseif (Test-Path -LiteralPath (Join-Path $Config.RunDirectory "checkpoint.pt")) {
            Write-Host "$Task is stopped and has a resumable checkpoint."
        } elseif (Test-Path -LiteralPath (Join-Path $Config.RunDirectory "checkpoint.joblib")) {
            Write-Host "$Task is stopped and has a resumable checkpoint."
        } elseif (Test-Path -LiteralPath (Join-Path $Config.RunDirectory "resume.pt")) {
            Write-Host "$Task is stopped and has a resumable checkpoint."
        } elseif (Test-Path -LiteralPath (Join-Path $Config.RunDirectory "train\weights\last.pt")) {
            Write-Host "$Task is stopped and has trained weights. Older checkpoints may warm-start rather than restore optimizer state."
        } else {
            Write-Host "$Task has not started."
        }
        continue
    }

    if ($Action -eq "stop") {
        if ($null -eq $Process) {
            Write-Host "$Task is not running."
            continue
        }
        New-Item -ItemType File -Path $StopFile -Force | Out-Null
        Write-Host "Safe stop requested for $Task (PID $($Process.Id)). It will save after the current epoch."
        if ($Force) {
            Stop-Process -Id $Process.Id -Force
            Write-Host "$Task was force-stopped. Its last completed checkpoint remains available."
        }
        continue
    }

    if ($null -ne $Process) {
        Write-Host "$Task is already running (PID $($Process.Id))."
        continue
    }
    if (-not (Test-Path -LiteralPath $Data)) {
        throw "Cleaned data is missing. Run prepare-datasets.cmd first."
    }
    New-Item -ItemType Directory -Path $Config.RunDirectory -Force | Out-Null
    Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue
    $Arguments = @($Config.Script) + $Config.Arguments
    if ($Action -in @("resume", "run-resume")) { $Arguments += "--resume" }

    if ($Action -in @("run", "run-resume")) {
        Write-Host "Running $Task in this window. Live progress follows."
        # Invoke directly so this shell waits on the real trainer. The Python script writes
        # its own PID, allowing a second terminal to issue a reliable safe-stop request.
        & $Python @Arguments
        $CommandSucceeded = $?
        $ExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($CommandSucceeded) { 0 } else { 1 }
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        if ($ExitCode -ne 0) {
            throw "$Task training failed with exit code $ExitCode."
        }
        if (Test-Path -LiteralPath $StopFile) {
            Write-Host "$Task stopped safely after saving its latest checkpoint. Sequential training will not start the next model."
            break
        }
        Write-Host "$Task training completed successfully."
        continue
    }

    $StdOut = Join-Path $Config.RunDirectory "training.log"
    $StdErr = Join-Path $Config.RunDirectory "training-error.log"
    $Started = Start-Process -FilePath $Python -ArgumentList $Arguments -WorkingDirectory $Root -RedirectStandardOutput $StdOut -RedirectStandardError $StdErr -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $PidFile -Value $Started.Id
    Write-Host "$Task training started (PID $($Started.Id)). Log: $StdOut"
}
