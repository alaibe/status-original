!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$bin = \"$INSTDIR\bin\"; $$path = [Environment]::GetEnvironmentVariable(\"Path\", \"User\"); if (-not (($$path -split \";\") -contains $$bin)) { [Environment]::SetEnvironmentVariable(\"Path\", (($$path.TrimEnd(\";\"), $$bin) -join \";\").TrimStart(\";\"), \"User\") }"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$bin = \"$INSTDIR\bin\"; $$path = [Environment]::GetEnvironmentVariable(\"Path\", \"User\"); [Environment]::SetEnvironmentVariable(\"Path\", (($$path -split \";\") | Where-Object { $$_ -and $$_ -ne $$bin }) -join \";\", \"User\")"'
!macroend
