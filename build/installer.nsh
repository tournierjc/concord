; build/installer.nsh — greffon NSIS d'electron-builder (inclus via electron-builder.yml).
;
; Pare-feu Windows (2026-11-02, retour JC : « aucune réponse » au join — le pare-feu Windows
; jette les paquets entrants de Concord tant que personne n'a dit oui à la fenêtre système,
; et la fenêtre n'apparaît pas toujours pour un exécutable non signé lancé depuis %LOCALAPPDATA%).
;
; Deux règles PAR PROGRAMME (pas par port) : une règle « autoriser concord.exe » couvre à la
; fois la signalisation TCP (47821-47830) et la découverte mDNS UDP 5353 — tout ce que l'exe
; écoute. Best effort : `netsh advfirewall` exige des droits administrateur ; lancé par un
; installeur per-user sans élévation, il échoue SILENCIEUSEMENT (code non nul, ignoré) et
; Windows proposera sa propre fenêtre d'autorisation au premier écoute — l'app n'est pas pire
; qu'avant, elle gagne une règle quand l'installeur a tourné élevé.
; Le nom des règles est fixe et versionné « Concord » : la désinstallation les retire
; (`un.customInstall`), la mise à jour les écrase (add rule écrase une règle du même nom).

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Concord (voix et découverte)" dir=in action=allow program="$INSTDIR\concord.exe" enable=yes profile=any'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Concord (voix et découverte)"'
  Pop $0
!macroend
