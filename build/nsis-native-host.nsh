!macro customInstall
  CreateDirectory "$INSTDIR\resources\native"
  StrCpy $1 "$INSTDIR\resources\native\native-messaging-host.cmd"
  StrLen $0 $1
  StrCpy $2 ""
  StrCpy $3 0
loop_escape:
  StrCmp $3 $0 done_escape
  StrCpy $4 $1 1 $3
  StrCmp $4 "\" 0 +2
    StrCpy $2 "$2\\"
    Goto next_escape
  StrCpy $2 "$2$4"
next_escape:
  IntOp $3 $3 + 1
  Goto loop_escape
done_escape:
  FileOpen $0 "$INSTDIR\resources\native\native-messaging-host.json" w
  FileWrite $0 "{$\r$\n"
  FileWrite $0 "  $\"name$\": $\"com.private_video_hub.desktop$\",$\r$\n"
  FileWrite $0 "  $\"description$\": $\"Private Video Hub native messaging host$\",$\r$\n"
  FileWrite $0 "  $\"path$\": $\"$2$\",$\r$\n"
  FileWrite $0 "  $\"type$\": $\"stdio$\",$\r$\n"
  FileWrite $0 "  $\"allowed_origins$\": [$\"chrome-extension://mebceiekeelnkcdibghflcebcpgbegnf/$\"]$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileClose $0

  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.private_video_hub.desktop" "" "$INSTDIR\resources\native\native-messaging-host.json"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.private_video_hub.desktop"
!macroend
