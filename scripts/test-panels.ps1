$base = "http://localhost:4000/api/v1"
$web = "http://localhost:3002"
$headers = @{ "X-Tenant-ID" = "default"; "Content-Type" = "application/json" }

function Login($email, $password) {
  $body = @{ email = $email; password = $password; deviceFingerprint = "test-runner" } | ConvertTo-Json
  return (Invoke-RestMethod -Uri "$base/auth/login" -Method POST -Headers $headers -Body $body).data
}

function Test-Api($label, $token, $method, $path, $expectOk = $true) {
  $h = $headers.Clone()
  $h["Authorization"] = "Bearer $token"
  try {
    $params = @{ Uri = "$base$path"; Headers = $h; UseBasicParsing = $true }
    if ($path -notmatch '\?') { $params.Uri = "$base$path" + "?page=1&limit=20" }
    if ($method -ne "GET") { $params.Method = $method }
    $res = Invoke-WebRequest @params
    $ok = $res.StatusCode -ge 200 -and $res.StatusCode -lt 300
    if ($expectOk -eq $ok) { return [pscustomobject]@{ Test = $label; Result = "PASS"; Detail = $res.StatusCode } }
    return [pscustomobject]@{ Test = $label; Result = "FAIL"; Detail = "expected ok=$expectOk got $($res.StatusCode)" }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if (-not $expectOk) { return [pscustomobject]@{ Test = $label; Result = "PASS"; Detail = "blocked $code" } }
    return [pscustomobject]@{ Test = $label; Result = "FAIL"; Detail = "error $code" }
  }
}

function Test-Redirect($label, $roles, $path, $expectedLocation) {
  $body = @{ roles = $roles } | ConvertTo-Json
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-WebRequest -Uri "$web/api/auth/session" -Method POST -Body $body -ContentType "application/json" -WebSession $sess -UseBasicParsing | Out-Null
  $final = Invoke-WebRequest -Uri "$web$path" -WebSession $sess -MaximumRedirection 5 -UseBasicParsing
  $finalPath = ([uri]$final.BaseResponse.ResponseUri).AbsolutePath
  if ($finalPath -eq $expectedLocation) { return [pscustomobject]@{ Test = $label; Result = "PASS"; Detail = "-> $finalPath" } }
  return [pscustomobject]@{ Test = $label; Result = "FAIL"; Detail = "-> $finalPath expected $expectedLocation" }
}

$results = @()

Write-Host "`n=== ADMIN ===" -ForegroundColor Cyan
$admin = Login "admin@cbt-platform.com" "Admin@123"
$results += [pscustomobject]@{ Test = "Admin roles"; Result = ($(if ($admin.user.roles -contains 'SUPER_ADMIN' -or $admin.user.roles -contains 'ORG_ADMIN') {'PASS'} else {'FAIL'})); Detail = ($admin.user.roles -join ', ') }
$at = $admin.accessToken
$results += Test-Api "Admin dashboard" $at GET "/analytics/dashboard"
$results += Test-Api "Admin users" $at GET "/users"
$results += Test-Api "Admin exams" $at GET "/exams"
$results += Test-Api "Admin candidates" $at GET "/candidates"
$results += Test-Api "Admin questions" $at GET "/questions"
$results += Test-Api "Admin blocked from my-exams API" $at GET "/exams/my/available" $false

Write-Host "`n=== CANDIDATE ===" -ForegroundColor Cyan
$cand = Login "candidate@example.com" "Candidate@123"
$staff = @('SUPER_ADMIN','ORG_ADMIN','EXAM_MANAGER','QUESTION_MODERATOR','PROCTOR','EVALUATOR','AUDITOR')
$hasStaff = @($cand.user.roles | Where-Object { $staff -contains $_ })
$results += [pscustomobject]@{ Test = "Candidate pure role"; Result = ($(if ($cand.user.roles -contains 'CANDIDATE' -and -not $hasStaff) {'PASS'} else {'FAIL'})); Detail = ($cand.user.roles -join ', ') }
$ct = $cand.accessToken
$results += Test-Api "Candidate my-exams API" $ct GET "/exams/my/available"
$results += Test-Api "Candidate my-results API" $ct GET "/results/my"
$results += Test-Api "Candidate blocked dashboard API" $ct GET "/analytics/dashboard" $false
$results += Test-Api "Candidate blocked users API" $ct GET "/users" $false

Write-Host "`n=== WEB ROUTING ===" -ForegroundColor Cyan
$results += Test-Redirect "Candidate /dashboard -> my-exams" @("CANDIDATE") "/dashboard" "/my-exams"
$results += Test-Redirect "Admin /my-exams -> dashboard" @("SUPER_ADMIN") "/my-exams" "/dashboard"

$results | Format-Table -AutoSize
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' })
Write-Host "`nSummary: $($results.Count - $failed.Count)/$($results.Count) passed" -ForegroundColor $(if ($failed.Count -eq 0) {'Green'} else {'Yellow'})
if ($failed.Count -gt 0) { $failed | Format-Table -AutoSize }
