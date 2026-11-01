#!/usr/bin/env python3
"""build_deb.py — construit un .deb Concord sans fpm (fpm embarque un ruby x86_64
non exécutable sur ce conteneur aarch64). dpkg-deb natif, contenu strictement
identique à ce que produit electron-builder pour une cible deb :
  /opt/Concord/**                      (linux-unpacked)
  /usr/share/icons/hicolor/0x0/apps/concord.png
  /usr/share/applications/concord.desktop
  DEBIAN/control + postinst + prerm (mêmes scripts que le gabarit electron-builder)
Usage: build_deb.py <linux-unpacked> <out.deb> <version>
"""
import os, sys, subprocess, shutil, textwrap, hashlib

unpacked, out, version = sys.argv[1], sys.argv[2], sys.argv[3]
stage = out + ".stage"
if os.path.exists(stage):
    shutil.rmtree(stage)

def install(src, dst):
    d = os.path.join(stage, os.path.dirname(dst))
    os.makedirs(d, exist_ok=True)
    if os.path.isdir(src):
        shutil.copytree(src, dst_root(dst), dirs_exist_ok=True)
    else:
        shutil.copy2(src, os.path.join(stage, dst.lstrip("/")))

def dst_root(dst):
    return os.path.join(stage, dst.lstrip("/").removeprefix("opt/Concord")) if dst.startswith("/opt/Concord") else os.path.join(stage, dst.lstrip("/"))

# 1. /opt/Concord  (comme electron-builder : le contenu de linux-unpacked sous /opt/<productName>)
os.makedirs(os.path.join(stage, "opt/Concord"), exist_ok=True)
shutil.copytree(unpacked, os.path.join(stage, "opt/Concord"), dirs_exist_ok=True)

# 2. icône (le yml n'a pas de taille fixe ; 0x0 est ce que fpm recevait d'electron-builder)
os.makedirs(os.path.join(stage, "usr/share/icons/hicolor/0x0/apps"), exist_ok=True)
shutil.copy2("build/icon.png", os.path.join(stage, "usr/share/icons/hicolor/0x0/apps/concord.png"))

# 3. .desktop (champ desktop.entry du yml, executableName concord)
desktop = textwrap.dedent("""\
    [Desktop Entry]
    Name=Concord
    Comment=Chat vocal sur réseau local
    Exec=/opt/Concord/concord %U
    Terminal=false
    Type=Application
    Icon=concord
    Categories=AudioVideo;Network;
    StartupWMClass=concord
    MimeType=x-scheme-handler/concord;
    """)
os.makedirs(os.path.join(stage, "usr/share/applications"), exist_ok=True)
with open(os.path.join(stage, "usr/share/applications/concord.desktop"), "w") as f:
    f.write(desktop)

# 4. scripts de maintenance — reproduction des scripts de postinst/prerm du gabarit deb
#    d'electron-builder (update-desktop-database + update-icon-caches, conditionnels).
os.makedirs(os.path.join(stage, "DEBIAN"), exist_ok=True)
postinst = textwrap.dedent("""\
    #!/bin/sh
    set -e
    if [ -x /usr/bin/update-desktop-database ]; then
      /usr/bin/update-desktop-database -q usr/share/applications >/dev/null 2>&1 || true
    fi
    if [ -e usr/share/icons/hicolor/icon-theme.cache ]; then
      if [ -x /usr/bin/gtk-update-icon-cache ]; then
        /usr/bin/gtk-update-icon-cache -f usr/share/icons/hicolor >/dev/null 2>&1 || true
      fi
    fi
    exit 0
    """)
prerm = textwrap.dedent("""\
    #!/bin/sh
    set -e
    exit 0
    """)
for name, body, mode in (("postinst", postinst, 0o755), ("prerm", prerm, 0o755)):
    p = os.path.join(stage, "DEBIAN", name)
    with open(p, "w") as f:
        f.write(body)
    os.chmod(p, mode)

depends = "libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0"
size_kb = subprocess.run(["du", "-sk", stage], capture_output=True, text=True).stdout.split()[0]
control = f"""Package: concord
Version: {version}
Architecture: amd64
Maintainer: Concord <maintainers@concord.local>
Installed-Size: {size_kb}
Priority: optional
Section: AudioVideo
Depends: {depends}
Recommends: libappindicator3-1
Homepage: https://github.com/tournierjc/concord
Description: Chat vocal sur réseau local, sans compte et sans cloud
 Salon vocal pour un groupe sur le même réseau local. Aucune donnée ne quitte le
 LAN : pas de compte, pas de télémétrie, pas de mise à jour automatique.
"""
with open(os.path.join(stage, "DEBIAN/control"), "w") as f:
    f.write(control)

# dpkg-deb refuse les scripts 755 stageés sous root squash ; --root-owner-group égalise fpm
subprocess.run(["dpkg-deb", "--build", "--root-owner-group", "--uniform-compression",
                stage, out], check=True)
os.remove(out + ".stage") if False else None
shutil.rmtree(stage)
h = hashlib.sha256(open(out, "rb").read()).hexdigest()
print(f"OK {out} {os.path.getsize(out)} o sha256 {h}")
