# Tenant install helper for the Teams Agent Audio Join connector.
# Does not call Graph. Prints the Entra/Teams steps and writes a .env skeleton.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function New-EncryptionKey {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes)
}

$key = New-EncryptionKey
$envPath = Join-Path $root ".env"
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $root ".env.example") $envPath
  Write-Host "Created .env from .env.example"
}

$raw = Get-Content $envPath -Raw
if ($raw -notmatch '(?m)^ARTIFACT_ENCRYPTION_KEY=.+$' -or $raw -match '(?m)^ARTIFACT_ENCRYPTION_KEY=\s*$') {
  $raw = $raw -replace '(?m)^ARTIFACT_ENCRYPTION_KEY=.*$', "ARTIFACT_ENCRYPTION_KEY=$key"
  if ($raw -notmatch 'ARTIFACT_ENCRYPTION_KEY=') {
    $raw += "`nARTIFACT_ENCRYPTION_KEY=$key`n"
  }
  Set-Content -Path $envPath -Value $raw -NoNewline
  Write-Host "Wrote ARTIFACT_ENCRYPTION_KEY to .env"
} else {
  Write-Host ".env already has ARTIFACT_ENCRYPTION_KEY (left unchanged)"
}

Write-Host @"

Next (one Entra app, one Teams manifest — talking assistant):

1. Entra ID > App registrations > New > teams-audio-join-connector
2. Certificates & secrets > new client secret. Put it in .env as AZURE_CLIENT_SECRET.
   AZURE_TENANT_ID, AZURE_CLIENT_ID, GRAPH_USER_ID (object id of the connecting mailbox)
3. Application permissions + admin consent:
     OnlineMeetings.Read.All
     OnlineMeetingTranscript.Read.All
     Calls.JoinGroupCall.All
     Calls.AccessMedia.All
4. Application access policy (this is the step that looks like meeting_not_found if skipped):

   New-CsApplicationAccessPolicy -Identity teams-audio-join-policy -AppIds '<APP_ID>'
   Grant-CsApplicationAccessPolicy -PolicyName teams-audio-join-policy -Identity '<USER_OBJECT_ID>'

5. Sideload deploy/teams-app/manifest.json (supportsCalling=true, supportsVideo=true).
   Replace {{APP_ID}} and {{BOT_ID}} with the same app id.

6. Media worker (attendees hear the bot only if this is up and CALLBACK_URI is public HTTPS):
   dotnet run --project services/media-worker --urls http://127.0.0.1:7071
   MEDIA_WORKER_URL=http://127.0.0.1:7071 in .env

7. npm install
   npm run doctor

mode=fixture-loopback means Teams attendees cannot hear the bot yet.
mode=graph-notes-only means Graph works but MEDIA_WORKER_URL is missing.
"@
