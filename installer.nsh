!include "MUI2.nsh"
!define MUI_FINISHPAGE_SHOWINSTALLED
!define MUI_FINISHPAGE_SHOWNEXTBUTTON

; Customize the NSIS installer header and default install location.
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Header\win.bmp"

InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${PRODUCT_NAME}" "Install_Dir"
