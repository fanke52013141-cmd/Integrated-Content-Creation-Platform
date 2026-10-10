param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [Parameter(Mandatory = $true)][string]$PromptPath,
  [string]$EditScreenId
)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$metadataPath = Join-Path $workspace '.stitch/metadata.json'
$metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding utf8 | ConvertFrom-Json
$connection = codex.cmd mcp get stitch --json | ConvertFrom-Json
$headers = @{ 'X-Goog-Api-Key' = $connection.transport.http_headers.'X-Goog-Api-Key'; Accept = 'application/json, text/event-stream' }
$prompt = Get-Content -LiteralPath $PromptPath -Raw -Encoding utf8
$arguments = @{ projectId = $metadata.projectId; designSystem = $metadata.designSystem; deviceType = 'DESKTOP'; modelId = 'GEMINI_3_5_FLASH_LITE'; prompt = $prompt }
$toolName = 'generate_screen_from_text'
if ($EditScreenId) {
  $toolName = 'edit_screens'
  $arguments.Remove('designSystem')
  $arguments.selectedScreenIds = @($EditScreenId)
}
$body = @{ jsonrpc = '2.0'; id = 1; method = 'tools/call'; params = @{ name = $toolName; arguments = $arguments } } | ConvertTo-Json -Depth 30 -Compress
$result = Invoke-RestMethod -Uri $connection.transport.url -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 240
if ($result.error -or $result.result.isError) { throw 'Stitch generation failed; inspect the service response without exposing credentials.' }
$data = if ($result.result.structuredContent) { $result.result.structuredContent } else { $result.result.content[0].text | ConvertFrom-Json }
$directory = Join-Path $workspace '.stitch/designs'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$data | ConvertTo-Json -Depth 60 | Set-Content -LiteralPath (Join-Path $directory "$Slug-response.json") -Encoding utf8
$screenIndex = 0
foreach ($component in $data.outputComponents) {
  if ($component.text) { Write-Output $component.text }
  if ($component.suggestion) { $component.suggestion | ConvertTo-Json -Depth 8 }
  foreach ($screen in $component.design.screens) {
    $assetSlug = if ($screenIndex -eq 0) { $Slug } else { "$Slug-$screenIndex" }
    $screenIndex++
    $htmlPath = Join-Path $directory "$assetSlug.html"
    $imagePath = Join-Path $directory "$assetSlug.png"
    Invoke-WebRequest -Uri $screen.htmlCode.downloadUrl -OutFile $htmlPath
    Invoke-WebRequest -Uri $screen.screenshot.downloadUrl -OutFile $imagePath
    $metadata.screens = @($metadata.screens | Where-Object { $_.name -ne $screen.name }) + @(@{ name = $screen.name; title = $screen.title; html = "designs/$assetSlug.html"; screenshot = "designs/$assetSlug.png" })
    $metadata | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $metadataPath -Encoding utf8
    Write-Output "Saved $($screen.name): $($screen.title)"
  }
}
if ($screenIndex -eq 0) { throw 'Stitch returned no screens; the saved response is available for inspection.' }
