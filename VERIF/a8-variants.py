#!/usr/bin/env python3
"""a8-variants.py — table de variants d'A8 (protocole VERIF-021 §5 : copie isolée).

Usage : python3 a8-variants.py <racine-du-dépôt> <répertoire-de-travail>
        (le répertoire de travail reçoit les copies et a8-variants.json)

Pour chaque variante : copie isolée de src/ + tests/ (+ node_modules en lien symbolique),
remplacement littéral exact d'UNE occurrence (ou ajout d'une ligne), puis trois mesures :
  1. A8 texte           : grep -rnE "^[^*/]*(unref\\(|clearTimeout\\(|clearInterval\\()" src/
                          (le contrôle historique — et celui que porte encore
                          tests/main-timers.node.test.ts, sur src/main seulement)
  2. A8 comportemental  : a8-confinement.mjs (AST typescript, lecture seule)
  3. comportement ?     : npx tsx --test tests/signaling-link.node.test.ts tests/main-timers.node.test.ts
                          (une variante est « à comportement constant » si seule la garde
                          textuelle du dépôt rougit, pas une assertion de comportement)

Le dépôt n'est JAMAIS modifié : tout se passe dans <répertoire-de-travail>/copies/<variante>.
Sortie : table + <répertoire-de-travail>/a8-variants.json ; code 0 si le banc s'est déroulé.
"""
import json
import os
import shutil
import subprocess
import sys

CHECKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'a8-confinement.mjs')
GATES = ['src/main/timers.ts', 'src/renderer/browser-timers.ts']
TESTFILES = ['tests/signaling-link.node.test.ts', 'tests/main-timers.node.test.ts']

CONNECT_OLD = "    socket.on('connect', () => {\n      timers.cancel(timer);\n"
COMMENT_OLD = ("    // `timers.once` arme l'`unref` lui-même : une tentative de lien ne retient pas "
               "le processus.\n")
SITE = 'src/main/signaling-link.ts'


def connect_new(stmt):
    return "    socket.on('connect', () => {\n" + stmt + "\n"


VARIANTS = [
    ('b0-temoin-base', 'none', None,
     'copie non mutée : le banc ne doit rien rougir (contrôle du banc lui-même)'),
    ('m1-alias', 'replace', (SITE, CONNECT_OLD, connect_new('      const ct = clearTimeout; ct(timer as any);')),
     'alias : `const ct = clearTimeout; ct(timer)` — comportement identique'),
    ('m2-qualifiee', 'replace', (SITE, CONNECT_OLD, connect_new('      globalThis.clearTimeout(timer as any);')),
     'forme qualifiée : `globalThis.clearTimeout(timer)`'),
    ('m3-reportee', 'replace', (SITE, CONNECT_OLD, connect_new('      queueMicrotask(() => clearTimeout(timer as any));')),
     'littéral présent mais confinement rompu : `queueMicrotask(() => clearTimeout(timer))`'),
    ('m4-calculee', 'replace', (SITE, CONNECT_OLD, connect_new("      (globalThis as any)['clearTimeout'](timer as any);")),
     "accès calculé par littéral : `globalThis['clearTimeout'](timer)`"),
    ('m5-chaine-optionnelle', 'replace', (SITE, CONNECT_OLD, connect_new('      globalThis.clearTimeout?.(timer as any);')),
     'chaînage optionnel : `globalThis.clearTimeout?.(timer)`'),
    ('w0-temoin-neutre', 'replace', (SITE, COMMENT_OLD,
     COMMENT_OLD + "    // Témoin neutre A8 : cette prose cite clearTimeout( et clearInterval( sans les appeler.\n"),
     'témoin neutre : commentaire citant les littéraux, aucun changement de comportement'),
    ('w1-litteral-dans-chaine', 'append', (SITE, None, "\nvoid 'clearTimeout('\n"),
     "témoin neutre : littéral dans une chaîne évaluée puis jetée, aucun comportement"),
    ('m6-composee', 'replace', (SITE, CONNECT_OLD,
     connect_new("      (globalThis as any)['clear' + 'Timeout'](timer as any);")),
     "limite CONNUE et mesurée : accès composé à l'exécution — aucune analyse statique ne le voit"),
]


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def prepare(root, copy):
    if os.path.isdir(copy):
        shutil.rmtree(copy)
    os.makedirs(copy)
    for d in ('src', 'tests'):
        shutil.copytree(os.path.join(root, d), os.path.join(copy, d))
    for f in ('package.json', 'tsconfig.json', 'tsconfig.main.json'):
        p = os.path.join(root, f)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(copy, f))
    os.symlink(os.path.join(root, 'node_modules'), os.path.join(copy, 'node_modules'))


