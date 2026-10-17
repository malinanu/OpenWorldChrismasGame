"""One-off layout pass for public/world/frostvale.json (run: python3 -I tools/layout-world.py).

Scales the map 1.5x, moves each game zone's dressing with its zone, defines curved
cobblestone roads from the Great Tree to every zone, rebuilds the village along the
bakery and dice-race roads, thins the forest, and checks that nothing sits on a road.
"""
import json, math

SRC = 'public/world/frostvale.json'
w = json.load(open(SRC))
S = 1.5
old_zones = {z['id']: z['position'] for z in w['zones']}
new_zones = {k: [round(v[0] * S, 1), 0, round(v[2] * S, 1)] for k, v in old_zones.items()}

def nearest_zone(x, z):
    return min(old_zones, key=lambda k: (old_zones[k][0] - x) ** 2 + (old_zones[k][2] - z) ** 2)

# ---- roads (control points; the game smooths them with a Catmull-Rom curve) ----
roads = [
    # Main Street: north-south through the Great Tree plaza.
    {"to": "snowball-showdown", "houses": True, "points": [[0, 17], [3, 30], [0, 50], [-3, 68], [0, 84]]},
    {"to": "santas-express", "houses": True, "points": [[0, -17], [-3, -34], [0, -55], [3, -78], [0, -98]]},
    # Market Lane (south cross street) and Mill Lane (north cross street), starting at their Main Street crossroads.
    {"to": "gingerbread-bakery", "houses": True, "points": [[0, 30], [-22, 31], [-44, 36], [-66, 46]]},
    {"to": "advent-dice-race", "houses": True, "points": [[3, 30], [24, 31], [46, 36], [66, 46]]},
    {"to": "krampus-cellar", "houses": True, "points": [[-3, -34], [-24, -35], [-46, -42], [-68, -53]]},
    {"to": "elf-workshop", "houses": True, "points": [[-3, -34], [22, -35], [44, -42], [66, -51]]},
    # Outer lanes close the grid: west (bakery-cellar), east (dice-workshop), and a lakeside lane.
    {"points": [[-66, 46], [-84, 22], [-88, -10], [-80, -40], [-68, -53]]},
    {"points": [[66, 46], [84, 22], [88, -10], [80, -40], [66, -51]]},
    {"points": [[-66, 46], [-40, 70], [-14, 86], [0, 84], [14, 86], [40, 70], [66, 46]]},
    # Plaza ring around the Great Tree.
    {"loop": True, "points": [[15 * math.cos(a * math.pi / 6), 15 * math.sin(a * math.pi / 6)] for a in range(12)]},
]

def dense(points, loop=False, step=1.0):
    pts = points + ([points[0]] if loop else [])
    out = []
    for i in range(len(pts) - 1):
        (ax, az), (bx, bz) = pts[i], pts[i + 1]
        n = max(1, int(math.hypot(bx - ax, bz - az) / step))
        for k in range(n):
            out.append((ax + (bx - ax) * k / n, az + (bz - az) * k / n))
    out.append(tuple(pts[-1]))
    return out

road_pts = [p for r in roads for p in dense(r["points"], r.get("loop", False))]
def road_dist(x, z):
    return min(math.hypot(x - px, z - pz) for px, pz in road_pts)

# ---- props: hub keeps its spot, zone dressing moves with its zone, old road lanterns/houses are regenerated ----
props = []
for p in w['props']:
    m = p['model']
    if m in ('holiday/gingerbread_house_decorated', 'holiday/gingerbread_house') and p.get('scale', 1) < 5:
        continue  # village houses are rebuilt below
    at = []
    for (x, y, z) in p.get('at', []):
        r = math.hypot(x, z)
        if m == 'holiday/lantern_decorated' and r > 13:
            continue  # old road lanterns; Roads.ts places new ones
        if r > 45:
            k = nearest_zone(x, z)
            dx = new_zones[k][0] - old_zones[k][0]
            dz = new_zones[k][2] - old_zones[k][2]
            x, z = x + dx, z + dz
        at.append([round(x, 2), y, round(z, 2)])
    q = dict(p)
    if 'at' in p:
        q['at'] = at
        if not at:
            continue
    if 'line' in p:
        k = nearest_zone(p['line']['from'][0], p['line']['from'][2])
        dz = new_zones[k][2] - old_zones[k][2]
        q['line'] = {**p['line'], 'from': [p['line']['from'][0], 0, p['line']['from'][2] + dz], 'to': [p['line']['to'][0], 0, p['line']['to'][2] + dz]}
    props.append(q)

# The bakery's cafe table would sit on the end of the new road; move it beside the house.
for p in props:
    if p['model'] == 'restaurant/table_round_A_decorated':
        p['at'] = [[-79, 0, 42]]
    if p['model'] == 'holiday/hot_chocolate_decorated':
        p['at'] = [[-79, 1.7, 42]]

