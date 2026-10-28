; ponytail: Tauri's NSIS template bakes ${PRODUCTNAME} ("MD좋아") into the
; installer at build time — it can't itself vary by install language. This
; hook patches the visible post-install surfaces to "MDjoa" when the install
; language isn't Korean:
;  - Add/Remove Programs entry + default Start Menu shortcut (POSTINSTALL,
;    runs during the install Section — ${PRODUCTNAME} etc. resolve fine here
;    since !insertmacro is deferred to its call site, which comes after
;    Tauri's own !define block further down the generated script).
;  - The optional desktop shortcut from the finish-page "바탕화면에 바로가기"
;    checkbox, which a template Function creates *after* POSTINSTALL already
;    ran. .onGUIEnd fires once the installer window is about to close — late
;    enough to catch it. But .onGUIEnd is a bare Function in this early-
;    !include'd file, so ${PRODUCTNAME}-style defines aren't resolved yet at
;    this point in the script (verified with a standalone makensis compile —
;    referencing them here silently produces the literal text "{PRODUCTNAME}"
;    instead of an error). Stash them into plain variables from the deferred
;    macro above and read the variables here instead.
; Not covered: shortcut recreation on upgrade installs (the template skips
; it in update mode), and the desktop shortcut's AppUserModelId (needs
; ${BUNDLEID}, which has the same early-resolution problem — skipped rather
; than duplicating SetLnkAppUserModelId's COM logic against a stashed var).
; Full coverage needs a custom .nsi template (bundle.windows.nsis.template)
; instead of installerHooks. NEEDS VERIFICATION ON AN ACTUAL WINDOWS INSTALL —
; this was only checked with a standalone `makensis` compile, not a live run.
Var MdjoaProductName
Var MdjoaMainBinaryName

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $MdjoaProductName "${PRODUCTNAME}"
  StrCpy $MdjoaMainBinaryName "${MAINBINARYNAME}"
  ${If} $LANGUAGE != ${LANG_KOREAN}
    WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "MDjoa"
    ${If} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      CreateShortcut "$SMPROGRAMS\MDjoa.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\MDjoa.lnk"
    ${EndIf}
  ${EndIf}

  ; Windows won't let an installer silently take over .md (UserChoice is
  ; hash-protected), so just offer to open the OS "Default apps" page. Skipped
  ; for silent (/S) and passive (/P, used by the auto-updater) installs.
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    ${If} $LANGUAGE == ${LANG_KOREAN}
      MessageBox MB_YESNO|MB_ICONQUESTION "MD좋아를 .md 문서의 기본 앱으로 설정하시겠습니까?$\n(Windows 기본 앱 설정 화면이 열립니다)" IDNO mdjoa_skip_default
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION "Set MDjoa as the default app for .md files?$\n(Opens the Windows Default apps settings)" IDNO mdjoa_skip_default
    ${EndIf}
    ExecShell "open" "ms-settings:defaultapps"
    mdjoa_skip_default:
  ${EndIf}
!macroend

; 앱이 기본 앱 설정 페이지용으로 HKCU 에 등록한 정보(default_app.rs
; register_capabilities)를 제거한다. 설치 모드가 currentUser 라 HKCU 와 일치.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\RegisteredApplications" "MDjoa"
  DeleteRegKey HKCU "Software\MDjoa"
!macroend

; 1042 = Windows LCID for Korean (NSIS's ${LANG_KOREAN}, not yet defined
; at this point in the file — see note above).
Function .onGUIEnd
  ${If} $LANGUAGE != 1042
    ${If} ${FileExists} "$DESKTOP\$MdjoaProductName.lnk"
      Delete "$DESKTOP\$MdjoaProductName.lnk"
      CreateShortcut "$DESKTOP\MDjoa.lnk" "$INSTDIR\$MdjoaMainBinaryName.exe"
    ${EndIf}
  ${EndIf}
FunctionEnd
