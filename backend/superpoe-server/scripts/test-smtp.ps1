[CmdletBinding()]
param(
    [string]$SmtpHost = 'smtp-mail.outlook.com',
    [int]$Port = 587,
    [Parameter(Mandatory = $true)]
    [string]$From,
    [Parameter(Mandatory = $true)]
    [string]$To,
    [string]$Username
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Username)) {
    $Username = $From
}

Write-Host ("Checking {0}:{1} ..." -f $SmtpHost, $Port)
if (Get-Command Test-NetConnection -ErrorAction SilentlyContinue) {
    $connection = Test-NetConnection -ComputerName $SmtpHost -Port $Port -WarningAction SilentlyContinue
    if (-not $connection.TcpTestSucceeded) {
        throw ("TCP connection to {0}:{1} failed." -f $SmtpHost, $Port)
    }
}

$password = Read-Host 'SMTP application password' -AsSecureString
$credential = New-Object System.Net.NetworkCredential($Username, $password)
$client = New-Object System.Net.Mail.SmtpClient($SmtpHost, $Port)
$message = New-Object System.Net.Mail.MailMessage

try {
    $client.EnableSsl = $true
    $client.UseDefaultCredentials = $false
    $client.Credentials = $credential

    $message.From = New-Object System.Net.Mail.MailAddress($From)
    $message.To.Add((New-Object System.Net.Mail.MailAddress($To)))
    $message.Subject = 'SuperPoE SMTP test'
    $message.Body = "This is a SuperPoE SMTP test message.`r`n`r`nIf you received it, SMTP authentication and STARTTLS are working."
    $message.IsBodyHtml = $false

    $client.Send($message)
    Write-Host 'SMTP test message sent successfully.' -ForegroundColor Green
}
catch {
    Write-Error ("SMTP test failed: {0}" -f $_.Exception.Message)
    if ($_.Exception.InnerException) {
        Write-Error ("Details: {0}" -f $_.Exception.InnerException.Message)
    }
    exit 1
}
finally {
    $message.Dispose()
    $client.Dispose()
}
