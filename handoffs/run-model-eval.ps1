$configPath = (& 'C:\Users\ZhuanZ\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe' config path | Select-Object -Last 1).Trim()
$configText = Get-Content -LiteralPath $configPath -Raw
$match = [regex]::Match($configText, '(?m)^\s*api_key:\s*["'']?([^\s"'']+)')
if (-not $match.Success) { throw 'Configured API key was not found.' }
$headers = @{ Authorization = ('Bearer ' + $match.Groups[1].Value); 'Content-Type' = 'application/json' }
$prompt = 'Return JSON only. Review this JavaScript: schema has additionalProperties false, required [plan], properties only request_id; execute uses Date.parse(expires_at) < Date.now(), returns EXECUTION_DISABLED when intent_ref lacks ://, otherwise echoes evidence_refs. List all and only concrete fail-closed/security/schema defects, each with issue, why, minimal_fix, and one regression test.'
$results = foreach ($model in @('meta/muse-spark-1.3-contributor', 'deepseek/deepseek-v4-pro')) {
  try {
    $body = @{ model = $model; messages = @(@{ role = 'user'; content = $prompt }); temperature = 0; max_tokens = 8192 } | ConvertTo-Json -Depth 8
    $response = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/chat/completions' -Method Post -Headers $headers -Body $body -TimeoutSec 180
    [pscustomobject]@{ model = $model; ok = $true; content = $response.choices[0].message.content; usage = $response.usage }
  } catch {
    [pscustomobject]@{ model = $model; ok = $false; error_type = $_.Exception.GetType().Name; error = $_.Exception.Message }
  }
}
$results | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'D:\uking编程\task-passport\handoffs\model-eval-results.json' -Encoding utf8
