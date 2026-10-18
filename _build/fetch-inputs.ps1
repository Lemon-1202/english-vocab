# 下载词库构建用的原始数据（约 180MB，只需跑一次）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 1. 教材词书（分级依据）
$base1 = 'https://raw.githubusercontent.com/LinXueyuanStdio/DictionaryData/master/'
foreach ($f in @('book.csv', 'word.csv', 'word_translation.csv', 'relation_book_word.zip')) {
  if (Test-Path $f) { Write-Host "skip  $f"; continue }
  Write-Host "fetch $f ..."
  Invoke-WebRequest -Uri ($base1 + $f) -OutFile $f -UseBasicParsing
}

# 解压关系表
if (Test-Path 'relation_book_word.zip') {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path 'relation_book_word.zip'))
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($zip.Entries[0], (Join-Path $PWD 'relation_book_word.csv'), $true)
  $zip.Dispose()
}

# 2. ECDICT 词典（音标 + 中文释义）
if (-not (Test-Path 'ecdict.csv')) {
  Write-Host 'fetch ecdict.csv (62MB) ...'
  Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv' -OutFile 'ecdict.csv' -UseBasicParsing
}

Write-Host 'done. 现在运行: node build-bank.mjs'