def apply_patch(copy, mode, spec):
    if mode == 'none':
        return 'aucun'
    rel, old, new = spec
    path = os.path.join(copy, rel)
    text = open(path, encoding='utf8').read()
    if mode == 'append':
        open(path, 'w', encoding='utf8').write(text + new)
        return 'append 1 ligne'
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"ABANDON {rel}: {n} occurrence(s) de l'ancre, attendu 1")
    open(path, 'w', encoding='utf8').write(text.replace(old, new))
    return 'replace 1 occurrence'


def legacy_a8(copy):
    r = run(['grep', '-rnE', r'^[^*/]*(unref\(|clearTimeout\(|clearInterval\()', 'src/'], cwd=copy)
    lines = [ln for ln in r.stdout.splitlines() if ln]
    files = sorted({ln.split(':')[0] for ln in lines})
    outside = [ln for ln in lines if ln.split(':')[0] not in GATES]
    verdict = 'VERT' if files == sorted(GATES) else 'ROUGE'
    return verdict, files, outside


def behavioural(copy):
    r = run(['node', CHECKER, copy])
    last = [ln for ln in r.stdout.splitlines() if ln.startswith('CHECK_A8')]
    detail = [ln.strip() for ln in r.stdout.splitlines() if ln.strip().startswith('HORS-PORTE')]
    verdict = 'VERT' if last and 'RESULT=PASS' in last[0] else 'ROUGE'
    return verdict, (last[0] if last else r.stderr.strip()[:200]), detail


def behaviour(copy):
    r = run(['npx', '--no-install', 'tsx', '--test'] + TESTFILES, cwd=copy)
    pas = fail = None
    failing = []
    for ln in r.stdout.splitlines():
        if ln.startswith('# pass '):
            pas = ln.split()[-1]
        elif ln.startswith('# fail '):
            fail = ln.split()[-1]
        elif ln.strip().startswith('not ok '):
            failing.append(ln.strip())
    return pas, fail, r.returncode, failing


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    root = os.path.abspath(sys.argv[1])
    work = os.path.abspath(sys.argv[2])
    copies = os.path.join(work, 'copies')
    os.makedirs(copies, exist_ok=True)
    rows = []
    for name, mode, spec, desc in VARIANTS:
        copy = os.path.join(copies, name)
        prepare(root, copy)
        patch = apply_patch(copy, mode, spec)
        lv, files, lout = legacy_a8(copy)
        bv, bl, bd = behavioural(copy)
        pas, fail, rc, failing = behaviour(copy)
        rows.append(dict(variant=name, patch=patch, desc=desc, site=SITE if spec else '-',
                         a8_texte=lv, a8_texte_fichiers=files, a8_texte_hors_portes=len(lout),
                         a8_comportemental=bv, a8_comportemental_ligne=bl, a8_detail=bd,
                         tests_pass=pas, tests_fail=fail, tests_rc=rc, tests_rouges=failing))
        print(f'=== {name} — {desc}')
        print(f'    patch             : {patch}' + (f' sur {SITE}' if spec else ''))
        print(f'    A8 texte          : {lv}  fichiers=[{" ".join(files)}] lignes_hors_portes={len(lout)}')
        for h in lout:
            print(f'        texte-hit     : {h}')
        print(f'    A8 comportemental : {bv}  {bl}')
        for h in bd:
            print(f'        {h}')
        print(f'    tests             : pass={pas} fail={fail} rc={rc}')
        for f in failing:
            print(f'        rouge         : {f}')
        print()
    print('TABLE')
    print(f'{"variante":24} {"A8 texte":9} {"A8 comport.":11} {"tests pass/fail":16}')
    for r in rows:
        print(f'{r["variant"]:24} {r["a8_texte"]:9} {r["a8_comportemental"]:11} '
              f'{str(r["tests_pass"]) + "/" + str(r["tests_fail"]):16}')
    out = os.path.join(work, 'a8-variants.json')
    open(out, 'w', encoding='utf8').write(json.dumps(rows, ensure_ascii=False, indent=1))
    print('json ->', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
