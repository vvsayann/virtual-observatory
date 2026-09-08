#!/usr/bin/env python3
"""Process raw catalogs into compact browser-ready JS data files."""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "data")
os.makedirs(OUT, exist_ok=True)

MAG_LIMIT = 6.5  # naked-eye limit -> ~9000 stars

# ---------------------------------------------------------------- stars
stars = []
names = {}   # index -> proper name
with open(os.path.join(HERE, "hyg.csv"), newline="", encoding="utf-8") as f:
    r = csv.DictReader(f)
    for row in r:
        if row["proper"] == "Sol":       # skip the Sun (we compute it)
            continue
        try:
            mag = float(row["mag"])
        except ValueError:
            continue
        if mag > MAG_LIMIT:
            continue
        try:
            ra = float(row["ra"])   * 15.0   # hours -> degrees
            dec = float(row["dec"])
        except ValueError:
            continue
        ci = row["ci"]
        ci = round(float(ci), 2) if ci not in ("", None) else 0.0
        bayer = row["bayer"].strip()
        con = row["con"].strip()
        proper = row["proper"].strip()
        idx = len(stars)
        # compact record: [ra, dec, mag, colorIndex, bayer, con]
        stars.append([round(ra, 4), round(dec, 4), round(mag, 2), ci, bayer, con])
        if proper:
            names[idx] = proper

with open(os.path.join(OUT, "stars.js"), "w", encoding="utf-8") as f:
    f.write("// Auto-generated from HYG database v41. Bright stars (mag<=%.1f)\n" % MAG_LIMIT)
    f.write("// record = [raDeg, decDeg, mag, colorIndex, bayer, constellation]\n")
    f.write("window.STAR_DATA = ")
    json.dump(stars, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
    f.write("window.STAR_NAMES = ")
    json.dump(names, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print("stars:", len(stars), "named:", len(names))

# --------------------------------------------------- constellation lines
def normRA(x):
    return x + 360.0 if x < 0 else x

with open(os.path.join(HERE, "constlines.json"), encoding="utf-8") as f:
    cl = json.load(f)
lines = {}
for feat in cl["features"]:
    cid = feat["id"]
    segs = []
    for seg in feat["geometry"]["coordinates"]:
        segs.append([[round(normRA(p[0]), 3), round(p[1], 3)] for p in seg])
    lines[cid] = segs

with open(os.path.join(HERE, "constmeta.json"), encoding="utf-8") as f:
    cm = json.load(f)
meta = {}
for feat in cm["features"]:
    cid = feat["id"]
    name = feat["properties"].get("en") or feat["properties"].get("name") or cid
    # label position: centroid of that constellation's line vertices
    pts = [p for seg in lines.get(cid, []) for p in seg]
    if pts:
        # circular mean for RA
        import math
        sx = sum(math.cos(math.radians(p[0])) for p in pts)
        sy = sum(math.sin(math.radians(p[0])) for p in pts)
        ra = math.degrees(math.atan2(sy, sx)) % 360
        dec = sum(p[1] for p in pts) / len(pts)
        meta[cid] = [name, round(ra, 3), round(dec, 3)]
    else:
        meta[cid] = [name, 0, 0]

with open(os.path.join(OUT, "constellations.js"), "w", encoding="utf-8") as f:
    f.write("// Constellation stick-figure lines (d3-celestial). [raDeg,decDeg] vertices\n")
    f.write("window.CONST_LINES = ")
    json.dump(lines, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
    f.write("// id -> [name, labelRaDeg, labelDecDeg]\n")
    f.write("window.CONST_META = ")
    json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print("constellations:", len(lines))

# ------------------------------------------------------------- messier
with open(os.path.join(HERE, "messier.json"), encoding="utf-8") as f:
    mj = json.load(f)
dso = []
for feat in mj["features"]:
    p = feat["properties"]
    c = feat["geometry"]["coordinates"]
    ra = normRA(c[0]); dec = c[1]
    try:
        mag = float(p.get("mag", 99))
    except (ValueError, TypeError):
        mag = 99
    dso.append([p["name"], round(ra, 3), round(dec, 3), mag,
                p.get("type", ""), p.get("alt", ""), p.get("desig", "")])

with open(os.path.join(OUT, "dso.js"), "w", encoding="utf-8") as f:
    f.write("// Messier deep-sky objects. [name,raDeg,decDeg,mag,type,commonName,desig]\n")
    f.write("window.DSO_DATA = ")
    json.dump(dso, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
print("dso:", len(dso))