# Plaza: lanterns inside the ring road, snowmen moved off it.
for p in props:
    if p['model'] == 'holiday/lantern_decorated':
        p['at'] = [[7.5, 0, 7.5], [-7.5, 0, 7.5], [7.5, 0, -7.5], [-7.5, 0, -7.5]]
        p.pop('rotY', None)
    if p['model'] == 'holiday/snowman_A':
        p['at'] = [[10, 0, 22], [-21, 0, -8]]
    if p['model'] == 'holiday/snowman_B':
        p['at'] = [[-11, 0, 23], [22, 0, -9]] + [a for a in p['at'] if math.hypot(a[0], a[2]) > 45]
        p['rotY'] = [-0.4, 3.6, -0.6, 0.6][: len(p['at'])]

# Village: gingerbread houses facing the streets, both sides, spaced out, never on a road or a crossroads.
houses_deco, houses_plain = [], []
placed = []
for road in roads:
    if not road.get("houses"):
        continue
    pts = dense(road['points'])
    for idx in range(10, len(pts) - 8, 17):
        (x0, z0), (x1, z1) = pts[idx - 1], pts[idx + 1]
        tx, tz = x1 - x0, z1 - z0
        L = math.hypot(tx, tz)
        tx, tz = tx / L, tz / L
        for side in (1, -1):
            nx, nz = -tz * side, tx * side
            hx, hz = pts[idx][0] + nx * 10, pts[idx][1] + nz * 10
            if road_dist(hx, hz) < 8.5 or any(math.hypot(hx - px, hz - pz) < 11 for px, pz in placed) or math.hypot(hx, hz) < 24:
                continue
            if any(math.hypot(hx - z[0], hz - z[2]) < 16 for z in new_zones.values()):
                continue
            placed.append((hx, hz))
            face = math.atan2(-nx, -nz)  # front door towards the street
            (houses_deco if len(placed) % 2 else houses_plain).append(([round(hx, 1), 0, round(hz, 1)], round(face, 2)))
props.append({"model": "holiday/gingerbread_house_decorated", "at": [h[0] for h in houses_deco], "scale": 4.2, "rotY": [h[1] for h in houses_deco], "collider": "box", "snow": 0.7})
props.append({"model": "holiday/gingerbread_house", "at": [h[0] for h in houses_plain], "scale": 4, "rotY": [h[1] for h in houses_plain], "collider": "box", "snow": 0.7})

# ---- world fields ----
w['half'] = 225
w['lake'] = {"x": 0, "z": 117, "r": 26}
w.pop('paths', None)
w['roads'] = roads
w['flats'] = [{"x": 0, "z": 0, "r": 20}] + [
    {"x": round(f['x'] * S, 1), "z": round(f['z'] * S, 1), "r": f['r'] + 2} for f in w['flats'][1:]
]
for z in w['zones']:
    z['position'] = new_zones[z['id']]

# Thinner forest over a bigger map: ~5x lower density, rocks/bushes don't cast shadows.
dens = {7: (230, 30, 225), 11: (30, 28, 215), 3: (80, 24, 220), 5: (90, 22, 220)}
for s in w['scatter']:
    cnt, rmin, rmax = dens[s['seed']]
    s['count'], s['minRadius'], s['maxRadius'] = cnt, rmin, rmax
    s['clearance'] = 16 if s['seed'] in (7, 11) else 12
    s['pathClearance'] = 9 if s['seed'] in (7, 11) else 6
    if s['seed'] == 7:
        s['chunk'] = 150
    if s['seed'] in (3, 5):
        s['shadow'] = False
    if s['seed'] == 7:
        s['models'] = ["forest/Tree_1_A_Color1", "forest/Tree_2_A_Color1", "forest/Tree_2_B_Color1", "forest/Tree_2_C_Color1", "forest/Tree_4_A_Color1", "forest/Tree_4_B_Color1"]
    if s['seed'] in (7, 11):
        s['shadow'] = 'high'  # forest shadows only on the Pretty preset

# ---- checks ----
problems = []
for p in props:
    for (x, y, z) in p.get('at', []):
        d = road_dist(x, z)
        if d < 4 and 'tracks' not in p['model'] and 'train' not in p['model']:
            problems.append((p['model'], x, z, round(d, 1)))
for zid, (x, _, z) in new_zones.items():
    d = road_dist(x, z)
    if d > 8:
        problems.append(('zone far from road', zid, round(d, 1)))
print('problems:', problems or 'none')
print('houses:', len(houses_deco) + len(houses_plain), 'props:', len(props))
w['props'] = props
json.dump(w, open(SRC, 'w'), indent=1)
