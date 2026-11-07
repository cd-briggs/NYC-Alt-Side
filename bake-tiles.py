"""Download NYC Open Data for all five boroughs and cut it into small tiles in tiles/, so the page loads only what is in view.

Run (from this folder):  python3 -I bake-tiles.py            (download what is missing, then tile)
                         python3 -I bake-tiles.py --fresh    (ignore cached downloads in build/raw/)
Download takes several minutes (NYC's sign query is slow). Raw rows are cached in build/raw/ (not published).
Network goes through curl (this Mac's Python can't verify SSL certificates).

Tiles: 3000 ft squares of NY State Plane (EPSG:2263), file tiles/<col>_<row>.js, col = floor(x / 3000), row = floor(y / 3000).
Each feature lives in exactly one tile (signs and hydrants by their own x/y, street segments by the middle vertex of their first line),
so the page loads the tiles in view plus a one-tile ring and just concatenates them.
Tile file: window.__tile("c_r", {d:[sign texts], s:[signs], h:[hydrants], t:[streets]});
tiles/index.js: window.TILE_INDEX = {size, created, tiles:{"c_r": bytes}}.
Sign row: [order, on_street, side, from_street, to_street, text index into d, x, y, arrow, distance_from_intersection].
"""
import json, math, os, subprocess, sys, time
from collections import defaultdict
from datetime import date
from urllib.parse import urlencode

TILE = 3000
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'build', 'raw')
OUT = os.path.join(HERE, 'tiles')
FRESH = '--fresh' in sys.argv

# NY State Plane Long Island (US ft) from lat/lng, same math as bake-snapshot.py and the page's proj4 definition
a = 6378137.0; f = 1 / 298.257222101; e = math.sqrt(2 * f - f * f)
m = lambda p: math.cos(p) / math.sqrt(1 - e * e * math.sin(p) ** 2)
t = lambda p: math.tan(math.pi / 4 - p / 2) / ((1 - e * math.sin(p)) / (1 + e * math.sin(p))) ** (e / 2)
r = math.radians
p1, p2, p0, l0 = r(41 + 2 / 60), r(40 + 40 / 60), r(40 + 10 / 60), r(-74)
n = (math.log(m(p1)) - math.log(m(p2))) / (math.log(t(p1)) - math.log(t(p2)))
F = m(p1) / (n * t(p1) ** n); rho0 = a * F * t(p0) ** n
def sp(lat, lon):
    rho = a * F * t(r(lat)) ** n; th = n * (r(lon) - l0); k = 0.3048006096012192
    return (300000 + rho * math.sin(th)) / k, (rho0 - rho * math.cos(th)) / k

def get(base, params, label):
    url = base + '?' + urlencode(params)
    for attempt in range(6):
        t0 = time.time()
        res = subprocess.run(['curl', '-s', '-m', '240', url], capture_output=True, text=True)
        try:
            data = json.loads(res.stdout)
            if isinstance(data, list):
                print(f'  {label}: {len(data)} rows in {time.time() - t0:.1f}s', flush=True); return data
            print(f'  {label}: {str(data)[:120]}', flush=True)
        except ValueError:
            print(f'  {label}: bad response, retrying', flush=True)
        time.sleep(4 * (attempt + 1))
    sys.exit(f'FAILED: {label}')

def get_all(base, params, label, page):
    out = []
    while True:
        rows = get(base, dict(params, **{'$limit': page, '$offset': len(out), '$order': ':id'}), f'{label} (from {len(out)})')
        out += rows
        if len(rows) < page: return out

def cached(name, fetch):
    path = os.path.join(RAW, name + '.json')
    if os.path.exists(path) and not FRESH:
        with open(path) as fh: return json.load(fh)
    rows = fetch()
    os.makedirs(RAW, exist_ok=True)
    with open(path, 'w') as fh: json.dump(rows, fh, separators=(',', ':'))
    return rows

