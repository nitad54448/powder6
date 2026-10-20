#!/usr/bin/env python3
"""Add cctbx WK1995 neutral/ionic X-ray factors to Powder 6's scattering tables.

Run with a Python interpreter that has cctbx installed, from the Powder 6 folder:
    python tools/export_ionic_scattering.py --directory scatters
or with a Phenix installation:
    phenix.python tools/export_ionic_scattering.py --directory scatters

Writes xray_wk1995_ions.json and changes index.json's preferred X-ray file.
Retains existing special entries and neutron files. Does not alter absorption.json.
All coefficients use stol = sin(theta)/lambda, NOT 1/d. No ions are guessed.
"""
import argparse
import json
import math
import os
from pathlib import Path
import re
import tempfile

SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
           'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce '
           'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn '
           'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split()
Z_BY_SYMBOL = {symbol: i + 1 for i, symbol in enumerate(SYMBOLS)}


def collect_entries(provider):
    """Use cctbx's tabulated species, including ions, without neutral fallback."""
    entries = {}
    for item in provider.wk1995_iterator():
        label = item.label()
        match = re.fullmatch(r'([A-Z][a-z]?)(?:(\d+)([+-]))?', label)
        if not match or match[1] not in Z_BY_SYMBOL:
            continue  # Special scattering labels in an existing file remain untouched.
        gaussian = item.fetch()
        a = [float(x) for x in gaussian.array_of_a()]
        b = [float(x) for x in gaussian.array_of_b()]
        c = float(gaussian.c())
        if not a or len(a) != len(b) or not all(math.isfinite(x) for x in a + b + [c]):
            raise ValueError(f'{label}: invalid Gaussian coefficients')
        charge = int(match[2] or 0) * (-1 if match[3] == '-' else 1)
        z = Z_BY_SYMBOL[match[1]]
        if abs(sum(a) + c - (z - charge)) > 0.25:
            raise ValueError(f'{label}: f(0) does not agree with Z minus ionic charge')
        entries[label] = {'Z': z, 'charge': charge, 'a': a, 'b': b, 'c': c,
                          'source': 'cctbx WK1995 (Waasmaier & Kirfel, 1995)'}
    if not any(entry['charge'] for entry in entries.values()):
        raise ValueError('The cctbx iterator returned no ionic entries')
    return entries


def write_json(path, document):
    """Atomic replacement: a failed write leaves the preceding file intact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(document, handle, indent=2, ensure_ascii=False, allow_nan=False)
            handle.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def export(directory, provider):
    directory = Path(directory)
    index_path = directory / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {'files': []}
    preferred = index.get('preferred', 'xray_wk1995.json')
    # Existing indexes name a local file, not an arbitrary filesystem location.
    if not isinstance(preferred, str) or Path(preferred).name != preferred or '\\' in preferred:
        raise ValueError('index.json preferred must be a filename inside scatters')
    old_path = directory / preferred
    old = json.loads(old_path.read_text(encoding='utf-8')) if old_path.exists() else {}
    entries = collect_entries(provider)
    table = dict(old.get('table', {}))
    table.update(entries)
    output = dict(old)
    output.update({'source': 'cctbx WK1995; existing special entries retained',
                   'argument': 'stol = sin(theta)/lambda in inverse angstroms', 'table': table})
    filename = 'xray_wk1995_ions.json'
    write_json(directory / filename, output)
    files = list(index.get('files', []))
    if not any(isinstance(item, dict) and item.get('name') == filename for item in files):
        files.append({'name': filename})
    if (directory / 'neutron.json').exists() and not any(isinstance(item, dict) and item.get('name') == 'neutron.json' for item in files):
        files.append({'name': 'neutron.json'})
    index.update({'preferred': filename, 'files': files})
    write_json(index_path, index)  # Switch only after the new table has been written.
    return len(entries), sum(bool(e['charge']) for e in entries.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--directory', type=Path, default=Path('scatters'))
    args = parser.parse_args()
    try:
        from cctbx.eltbx import xray_scattering
    except ImportError:
        parser.exit(1, 'cctbx is required. Use a cctbx environment or phenix.python.\n')
    try:
        total, ions = export(args.directory, xray_scattering)
    except (ValueError, OSError, RuntimeError, AttributeError, TypeError) as error:
        parser.exit(1, f'Export failed: {error}\n')
    print(f'Wrote {total} WK1995 species ({ions} ions). Reload Powder 6 to use the new preferred table.')


if __name__ == '__main__':
    main()