BAD = "upper(full_street_name) like '%OPAS%' OR upper(full_street_name) like '%PEDESTRIAN%' OR upper(full_street_name) like '%PATH%' OR upper(full_street_name) like '%ARCHES%' OR upper(full_street_name) like '%BRG%' OR upper(full_street_name) like '%BRDG%'"
print('Downloading (cached ones are skipped)…')
streets = cached('streets', lambda: get_all('https://data.cityofnewyork.us/resource/inkn-q76z.json', {
    '$select': 'full_street_name,trafdir,boroughcode,streetwidth,the_geom',
    '$where': f"rw_type in ('1','2','3') AND trafdir != 'NV' AND NOT({BAD})"}, 'streets', 20000))
hyd = cached('hydrants', lambda: get_all('https://data.cityofnewyork.us/resource/5bgh-vtsn.json', {
    '$select': 'latitude,longitude,point_x,point_y,unitid'}, 'hydrants', 40000))
signs = []
for boro in ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island']:
    signs += cached('signs_' + boro.replace(' ', '_'), lambda boro=boro: get_all('https://data.cityofnewyork.us/resource/nfid-uabd.json', {
        '$select': 'order_number,on_street,side_of_street,from_street,to_street,sign_description,sign_x_coord,sign_y_coord,arrow_direction,distance_from_intersection',
        '$where': f"borough='{boro}' AND record_type='Current'"}, 'signs ' + boro, 40000))

print('Tiling…')
tiles = defaultdict(lambda: {'d': {}, 's': [], 'h': [], 't': []})
key = lambda x, y: f'{int(x // TILE)}_{int(y // TILE)}'
skipped = 0
for s in signs:
    if not (s.get('sign_x_coord') and s.get('sign_y_coord') and s.get('side_of_street')): skipped += 1; continue
    x, y = round(float(s['sign_x_coord'])), round(float(s['sign_y_coord']))
    if x < 100000 or y < 100000: skipped += 1; continue          # blank/zero coordinates in the dataset
    tl = tiles[key(x, y)]
    di = tl['d'].setdefault(s.get('sign_description') or '', len(tl['d']))
    tl['s'].append([s.get('order_number'), s.get('on_street'), s.get('side_of_street'), s.get('from_street'), s.get('to_street'), di, x, y,
                    s.get('arrow_direction'), float(s['distance_from_intersection']) if s.get('distance_from_intersection') else None])
print(f'  signs: {len(signs) - skipped} placed, {skipped} skipped (no side or coordinates)')
for h in hyd:
    if not h.get('point_x'): continue
    x, y = float(h['point_x']), float(h['point_y'])
    tiles[key(x, y)]['h'].append([round(float(h['latitude']), 6), round(float(h['longitude']), 6), round(x), round(y), h.get('unitid')])
for s in streets:
    g = s.get('the_geom')
    if not g or not s.get('full_street_name') or not g.get('coordinates'): continue
    line = g['coordinates'][0]
    mid = line[len(line) // 2]
    x, y = sp(mid[1], mid[0])
    tiles[key(x, y)]['t'].append([s['full_street_name'], s.get('trafdir'), s.get('boroughcode'), float(s.get('streetwidth') or 0),
                                  [[[round(c[0], 6), round(c[1], 6)] for c in ln] for ln in g['coordinates']]])

os.makedirs(OUT, exist_ok=True)
for fn in os.listdir(OUT):
    if fn.endswith('.js'): os.remove(os.path.join(OUT, fn))
index = {}
for k, tl in tiles.items():
    d = [None] * len(tl['d'])
    for text, i in tl['d'].items(): d[i] = text
    body = json.dumps({'d': d, 's': tl['s'], 'h': tl['h'], 't': tl['t']}, separators=(',', ':'))
    js = f'window.__tile("{k}",{body});\n'
    with open(os.path.join(OUT, k + '.js'), 'w') as fh: fh.write(js)
    index[k] = len(js)
with open(os.path.join(OUT, 'index.js'), 'w') as fh:
    fh.write('window.TILE_INDEX=' + json.dumps({'size': TILE, 'created': date.today().isoformat(), 'tiles': index}, separators=(',', ':')) + ';\n')
tot = sum(index.values())
print(f'Wrote {len(index)} tiles to {OUT}: {tot / 1e6:.1f} MB raw, largest {max(index.values()) / 1e3:.0f} KB, median {sorted(index.values())[len(index) // 2] / 1e3:.0f} KB')
