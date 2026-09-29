"""Station Interiors block library generator.
Every block: footprint in U, zones, items (furniture/equipment), partitions, connectors.
Coordinates: origin NW corner, x east, y south, units U (1U = 2 m).
"""
import json, copy, os

BLOCKS = []

def Z(z, x, y, w, h): return {"z": z, "r": [x, y, w, h]}
def I(k, x, y, w, h, l=""):
    d = {"k": k, "r": [x, y, w, h]}
    if l: d["l"] = l
    return d
def P(x1, y1, x2, y2): return [x1, y1, x2, y2]
def door(id, face, cell, opt=False): return {"id": id, "face": face, "at": cell + 0.25, "w": 0.5, "type": "personnel", "opt": opt}
def cargo(id, face, cell, cells=1, opt=False): return {"id": id, "face": face, "at": cell, "w": cells, "type": "cargo", "opt": opt}
def plaza(id, face, cell, cells=2): return {"id": id, "face": face, "at": cell, "w": cells, "type": "plaza", "opt": False}
def dock(id, face, at, w): return {"id": id, "face": face, "at": at, "w": w, "type": "dock", "opt": False}

def block(id, fam, name, w, d, h=1, zones=(), items=(), parts=(), conns=(), spine=None, hull=None,
          cap="", scale=("station",), wealth=("std",), base=None, desc="", tags=()):
    b = {"id": id, "family": fam, "name": name, "size": [w, d], "height": h, "capacity": cap,
         "scale": list(scale), "wealth": list(wealth), "spine": spine, "hull": hull,
         "zones": list(zones), "items": list(items), "parts": list(parts), "conns": list(conns),
         "desc": desc, "tags": list(tags)}
    if base: b["base"] = base
    BLOCKS.append(b)
    return b

def variant(src, id, name, **ch):
    b = copy.deepcopy(src); b["id"] = id; b["name"] = name; b["base"] = src.get("base") or src["id"]
    for k, v in ch.items(): b["capacity" if k == "cap" else k] = v
    BLOCKS.append(b); return b

def flip_x(b):
    W = b["size"][0]; b = copy.deepcopy(b)
    for z in b["zones"]: x, y, w, h = z["r"]; z["r"] = [round(W - x - w, 3), y, w, h]
    for it in b["items"]: x, y, w, h = it["r"]; it["r"] = [round(W - x - w, 3), y, w, h]
    b["parts"] = [[round(W - p[0], 3), p[1], round(W - p[2], 3), p[3]] for p in b["parts"]]
    fm = {"E": "W", "W": "E"}
    for c in b["conns"]:
        if c["face"] in ("N", "S"): c["at"] = round(W - c["at"] - c["w"], 3)
        else: c["face"] = fm[c["face"]]
    for k in ("spine", "hull"):
        if b[k] in fm: b[k] = fm[b[k]]
    return b

def flip_y(b):
    D = b["size"][1]; b = copy.deepcopy(b)
    for z in b["zones"]: x, y, w, h = z["r"]; z["r"] = [x, round(D - y - h, 3), w, h]
    for it in b["items"]: x, y, w, h = it["r"]; it["r"] = [x, round(D - y - h, 3), w, h]
    b["parts"] = [[p[0], round(D - p[1], 3), p[2], round(D - p[3], 3)] for p in b["parts"]]
    fm = {"N": "S", "S": "N"}
    for c in b["conns"]:
        if c["face"] in ("E", "W"): c["at"] = round(D - c["at"] - c["w"], 3)
        else: c["face"] = fm[c["face"]]
    for k in ("spine", "hull"):
        if b[k] in fm: b[k] = fm[b[k]]
    return b

def shift(b, dx, dy):
    b = copy.deepcopy(b)
    for z in b["zones"]: z["r"][0] += dx; z["r"][1] += dy
    for it in b["items"]: it["r"][0] += dx; it["r"][1] += dy
    b["parts"] = [[p[0] + dx, p[1] + dy, p[2] + dx, p[3] + dy] for p in b["parts"]]
    return b

def merge(id, fam, name, parts_list, w, d, conns, extra_parts=(), **kw):
    zones, items, parts = [], [], list(extra_parts)
    for (pb, dx, dy) in parts_list:
        s = shift(pb, dx, dy); zones += s["zones"]; items += s["items"]; parts += s["parts"]
    return block(id, fam, name, w, d, zones=zones, items=items, parts=parts, conns=conns, **kw)

def bunks(xs, y, tiers=2, horiz=True):
    lab = "×%d" % tiers
    return [I("bed", x + 0.04, y + 0.02, 0.92, 0.43, lab) for x in xs]

# ============ HOUSING ============
H0 = block("H0-RACK", "H", "Rack cell", 3, 2, 1,
    zones=[Z("SLEEP", 0, 0, 3, .5), Z("SLEEP", 1, 1.5, 2, .5), Z("STORE", 0, 1, .25, 1)],
    items=bunks([0, 1, 2], 0) + bunks([1, 2], 1.5) + [I("box", .04, 1.04, .18, .92, "lk"), I("dash", 1.2, .82, .8, .32, "table")],
    conns=[door("S1", "S", 0)], spine="E", cap="10 berths", scale=("outpost", "station"), wealth=("poor",),
    desc="Two-tier bunks on every free wall; shared hygiene off-module.")
variant(H0, "H0-RACK3", "Rack cell · 3-tier", height=2, cap="15 berths",
    items=bunks([0, 1, 2], 0, 3) + bunks([1, 2], 1.5, 3) + [I("box", .04, 1.04, .18, .92, "lk"), I("dash", 1.2, .82, .8, .32, "table")],
    desc="2U tall, three tiers per frame.")
block("H0-POD", "H", "Capsule pods", 4, 2, 1,
    zones=[Z("SLEEP", 0, 0, 4, .5), Z("SLEEP", 1, 1.5, 3, .5), Z("STORE", 0, 1, .25, 1)],
    items=[I("box", x + .02, .02, .96, .46, "pod ×2") for x in range(4)] + [I("box", x + .02, 1.52, .96, .46, "pod ×2") for x in (1, 2, 3)] + [I("box", .04, 1.04, .2, .9, "lk")],
    conns=[door("S1", "S", 0)], spine="N", cap="14 pods", scale=("station", "hub"), wealth=("poor", "std"),
    desc="Capsule-hotel pods, 2 tiers; transit hostels and worker blocks.")
block("H0-DORM", "H", "Dormitory run", 6, 2, 1,
    zones=[Z("SLEEP", 0, 0, 6, .5), Z("SLEEP", 1, 1.5, 4, .5)],
    items=bunks(range(6), 0) + bunks([1, 2, 3, 4], 1.5) + [I("box", 5.1, 1.55, .86, .4, "lockers")],
    conns=[door("W1", "W", 1), door("E1", "E", 1)], spine="N", cap="20 berths", scale=("outpost", "station", "mega"), wealth=("poor",),
    desc="Through-dorm with doors at both ends; chains end to end.")
block("H0-HOT", "H", "Hot-bunk closet", 2, 2, 1,
    zones=[Z("SLEEP", 0, 0, 2, .5), Z("STORE", 0, 1.75, 1, .25)],
    items=bunks([0, 1], 0) + [I("box", .04, 1.76, .92, .2, "lockers")],
    conns=[door("S1", "S", 1)], spine="E", cap="4 berths (×3 shifts)", scale=("outpost",), wealth=("poor",),
    desc="Smallest berth block; shared in shifts.")

H1 = block("H1-CABIN", "H", "Crew cabin", 3, 3, 1,
    zones=[Z("WET", 2, 0, 1, 1), Z("SLEEP", 0, 2.5, 2, .5), Z("GALLEY", 0, 0, 1.5, .4), Z("STORE", 0, 1, .3, 1.45)],
    items=[I("cross", 2.05, .05, .45, .45, "sh"), I("round", 2.68, .08, .24, .3, "wc"), I("box", .04, .04, 1.42, .32, "desk"),
           I("box", 1.0, 1.3, .7, .45, "table"), I("box", .04, 1.04, .22, 1.36, "lk")] + bunks([0, 1], 2.52),
    parts=[P(2, 0, 2, 1), P(2, 1, 2.1, 1), P(2.55, 1, 3, 1)],
    conns=[door("S1", "S", 2), door("E1", "E", 1, True)], spine="N", cap="4 berths", scale=("outpost", "station"), wealth=("poor", "std"),
    desc="Bunked cabin with its own wet cell.")
variant(H1, "H1-OFFICER", "Officer cabin", cap="2", wealth=["std"],
    items=[I("cross", 2.05, .05, .45, .45, "sh"), I("round", 2.68, .08, .24, .3, "wc"), I("box", .04, .04, 1.42, .32, "desk"),
           I("box", 1.0, 1.3, .7, .45, "table"), I("box", .04, 1.04, .22, 1.36, "lk"), I("bed", .04, 2.54, .92, .43, "single"), I("bed", 1.04, 2.54, .92, .43, "single")],
    desc="Two singles instead of bunks.")
variant(H1, "H1-COUPLE", "Couple cabin", cap="2", wealth=["std"],
    items=[I("cross", 2.05, .05, .45, .45, "sh"), I("round", 2.68, .08, .24, .3, "wc"), I("box", .04, .04, 1.42, .32, "galley"),
           I("bed", .04, 2.0, 1.0, .8, "double"), I("box", 1.72, 2.0, .24, .96, "robe"), I("box", 1.0, 1.1, .6, .4, "table")],
    zones=[Z("WET", 2, 0, 1, 1), Z("SLEEP", 0, 1.9, 2, 1.1), Z("GALLEY", 0, 0, 1.5, .4)])
block("H1-SOLO", "H", "Solo cabin", 2, 2, 1,
    zones=[Z("WET", 1, 0, 1, 1), Z("SLEEP", 0, 1.5, 1.1, .5)],
    items=[I("cross", 1.05, .05, .45, .45, "sh"), I("round", 1.68, .08, .24, .3, "wc"), I("box", .04, .04, .9, .3, "desk"), I("bed", .04, 1.52, 1.0, .44, "bed")],
    parts=[P(1, 0, 1, 1), P(1, 1, 1.1, 1), P(1.55, 1, 2, 1)],
    conns=[door("S1", "S", 1)], spine="N", cap="1", scale=("station", "hub"), wealth=("std",), desc="Single-occupant micro cabin.")
merge("H1-PAIR", "H", "Cabin pair", [(H1, 0, 0), (flip_x(H1), 3, 0)], 6, 3,
    conns=[door("S1", "S", 2), door("S2", "S", 3)], extra_parts=[P(3, 0, 3, 3)], spine="N", cap="8 berths", scale=("outpost", "station"),
    wealth=("poor", "std"), base="H1-CABIN", desc="Two mirrored cabins sharing a wet wall.")

H2 = block("H2-QTRS", "H", "Standard quarters", 4, 4, 1,
    zones=[Z("LIVE", 0, 0, 3, 2.5), Z("LIVE", 3, 1, 1, 1.5), Z("GALLEY", 0, 0, 2.45, .38), Z("WET", 3, 0, 1, 1), Z("SLEEP", 0, 2.5, 4, 1.5), Z("ENTRY", 3, 1.5, 1, 1)],
    items=[I("cross", 3.05, .05, .45, .45, "sh"), I("round", 3.68, .08, .24, .3, "wc"), I("box", .04, .04, 2.4, .3, "galley"), I("box", 1.4, .85, .8, .5, "dining"),
           I("box", .04, 1.0, .4, 1.2, "sofa"), I("bed", .04, 2.95, 1.0, .8, "double"), I("box", 1.72, 2.9, .24, 1.06, "robe"),
           I("bed", 2.96, 2.55, 1.0, .45, "single"), I("bed", 2.96, 3.51, 1.0, .45, "single"), I("box", 2.04, 3.3, .3, .66, "desk")],
    parts=[P(3, 0, 3, .3), P(3, .75, 3, 1), P(3, 1, 4, 1), P(0, 2.5, 1.5, 2.5), P(1.95, 2.5, 2.4, 2.5), P(2.85, 2.5, 4, 2.5), P(2, 2.5, 2, 4)],
    conns=[door("E1", "E", 1)], spine="N", cap="3–4", scale=("station", "hub", "mega"), wealth=("std",), desc="Baseline family flat.")
variant(H2, "H2-FAMILY6", "Quarters · bunk family", cap="6",
    items=[i if i.get("l") != "single" else dict(i, l="bunk ×2") for i in H2["items"]], wealth=["poor", "std"], desc="Bed B singles become bunks.")
variant(H2, "H2-STUDY", "Quarters · couple + study", cap="2",
    items=[i for i in H2["items"] if i.get("l") != "single"] + [I("box", 2.9, 2.6, 1.06, .4, "desk"), I("box", 3.66, 3.1, .3, .86, "shelf")],
    zones=[z for z in H2["zones"] if z["r"] != [0, 2.5, 4, 1.5]] + [Z("SLEEP", 0, 2.5, 2, 1.5), Z("WORK", 2, 2.5, 2, 1.5)], desc="Bedroom B is a study.")
block("H2-STUDIO", "H", "Studio flat", 3, 3, 1,
    zones=[Z("LIVE", 0, 0, 2, 3), Z("WET", 2, 0, 1, 1), Z("SLEEP", 2, 1.5, 1, 1.5), Z("GALLEY", 0, 0, 2, .38)],
    items=[I("cross", 2.05, .05, .45, .45, "sh"), I("round", 2.68, .08, .24, .3, "wc"), I("box", .04, .04, 1.9, .3, "galley"), I("bed", 2.1, 1.9, .86, 1.0, "double"),
           I("box", .04, 1.4, .4, 1.1, "sofa"), I("box", .8, .9, .6, .4, "table")],
    parts=[P(2, 0, 2, .3), P(2, .75, 2, 1), P(2, 1, 3, 1)],
    conns=[door("S1", "S", 0)], spine="N", cap="1–2", scale=("station", "hub", "mega"), wealth=("std",), desc="Open-plan single flat.")
H2L = merge("H2-THREE", "H", "Quarters · 3 bedrooms", [(H2, 0, 0)], 4, 6,
    conns=[door("E1", "E", 1)], extra_parts=[P(0, 4, 4, 4), P(2, 4, 2, 6)], spine="N", cap="5–6", scale=("hub", "mega"), wealth=("std", "rich"), base="H2-QTRS",
    desc="Adds a third bedroom band and a second wet cell.")
H2L["zones"] += [Z("SLEEP", 0, 4, 2, 2), Z("WET", 2, 4, 2, 1)]
H2L["items"] += [I("bed", .04, 4.6, 1.0, .8, "double"), I("cross", 2.05, 4.05, .45, .45, "sh"), I("round", 3.68, 4.08, .24, .3, "wc"), I("box", 2.1, 5.2, 1.8, .7, "storage")]
H2L["parts"] = [p for p in H2L["parts"] if p != [0, 4, 4, 4]] + [P(0, 4, .5, 4), P(.95, 4, 4, 4)]
merge("H2-B2B", "H", "Quarters · back-to-back", [(flip_y(H2), 0, 0), (H2, 0, 4)], 4, 8,
    conns=[door("E1", "E", 2), door("E2", "E", 5)], spine="MID", cap="6–8", scale=("hub", "mega"), wealth=("std",), base="H2-QTRS",
    desc="Two flats sharing one spine; tiles into terraces.")

H3 = block("H3-RES", "H", "Residence", 8, 6, 1,
    zones=[Z("ENTRY", 0, 0, 2, 2), Z("GALLEY", 2, 0, 3, 2), Z("WET", 5, 0, 1, 1), Z("STORE", 5, 1, 1, 1), Z("WET", 6, 0, 2, 2), Z("LIVE", 0, 2, 5.5, 4), Z("SLEEP", 5.5, 2, 2.5, 4), Z("GARDEN", 1, 5.7, 4.4, .24)],
    items=[I("box", .04, .04, 1.9, .35, "closet"), I("box", 2.04, .04, 2.92, .32, "galley"), I("box", 2.6, 1.0, 1.8, .45, "island"), I("round", 5.15, .1, .22, .3, "wc"),
           I("round", 6.1, .1, 1.1, .55, "tub"), I("cross", 7.4, .04, .56, .56, "sh"), I("box", .6, 3.9, 2.0, .4, "sofa"), I("box", 3.0, 2.6, 1.6, .6, "dining 6"),
           I("bed", 6.96, 3.5, 1.0, 1.0, "king"), I("box", 5.54, 2.04, .92, .2, "walk-in"), I("dash", 2.02, .02, 2.96, 1.96, "mezz +1U")],
    parts=[P(2, 0, 2, .9), P(5, 0, 5, 1), P(5, 1, 5.1, 1), P(5.55, 1, 6, 1), P(6, 0, 6, 2), P(6, 2, 6.8, 2), P(7.25, 2, 8, 2), P(5.5, 2, 5.5, 3.3), P(5.5, 3.75, 5.5, 6), P(5.5, 2, 6, 2)],
    conns=[door("W1", "W", 1)], spine="N", hull="S", cap="2–3", scale=("mega",), wealth=("rich",), desc="Double-height living hall on a hull viewport.")
variant(H3, "H3-INTERIOR", "Residence · interior", hull=None, desc="No hull face: viewport becomes a holo-wall.", scale=["hub", "mega"])
variant(H3, "H3-DUPLEX", "Residence · duplex", height=2,
    items=H3["items"] + [I("round", 4.6, 1.3, .5, .5, "spiral")], desc="Bedrooms upstairs via spiral stair.")
merge("H3-WING", "H", "Residence · guest wing", [(H3, 0, 0)], 8, 8, conns=[door("W1", "W", 1), door("S1", "S", 1)],
    extra_parts=[P(0, 6, 3.3, 6), P(3.75, 6, 8, 6), P(4, 6, 4, 8)], spine="N", cap="4–5", scale=("mega",), wealth=("rich",), base="H3-RES",
    desc="Adds two guest suites; hull moves to E.", hull="E")
BLOCKS[-1]["zones"] += [Z("SLEEP", 0, 6, 4, 2), Z("SLEEP", 4, 6, 4, 2)]
BLOCKS[-1]["items"] += [I("bed", .04, 6.6, 1.0, .8, "double"), I("bed", 6.96, 6.6, 1.0, .8, "double"), I("cross", 3.4, 7.4, .5, .5, "sh"), I("cross", 4.1, 7.4, .5, .5, "sh")]
block("H3-PENTHOUSE", "H", "Penthouse", 10, 8, 2,
    zones=[Z("ENTRY", 0, 0, 2, 2), Z("GALLEY", 2, 0, 3, 2), Z("WET", 8, 0, 2, 2), Z("LIVE", 0, 2, 6, 6), Z("WET", 6.5, 5, 3, 2.5), Z("SLEEP", 6, 0, 2, 4), Z("GARDEN", 0, 7.6, 6, .4)],
    items=[I("box", 2.04, .04, 2.92, .32, "galley"), I("box", 2.5, 1.0, 2.0, .5, "island"), I("round", 8.1, .1, 1.1, .55, "tub"), I("bed", 6.96, .5, 1.0, 1.0, "king"),
           I("box", .6, 4.4, 2.6, .5, "sofa"), I("box", 3.6, 2.6, 2.0, .7, "dining 8"), I("solid", 6.8, 5.3, 2.4, 1.9, "pool"), I("box", 9.2, 3, .6, 1.6, "bar")],
    parts=[P(6, 0, 6, 1.5), P(6, 2, 6, 4), P(6, 4, 8, 4), P(8, 0, 8, 2), P(8, 2, 10, 2)],
    conns=[door("W1", "W", 1), door("N1", "N", 0, True)], spine="N", hull="S", cap="2–4", scale=("mega",), wealth=("rich",),
    desc="Top-tier: pool terrace on the hull face, 2U throughout.")

# ============ FOOD ============
F0 = block("F0-RATION", "F", "Ration wall", 2, 1, 1,
    zones=[Z("GALLEY", 0, 0, 2, .34)],
    items=[I("box", .03, .03, .42, .28, "ration"), I("box", .47, .03, .42, .28, "ration"), I("box", .91, .03, .29, .28, "H₂O"), I("box", 1.22, .03, .38, .28, "heat"),
           I("round", 1.7, .1, .18, .18, "waste"), I("dash", .2, .86, 1.6, .1, "lean bar")],
    conns=[door("W1", "W", 0), door("E1", "E", 0)], spine="N", cap="4 standing · ~12 crew", scale=("outpost",), wealth=("poor",), desc="Corridor segment with dispensers.")
block("F0-SINGLE", "F", "Dispenser niche", 1, 1, 1, zones=[Z("GALLEY", 0, 0, 1, .34)],
    items=[I("box", .05, .03, .5, .28, "ration"), I("box", .6, .03, .35, .28, "H₂O")], conns=[door("W1", "W", 0), door("E1", "E", 0)], spine="N", cap="2 standing", scale=("outpost",), wealth=("poor",),
    desc="1U corridor insert.")
block("F0-LONG", "F", "Ration wall · long", 3, 1, 1, zones=[Z("GALLEY", 0, 0, 3, .34)],
    items=[I("box", .03 + i * .6, .03, .56, .28, l) for i, l in enumerate(["ration", "ration", "H₂O", "heat", "heat"])] + [I("dash", .2, .86, 2.6, .1, "lean bar")],
    conns=[door("W1", "W", 0), door("E1", "E", 0)], spine="N", cap="6 standing · ~20 crew", scale=("outpost", "station"), wealth=("poor",), base="F0-RATION", desc="Second heater, 6 places.")
block("F0-CORNER", "F", "Ration corner", 2, 2, 1, zones=[Z("GALLEY", 0, 0, 2, .34), Z("GALLEY", 1.66, .34, .34, 1.66)],
    items=[I("box", .03, .03, .6, .28, "ration"), I("box", .7, .03, .6, .28, "H₂O"), I("box", 1.69, .4, .28, .6, "heat"), I("box", 1.69, 1.1, .28, .6, "waste"), I("dash", .1, 1.6, 1.2, .1, "bar")],
    conns=[door("W1", "W", 0), door("S1", "S", 0)], spine="N", cap="4 standing", scale=("outpost",), wealth=("poor",), base="F0-RATION", desc="L-turn corridor piece.")
F1 = block("F1-MESS", "F", "Mess cell", 3, 3, 1,
    zones=[Z("GALLEY", 0, 0, 3, .8), Z("MESS", 0, .8, 3, 2.2), Z("STORE", 2.55, 2.55, .45, .45)],
    items=[I("box", .04, .04, 2.92, .32, "galley"), I("box", 2.4, .04, .56, .32, "cold"), I("box", .55, 1.1, .4, 1.4, "table"), I("box", 1.85, 1.1, .4, 1.4, "table"),
           I("box", .3, 1.1, .2, 1.4), I("box", 1.0, 1.1, .2, 1.4), I("box", 1.6, 1.1, .2, 1.4), I("box", 2.3, 1.1, .2, 1.4), I("round", 2.6, 2.6, .36, .36, "rcy")],
    conns=[door("S1", "S", 1), door("E1", "E", 1, True)], spine="N", cap="16 seats · ~30 crew", scale=("outpost", "station"), wealth=("poor", "std"), desc="Galley + mess for a small crew.")
variant(F1, "F1-ROWS", "Mess cell · E–W rows",
    items=[I("box", .04, .04, 2.92, .32, "galley"), I("box", 2.4, .04, .56, .32, "cold"), I("box", .2, 1.2, 2.2, .4, "table"), I("box", .2, 2.2, 2.2, .4, "table"),
           I("box", .2, 1.0, 2.2, .18), I("box", .2, 1.62, 2.2, .18), I("box", .2, 2.0, 2.2, .18), I("box", .2, 2.62, 2.2, .18)], desc="Tables rotated 90°.")
variant(F1, "F1-BRIEF", "Mess cell · briefing mode",
    items=[I("box", .04, .04, 2.92, .32, "galley"), I("box", .5, 1.0, 2.0, .08, "screen"), I("dash", .3, 1.4, 2.4, 1.2, "folded benches")] + [I("round", .6 + i * .45, 1.6, .2, .2) for i in range(5)] + [I("round", .6 + i * .45, 2.1, .2, .2) for i in range(5)],
    desc="Benches folded: briefing / rec room.")
block("F1-OUTPOST", "F", "Mess · outpost", 3, 2, 1, zones=[Z("GALLEY", 0, 0, 3, .34), Z("MESS", 0, .34, 3, 1.66)],
    items=[I("box", .03, .03, .9, .28, "ration"), I("box", 1.0, .03, .6, .28, "heat"), I("box", .5, .9, 2.0, .4, "table"), I("box", .5, .68, 2.0, .18), I("box", .5, 1.32, 2.0, .18)],
    conns=[door("S1", "S", 0)], spine="N", cap="8 seats", scale=("outpost",), wealth=("poor",), base="F1-MESS", desc="Dispensers instead of a galley.")
F2 = block("F2-CANTEEN", "F", "Canteen", 6, 5, 1,
    zones=[Z("GALLEY", 0, 0, 4.75, 1.5), Z("WET", 4.75, 0, 1.25, 1.5), Z("MESS", 0, 1.5, 6, 3.5)],
    items=[I("box", .04, .04, 4.66, .31, "range · ovens"), I("box", 1.0, .7, 2.6, .3, "prep"), I("box", 1.0, 1.35, 3.5, .3, "serve line"), I("box", 4.85, .04, 1.11, .45, "wash"),
           I("box", 5.0, 1.35, .8, .3, "trays")] + [I("box", x, y, 2.4, .4) for x in (.4, 3.2) for y in (2.75, 3.85)] + [I("box", x, y, 2.4, .18) for x in (.4, 3.2) for y in (2.55, 3.17, 3.65, 4.27)],
    parts=[P(0, 1.5, .3, 1.5), P(.75, 1.5, 1.0, 1.5), P(4.5, 1.5, 5.0, 1.5), P(5.8, 1.5, 6, 1.5), P(4.75, .35, 4.75, 1.5)],
    conns=[door("S1", "S", 0), door("S2", "S", 5), door("E1", "E", 0)], spine="N", cap="56 seats · 150/meal", scale=("station", "hub"), wealth=("poor", "std"), desc="One-way-flow canteen.")
variant(F2, "F2-MIRROR", "Canteen · mirrored", **{k: v for k, v in flip_x(F2).items() if k in ("zones", "items", "parts", "conns")}, desc="Flow runs east → west.")
block("F2-DINER", "F", "Diner", 4, 4, 1, zones=[Z("GALLEY", 0, 0, 4, 1), Z("MESS", 0, 1, 4, 3)],
    items=[I("box", .04, .04, 3.92, .3, "grill"), I("box", .3, .75, 3.4, .25, "counter")] + [I("round", .45 + i * .5, 1.15, .18, .18) for i in range(7)] +
          [I("box", 3.1, y, .86, .55, "booth") for y in (1.6, 2.3, 3.0)] + [I("box", .4, 2.0, .6, .6, "4-top"), I("box", 1.5, 2.0, .6, .6, "4-top"), I("box", .4, 3.1, .6, .6, "4-top")],
    conns=[door("S1", "S", 1)], spine="N", cap="31 seats", scale=("station", "hub"), wealth=("std",), desc="Counter diner with booths.")
block("F2-FOODCOURT", "F", "Food court", 12, 8, 2, zones=[Z("GALLEY", 0, 0, 12, 1.5), Z("MESS", 0, 1.5, 12, 6.5)],
    items=[I("box", .2 + i * 2, .1, 1.8, 1.3, "stall") for i in range(6)] + [I("round", 1 + (i % 5) * 2.2, 2.6 + (i // 5) * 1.6, .8, .8, "4") for i in range(15)],
    parts=[P(2 * i, 0, 2 * i, 1.5) for i in range(1, 6)],
    conns=[plaza("S1", "S", 5), door("W1", "W", 4), door("E1", "E", 4)], spine="N", cap="~60 seats · 6 stalls", scale=("hub", "mega"), wealth=("std", "rich"), desc="Six kitchens around shared seating.")
F3 = block("F3-STORE", "F", "Cold store & pantry", 3, 2, 1, zones=[Z("COLD", 0, 0, 1.5, 2), Z("STORE", 1.5, 0, 1.5, 1)],
    items=[I("box", .06, .06, .26, 1.88, "rack"), I("box", .32, .06, 1.1, .24, "rack"), I("dash", .6, .6, .6, .6, "crates"), I("box", .6, 1.62, .8, .32, "freezers"),
           I("box", 1.56, .04, 1.4, .26, "shelves"), I("box", 1.62, 1.42, .28, .46, "cart"), I("box", 1.96, 1.42, .28, .46, "cart")],
    parts=[P(1.5, 0, 1.5, 1.25), P(1.5, 1.7, 1.5, 2), P(1.5, 1, 2, 1), P(2.45, 1, 3, 1)],
    conns=[door("E1", "E", 1), door("S1", "S", 2)], spine="N", cap="[TBD] days", scale=("station", "hub"), wealth=("std",), desc="Chiller, freezers, dry store.")
variant(F3, "F3-ALLCOLD", "Cold store · all-cold", zones=[Z("COLD", 0, 0, 3, 2)], scale=["outpost"], desc="Whole module chilled.")
variant(F3, "F3-GROW", "Pantry · grow rack", zones=[Z("COLD", 0, 0, 1.5, 2), Z("GARDEN", 1.5, 0, 1.5, 1)],
    items=F3["items"][:4] + [I("solid", 1.56, .04, 1.4, .26, "grow"), I("solid", 1.56, .5, 1.4, .26, "grow")], desc="Dry store becomes a grow rack.")
block("F4-HYDRO", "F", "Hydroponic farm", 6, 4, 2, zones=[Z("GARDEN", 0, 0, 6, 3.3), Z("MACHINE", 0, 3.3, 6, .7)],
    items=[I("solid", .3, .3 + i * .8, 5.4, .45, "grow racks ×4 high") for i in range(4)] + [I("box", .2, 3.4, 1.2, .5, "nutrient"), I("box", 1.6, 3.4, 1.2, .5, "pumps"), I("box", 4.6, 3.4, 1.2, .5, "LED power")],
    conns=[door("W1", "W", 1), door("E1", "E", 1)], spine="S", cap="[TBD] kg/day", scale=("outpost", "station", "hub"), wealth=("std",), desc="Stacked grow racks for fresh food.")
block("F4-ALGAE", "F", "Algae vat room", 4, 4, 2, zones=[Z("GARDEN", 0, 0, 4, 3), Z("MACHINE", 0, 3, 4, 1)],
    items=[I("round", .3 + (i % 3) * 1.2, .3 + (i // 3) * 1.3, 1.0, 1.0, "vat") for i in range(6)] + [I("box", .2, 3.2, 1.6, .6, "harvest"), I("box", 2.2, 3.2, 1.6, .6, "dryer")],
    conns=[door("S1", "S", 1)], spine="E", cap="protein + O₂", scale=("outpost", "station"), wealth=("poor", "std"), desc="Photobioreactor vats: food paste and oxygen.")
block("F4-PROTEIN", "F", "Protein vat plant", 8, 6, 3, zones=[Z("MACHINE", 0, 0, 8, 4), Z("GALLEY", 0, 4, 5, 2), Z("CONTROL", 5, 4, 3, 2)],
    items=[I("round", .4 + i * 1.9, .5, 1.6, 1.6, "bioreactor") for i in range(4)] + [I("box", .3, 2.6, 7.4, .5, "centrifuge line"), I("box", .3, 4.3, 4.4, .5, "extruder · packing"), I("box", 5.3, 4.4, 2.4, .4, "console")],
    parts=[P(0, 4, 8, 4), P(5, 4, 5, 6)], conns=[cargo("S1", "S", 1), door("S2", "S", 6)], spine="N", cap="[TBD] rations/day", scale=("hub", "mega"), wealth=("poor",),
    desc="Industrial vat food for crowded megastations.")

# ============ TECHNICAL ============
T0 = block("T0-NODE", "T", "Utility node", 2, 2, 1, zones=[Z("MACHINE", 0, 0, 1.5, .55), Z("MACHINE", 0, 1.25, .6, .75), Z("TRUNK", 1.5, 0, .5, .5)],
    items=[I("box", .06, .06, 1.36, .42, "air handler"), I("box", .04, .62, .16, .58, "pwr"), I("box", .06, 1.32, .5, .62, "pump"), I("cross", 1.52, .02, .46, .46, "riser"),
           I("box", 1.8, .8, .16, .4, "term"), I("dash", .85, .8, .45, .45, "hatch")],
    conns=[door("S1", "S", 1)], spine="RISER", cap="serves 1 cluster", scale=("outpost", "station", "hub", "mega"), desc="Riser meets the cluster.")
block("T0-CLOSET", "T", "Utility closet", 1, 1, 1, zones=[Z("MACHINE", 0, 0, 1, 1)], items=[I("box", .05, .05, .9, .3, "breakers"), I("cross", .5, .5, .45, .45, "riser")],
    conns=[door("S1", "S", 0)], spine="RISER", cap="tiny hulls", scale=("outpost",), wealth=("poor",), base="T0-NODE", desc="1U wall closet.")
block("T0-BATTERY", "T", "Battery & RTG room", 2, 3, 1, zones=[Z("MACHINE", 0, 0, 2, 2), Z("RAD", 0, 2, 2, 1)],
    items=[I("box", .1, .1 + i * .45, 1.8, .35, "cells") for i in range(4)] + [I("round", .6, 2.15, .8, .7, "RTG")],
    parts=[P(0, 2, .75, 2), P(1.25, 2, 2, 2)], conns=[door("N1", "N", 0)], spine="N", cap="outpost power", scale=("outpost",), base="T0-NODE", desc="Whole-outpost power plant.")
T1 = block("T1-SHOP", "T", "Workshop", 4, 3, 1, zones=[Z("WORK", 0, 0, 4, 3), Z("MACHINE", 2.55, .04, 1, 1), Z("STORE", 3.6, .4, .4, 2.2)],
    items=[I("box", .04, .04, 2.4, .35, "bench"), I("cross", 2.6, .08, .9, .9, "fab"), I("box", .04, 1.0, .3, 1.2, "lathe"), I("box", 3.7, .5, .26, 2.0, "parts"),
           I("dash", 1.0, 1.15, 2.3, 1.1, "work floor"), I("box", 1.04, 2.66, .92, .3, "EVA")],
    conns=[door("S1", "S", 0), cargo("S2", "S", 2)], spine="N", cap="2–4 crew", scale=("station", "hub"), desc="Block maintenance shop.")
block("T1-MINI", "T", "Workshop · outpost", 2, 2, 1, zones=[Z("WORK", 0, 0, 2, 2)],
    items=[I("box", .04, .04, 1.2, .35, "bench"), I("cross", 1.2, 1.0, .75, .75, "fab"), I("box", .04, .6, .25, 1.0, "tools")], conns=[door("S1", "S", 0)], spine="N",
    cap="1–2 crew", scale=("outpost",), wealth=("poor",), base="T1-SHOP", desc="Bench and fabricator only.")
block("T1-EVA", "T", "EVA prep bay", 4, 3, 1, zones=[Z("WORK", 0, 0, 3, 3), Z("AIRLOCK", 3, 0, 1, 2)],
    items=[I("box", .04, .04 + i * .5, .5, .4, "suit") for i in range(5)] + [I("box", 1, .1, 1.6, .4, "bench"), I("dash", 1, 1, 1.6, 1.3, "don/doff"), I("cross", 3.1, .1, .8, .8, "lock")],
    parts=[P(3, 0, 3, 2), P(3, 2, 4, 2)], conns=[door("S1", "S", 1), door("E1", "E", 0)], spine="N", hull="E", cap="5 suits", scale=("outpost", "station"), base="T1-SHOP", desc="Suit store with its own airlock.")
block("T1-DRONE", "T", "Drone bay", 4, 3, 2, zones=[Z("WORK", 0, 0, 4, 3)],
    items=[I("round", .2 + i * .95, .2, .7, .7, "dock") for i in range(4)] + [I("round", .2 + i * .95, 1.2, .7, .7, "dock") for i in range(4)] + [I("box", .2, 2.4, 2, .5, "repair")],
    conns=[door("S1", "S", 3), cargo("N1", "N", 1, 2)], spine="S", cap="8 drones", scale=("station", "hub", "mega"), base="T1-SHOP", desc="Maintenance drone charging and repair.")
block("T1-FABHALL", "T", "Fabrication hall", 12, 6, 2, zones=[Z("WORK", 0, 0, 12, 6), Z("STORE", 0, 5, 12, 1)],
    items=[I("cross", .5 + i * 2.8, .5, 2, 2, "fab") for i in range(4)] + [I("box", .5, 3, 11, .5, "assembly line"), I("box", .1, 5.1, 11.8, .8, "parts racks")],
    conns=[cargo("W1", "W", 3), cargo("E1", "E", 3), door("S1", "S", 5)], spine="N", cap="[TBD] crew", scale=("mega",), base="T1-SHOP", desc="Tiled shop for megastations.")
T2 = block("T2-LIFE", "T", "Life-support plant", 6, 6, 2, zones=[Z("MACHINE", 0, 0, 6, 1.5), Z("MACHINE", 0, 2.3, 6, 2.2), Z("CONTROL", 0, 4.5, 2.5, 1.5), Z("STORE", 2.5, 4.5, 3.5, 1.5)],
    items=[I("box", .2 + i * 1.4, .15, 1.2, 1.1, "CO₂") for i in range(3)] + [I("box", 4.4, .15, 1.4, 1.1, "O₂ elec."), I("round", .25, 2.65, 1.5, 1.5, "potable"), I("round", 1.95, 2.65, 1.5, 1.5, "grey"),
           I("box", 3.8, 2.6, 2, 1.6, "water reclaim"), I("box", .3, 4.7, 1.9, .35, "consoles"), I("box", 2.8, 4.75, .6, .6, "pump"), I("box", 3.6, 4.75, .6, .6, "pump")],
    parts=[P(0, 4.5, 1.8, 4.5), P(2.25, 4.5, 2.5, 4.5), P(2.5, 4.5, 2.5, 6)], conns=[door("W1", "W", 1), door("E1", "E", 1), door("S1", "S", 0)], spine="N", cap="1 block", scale=("station", "hub", "mega"), desc="Air and water for a block.")
block("T2-MINI", "T", "Life support · outpost", 3, 2, 1, zones=[Z("MACHINE", 0, 0, 3, 2)],
    items=[I("box", .1, .1, 1.2, .8, "CO₂"), I("round", 1.6, .1, .9, .9, "tank"), I("box", .1, 1.2, 1.2, .6, "O₂")], conns=[door("S1", "S", 2)], spine="N", cap="~20 people", scale=("outpost",), base="T2-LIFE", desc="One scrubber, one tank.")
block("T2-WATER", "T", "Water reclamation", 4, 4, 2, zones=[Z("MACHINE", 0, 0, 4, 3), Z("CONTROL", 0, 3, 1.5, 1)],
    items=[I("round", .2, .2, 1.2, 1.2, "grey"), I("round", 1.6, .2, 1.2, 1.2, "black"), I("round", 2.9, .2, 1.0, 1.0, "clean"), I("box", .2, 1.7, 3.6, .6, "filters · UV · still"), I("box", .1, 3.2, 1.3, .3, "console")],
    parts=[P(1.5, 3, 1.5, 4), P(0, 3, .5, 3), P(1, 3, 1.5, 3)], conns=[door("S1", "S", 2)], spine="N", cap="1 block", scale=("station", "hub", "mega"), base="T2-LIFE", desc="Split-out water loop.")
block("T2-ALGAE", "T", "Algae scrubber hall", 6, 4, 2, zones=[Z("GARDEN", 0, 0, 6, 3), Z("MACHINE", 0, 3, 6, 1)],
    items=[I("solid", .2, .2 + i * .7, 5.6, .45, "photobioreactor panels") for i in range(4)] + [I("box", .2, 3.2, 2.5, .6, "gas exchange")], conns=[door("W1", "W", 3), door("E1", "E", 3)], spine="S",
    cap="1 block O₂", scale=("station", "hub"), wealth=("std", "rich"), base="T2-LIFE", desc="Biological CO₂ scrubbing.")
T3 = block("T3-REACTOR", "T", "Reactor hall", 24, 16, 4, zones=[Z("RAD", 1, 1, 14, 14), Z("MACHINE", 2, 2, 12, 12), Z("MACHINE", 17, 1.5, 6, 3), Z("MACHINE", 17, 6.5, 6, 3), Z("MACHINE", 16.8, 11, 3, 3.5), Z("CONTROL", 20.5, 11, 3.5, 5)],
    items=[I("round", 3.5, 3.5, 9, 9, "fusion torus"), I("round", 5.8, 5.8, 4.4, 4.4), I("box", 17, 1.5, 6, 3, "converter A"), I("box", 17, 6.5, 6, 3, "converter B"), I("box", 16.8, 11, 3, 3.5, "switchgear"), I("box", 21, 11.5, 2.5, .6, "console")],
    parts=[P(16, 0, 16, 5.5), P(16, 6.3, 16, 16), P(20.5, 11, 20.5, 12.5), P(20.5, 13.3, 20.5, 16), P(20.5, 11, 24, 11)],
    conns=[door("S1", "S", 18), cargo("S2", "S", 12, 2), door("E1", "E", 13)], spine="N", cap="[TBD] MW", scale=("hub", "mega"), desc="Sector fusion plant.")
block("T3-FISSION", "T", "Fission plant", 16, 12, 4, zones=[Z("RAD", 1, 1, 8, 8), Z("MACHINE", 2, 2, 6, 6), Z("MACHINE", 10, 1, 5, 6), Z("CONTROL", 10, 8, 6, 4)],
    items=[I("round", 3, 3, 4, 4, "core"), I("box", 10.5, 1.5, 4, 2.2, "turbine"), I("box", 10.5, 4.3, 4, 2.2, "turbine"), I("box", 11, 9, 4, .6, "console"), I("dash", 1, 10, 7, 1.5, "spent fuel pool")],
    parts=[P(9.5, 0, 9.5, 7), P(9.5, 7.6, 9.5, 12), P(9.5, 8, 16, 8)], conns=[door("S1", "S", 12), cargo("S2", "S", 3, 2)], spine="N", cap="[TBD] MW", scale=("station", "hub"), wealth=("poor", "std"), base="T3-REACTOR", desc="Older, smaller vault.")
block("T3-SOLAR", "T", "Solar collector gallery", 12, 3, 2, zones=[Z("MACHINE", 0, 0, 12, 3)],
    items=[I("box", .3 + i * 2, .3, 1.6, 1.2, "inverter") for i in range(6)] + [I("box", .3, 2, 11.4, .6, "busbar")], conns=[door("W1", "W", 2), door("E1", "E", 2)], spine="S", hull="N",
    cap="[TBD] kW", scale=("outpost", "station"), base="T3-REACTOR", desc="Power room behind hull-mounted panels.")
block("T3-RADIATOR", "T", "Radiator gallery", 12, 2, 2, zones=[Z("MACHINE", 0, 0, 12, 2)],
    items=[I("box", .3 + i * 1.5, .2, 1.2, .6, "HX") for i in range(8)] + [I("box", .3, 1.2, 11.4, .5, "coolant manifold")], conns=[door("W1", "W", 1), door("E1", "E", 1)], hull="N", spine="S",
    cap="heat rejection", scale=("station", "hub", "mega"), desc="Heat exchangers feeding hull radiators.")

# ============ LEISURE ============
L0 = block("L0-NOOK", "L", "Rec nook", 3, 2, 1, zones=[Z("LEISURE", 0, 0, 3, 2)],
    items=[I("box", .3, .04, 1.4, .07, "screen"), I("box", .3, .75, 1.4, .36, "sofa"), I("round", 2.05, .3, .6, .6, "games"), I("box", 2.3, 1.5, .55, .24, "bike"), I("box", .04, 1.76, 1.0, .2, "books")],
    conns=[door("S1", "S", 1)], spine="N", cap="~8", scale=("outpost", "station"), wealth=("poor", "std"), desc="Off-shift room.")
variant(L0, "L0-CHAPEL", "Quiet room / chapel", items=[I("box", 1.0, .1, 1.0, .3, "altar"), I("box", .4, .8, 2.2, .2), I("box", .4, 1.2, 2.2, .2), I("box", .4, 1.6, 2.2, .2)], desc="Contemplation room.")
variant(L0, "L0-VR", "VR pods", items=[I("round", .2 + i * .95, .3, .7, .7, "pod") for i in range(3)] + [I("box", .2, 1.6, 1.0, .3, "rack")], desc="Immersion pods.")
variant(L0, "L0-LIBRARY", "Library", items=[I("box", .04, .04, 2.92, .25, "shelves"), I("box", .04, .3, .25, 1.4, "shelves"), I("box", 2.71, .3, .25, 1.4, "shelves"), I("box", .9, .8, 1.2, .5, "reading table")], desc="Shelves on three walls.")
L1 = block("L1-BAR", "L", "Bar & lounge", 5, 4, 1, zones=[Z("LEISURE", 0, 0, 5, 4), Z("GALLEY", 1, 0, 3.5, .8), Z("STORE", 4.5, 0, .5, .9)],
    items=[I("box", 1.04, .04, 3.2, .26, "back bar"), I("box", 1.0, .8, 3.2, .3, "bar")] + [I("round", 1.2 + i * .45, 1.2, .2, .2) for i in range(7)] +
          [I("box", .04, 1.1 + i * .72, .86, .64, "booth") for i in range(4)] + [I("round", x, y, .5, .5) for x, y in ((2.05, 2.15), (3.15, 2.15), (2.6, 3.15))] + [I("dash", 4, 3, .96, .96, "stage")],
    parts=[P(4.5, 0, 4.5, .9), P(4.5, .9, 5, .9)], conns=[door("S1", "S", 1), door("E1", "E", 1, True)], spine="N", cap="35 seats", scale=("station", "hub", "mega"), desc="Station bar.")
block("L1-DIVE", "L", "Dive bar", 2, 4, 1, zones=[Z("LEISURE", 0, 0, 2, 4), Z("GALLEY", 0, 0, .7, 4)],
    items=[I("box", .04, .1, .3, 3.8, "back bar"), I("box", .6, .2, .25, 3.4, "counter")] + [I("round", 1.0, .4 + i * .5, .18, .18) for i in range(7)] + [I("dash", 1.4, .3, .5, 3.4, "standing")],
    conns=[door("S1", "S", 1)], spine="W", cap="~15", scale=("outpost", "station"), wealth=("poor",), base="L1-BAR", desc="Counter and standing room only.")
variant(L1, "L1-TEA", "Tea house", cap="~24", items=[I("box", 1.04, .04, 3.2, .26, "tea bar")] + [I("box", .4 + (i % 3) * 1.4, 1.1 + (i // 3) * 1.3, .9, .9, "low table") for i in range(6)], desc="Low tables, cushions.")
block("L1-CASINO", "L", "Casino", 6, 5, 1, zones=[Z("LEISURE", 0, 0, 6, 5), Z("GALLEY", 0, 0, 2, .8), Z("CONTROL", 5, 0, 1, 1.5)],
    items=[I("box", .04, .04, 1.9, .3, "bar")] + [I("round", 1 + (i % 3) * 1.5, 1.4 + (i // 3) * 1.6, .9, .9, "table") for i in range(6)] + [I("box", .1 + i * .55, 4.6, .45, .35, "slot") for i in range(8)] + [I("box", 5.1, .1, .8, .5, "cage")],
    parts=[P(5, 0, 5, 1.5), P(5, 1.5, 6, 1.5)], conns=[door("S1", "S", 4), door("W1", "W", 2)], spine="N", cap="~40", scale=("hub", "mega"), wealth=("std", "rich"), base="L1-BAR", desc="Gaming tables and a cashier cage.")
variant(L1, "L1-VIEW", "Viewport lounge", hull="S", wealth=["rich"], scale=["hub", "mega"], desc="Luxury lounge on a hull viewport.")
L2 = block("L2-GYM", "L", "Gym & court", 6, 5, 2, zones=[Z("LEISURE", 0, 0, 6, 5), Z("WET", 5, 0, 1, 2), Z("STORE", 0, 4.65, 1.5, .35)],
    items=[I("box", .25 + i * .5, .1, .35, .8, "tm") for i in range(4)] + [I("box", 2.5, .15, 1, .22, "row"), I("box", 2.5, .55, 1, .22, "row"), I("box", .04, 1.5, .25, 1.6, "weights"),
           I("dash", 1.8, 1.6, 3, 2.6, "court"), I("cross", 5.5, .05, .45, .45, "sh"), I("cross", 5.5, .55, .45, .45, "sh"), I("box", .04, 4.7, 1.42, .26, "lockers")],
    parts=[P(5, 0, 5, 1.3), P(5, 1.7, 5, 2), P(5, 2, 6, 2)], conns=[door("S1", "S", 2), door("E1", "E", 3, True)], spine="N", cap="~25", scale=("station", "hub", "mega"), desc="Gym with a 2U court.")
block("L2-CRAMPED", "L", "Gym · cramped", 3, 3, 1, zones=[Z("LEISURE", 0, 0, 3, 3)],
    items=[I("box", .1 + i * .5, .1, .35, .8, "tm") for i in range(3)] + [I("box", 2.0, .1, .9, .22, "row"), I("box", .1, 1.5, .25, 1.3, "weights"), I("dash", .8, 1.4, 2, 1.4, "mats")],
    conns=[door("S1", "S", 1)], spine="N", cap="~8", scale=("outpost", "station"), wealth=("poor",), base="L2-GYM", desc="Machines only.")
block("L2-POOL", "L", "Pool hall", 8, 6, 2, zones=[Z("LEISURE", 0, 0, 8, 6), Z("WET", 0, 0, 2, 2)],
    items=[I("solid", 2.5, .8, 5, 3.5, "pool 10 × 7 m"), I("cross", .1, .1, .8, .8, "sh"), I("cross", 1.1, .1, .8, .8, "sh"), I("box", .1, 1.2, 1.8, .6, "lockers")] + [I("box", 2.6 + i * 1.2, 4.8, 1, .5, "lounger") for i in range(4)],
    parts=[P(2, 0, 2, 1.5), P(0, 2, 2, 2)], conns=[door("S1", "S", 1)], spine="N", cap="~40", scale=("hub", "mega"), wealth=("rich",), base="L2-GYM", desc="Swimming pool with changing room.")
block("L2-ARENA", "L", "Sports arena", 16, 12, 4, zones=[Z("LEISURE", 0, 0, 16, 12)],
    items=[I("dash", 3, 2.5, 10, 7, "court 20 × 14 m")] + [I("box", 1, 1 + i * .8, 1.2, .6) for i in range(12)] + [I("box", 13.8, 1 + i * .8, 1.2, .6) for i in range(12)],
    conns=[plaza("S1", "S", 7), door("W1", "W", 5), door("E1", "E", 5)], spine="N", cap="~600 spectators", scale=("mega",), wealth=("std", "rich"), base="L2-GYM", desc="Four tiled gyms: a court with stands.")
L3 = block("L3-PARK", "L", "Park atrium", 20, 14, 6, zones=[Z("LEISURE", 0, 0, 20, 14), Z("GARDEN", 1, 1, 18, 12)],
    items=[I("round", 2.8, 2.3, 2.4, 2.4, "tree"), I("round", 5.5, 9.5, 2, 2, "tree"), I("round", 15.9, 2.5, 1.8, 1.8, "tree"), I("round", 15.3, 9, 2.4, 2.4, "tree"),
           I("round", 11.3, 2.5, 4.4, 2.6, "pond"), I("box", 6.6, 2, 1.8, 1.1, "café"), I("dash", 1, 1, 18, 12, "void · 5 decks")],
    conns=[plaza("N1", "N", 9), plaza("S1", "S", 9), plaza("W1", "W", 6), plaza("E1", "E", 6)], spine="N", cap="[TBD]", scale=("mega",), wealth=("std", "rich"), desc="6-deck garden void.")
block("L3-GARDEN", "L", "Garden room", 6, 6, 2, zones=[Z("GARDEN", 0, 0, 6, 6)],
    items=[I("round", .5, .5, 1.6, 1.6, "tree"), I("round", 3.8, 3.6, 1.8, 1.8, "tree"), I("solid", 2.5, .6, 3, .8, "beds"), I("box", .6, 4.4, 2, .4, "bench")],
    conns=[door("S1", "S", 2), door("N1", "N", 3)], spine="E", cap="~20", scale=("station", "hub"), wealth=("std",), base="L3-PARK", desc="Small-station green room.")
block("L3-MARKET", "L", "Market plaza", 20, 14, 3, zones=[Z("LEISURE", 0, 0, 20, 14)],
    items=[I("box", 1.5 + (i % 6) * 3, 1.5 + (i // 6) * 3.5, 2, 2, "stall") for i in range(18)],
    conns=[plaza("N1", "N", 9), plaza("S1", "S", 9), plaza("W1", "W", 6), plaza("E1", "E", 6)], spine="N", cap="18 stalls", scale=("hub", "mega"), wealth=("poor", "std"), base="L3-PARK", desc="Stall grid on a plaza.")
block("L3-THEATRE", "L", "Theatre / cinema", 12, 10, 3, zones=[Z("LEISURE", 0, 0, 12, 10), Z("STORE", 0, 0, 12, 1.5)],
    items=[I("box", 1, .2, 10, 1.1, "stage / screen")] + [I("box", 1 + i * .3, 2.5 + i * .9, 10 - i * .6, .4) for i in range(8)],
    parts=[P(0, 1.5, 12, 1.5)], conns=[plaza("S1", "S", 5), door("W1", "W", 1), door("E1", "E", 1)], spine="N", cap="~250 seats", scale=("hub", "mega"), wealth=("std", "rich"), desc="Raked seating facing a stage.")

# ============ CIRCULATION ============
def corr(id, name, w, d, zones, conns, desc):
    return block(id, "V", name, w, d, 1, zones=zones, conns=conns, cap="", scale=("outpost", "station", "hub", "mega"), desc=desc, spine="N" if d == 1 else None)
corr("V-COR-I", "Corridor · straight", 1, 1, [Z("CIRC", 0, 0, 1, 1)], [door("W1", "W", 0), door("E1", "E", 0)], "Basic 1U corridor tile.")
corr("V-COR-L", "Corridor · corner", 1, 1, [Z("CIRC", 0, 0, 1, 1)], [door("W1", "W", 0), door("S1", "S", 0)], "90° turn.")
corr("V-COR-T", "Corridor · T", 1, 1, [Z("CIRC", 0, 0, 1, 1)], [door("W1", "W", 0), door("E1", "E", 0), door("S1", "S", 0)], "Three-way junction.")
corr("V-COR-X", "Corridor · cross", 1, 1, [Z("CIRC", 0, 0, 1, 1)], [door("W1", "W", 0), door("E1", "E", 0), door("S1", "S", 0), door("N1", "N", 0)], "Four-way junction.")
corr("V-COR-W", "Corridor · wide", 2, 1, [Z("CIRC", 0, 0, 2, 1)], [cargo("W1", "W", 0), cargo("E1", "E", 0)], "2U-wide main corridor (carts).")
block("V-PLAZA", "V", "Junction plaza", 3, 3, 1, zones=[Z("CIRC", 0, 0, 3, 3)], items=[I("round", 1.1, 1.1, .8, .8, "kiosk / planter")],
    conns=[door("N1", "N", 1), door("S1", "S", 1), door("W1", "W", 1), door("E1", "E", 1)], scale=("station", "hub", "mega"), desc="Where corridors meet; benches, signage.")
block("V-SEAL", "V", "Pressure bulkhead", 1, 1, 1, zones=[Z("AIRLOCK", 0, 0, 1, 1)], items=[I("box", .05, .45, .9, .1, "blast door")],
    conns=[door("N1", "N", 0), door("S1", "S", 0)], scale=("outpost", "station", "hub", "mega"), desc="Section seal; place every ≤ 16U on long runs.")
V0 = block("V0-LADDER", "V", "Ladder well", 1, 1, 1, zones=[Z("CIRC", 0, 0, 1, 1)], items=[I("box", .3, .06, .4, .12, "ladder"), I("cross", .2, .2, .6, .6, "hatch")],
    conns=[door("S1", "S", 0)], scale=("outpost", "station", "hub", "mega"), desc="Ladder through floor hatches.", tags=["stacks"])
variant(V0, "V0-TUBE", "Zero-G tube", items=[I("round", .15, .15, .7, .7, "hand-lines")], desc="Microgravity transit tube.", scale=["outpost", "station"])
V1 = block("V1-STAIR", "V", "Stair core", 2, 2, 1, zones=[Z("CIRC", 0, 0, 2, 2)],
    items=[I("box", .05, .5, .9, .75, "up 6"), I("box", 1.05, .5, .9, .63, "down 5"), I("box", .95, .5, .1, .75)], conns=[door("S1", "S", 0), door("E1", "E", 1)],
    scale=("station", "hub", "mega"), desc="Switchback, 11 risers per deck.", tags=["stacks"])
block("V1-STRAIGHT", "V", "Straight stair", 1, 3, 1, zones=[Z("CIRC", 0, 0, 1, 3)], items=[I("box", .1, .5, .8, 2.0, "11 risers")], conns=[door("N1", "N", 0), door("S1", "S", 0)],
    scale=("station", "hub", "mega"), base="V1-STAIR", desc="Open straight flight, in halls.")
block("V1-SPIRAL", "V", "Spiral stair", 1, 1, 1, zones=[Z("CIRC", 0, 0, 1, 1)], items=[I("round", .1, .1, .8, .8, "spiral")], conns=[door("S1", "S", 0)],
    scale=("hub", "mega"), wealth=("rich",), base="V1-STAIR", desc="Luxury duplex stair.", tags=["stacks"])
block("V1-TWIN", "V", "Twin stair core", 4, 2, 1, zones=[Z("CIRC", 0, 0, 4, 2)],
    items=[I("box", .05, .5, .9, .75, "up"), I("box", 1.05, .5, .9, .63, "dn"), I("box", 2.05, .5, .9, .75, "up"), I("box", 3.05, .5, .9, .63, "dn")], parts=[P(2, 0, 2, 1.3)],
    conns=[door("S1", "S", 0), door("S2", "S", 3), door("W1", "W", 1), door("E1", "E", 1)], scale=("hub", "mega"), base="V1-STAIR", desc="High-traffic pair.", tags=["stacks"])
V2 = block("V2-LIFT", "V", "Lift core", 3, 2, 1, zones=[Z("SHAFT", 0, 0, 2, 1), Z("CIRC", 2, 0, 1, 1), Z("CIRC", 0, 1, 3, 1)],
    items=[I("cross", .1, .1, .8, .8, "car"), I("cross", 1.1, .1, .8, .8, "car"), I("box", 2.3, .06, .4, .12, "ladder")], parts=[P(1, 0, 1, 1), P(2, 0, 2, 1), P(0, 1, .3, 1), P(.7, 1, 1.3, 1), P(1.7, 1, 2.3, 1), P(2.7, 1, 3, 1)],
    conns=[door("W1", "W", 1), door("E1", "E", 1), door("S1", "S", 1)], scale=("station", "hub", "mega"), desc="2 cars + ladder.", tags=["stacks"])
block("V2-FREIGHT", "V", "Freight lift", 2, 3, 1, zones=[Z("SHAFT", 0, 0, 2, 2), Z("CIRC", 0, 2, 2, 1)], items=[I("cross", .1, .1, 1.8, 1.8, "car 4 × 4 m")],
    parts=[P(0, 2, 2, 2)], conns=[cargo("S1", "S", 0, 2)], scale=("station", "hub", "mega"), base="V2-LIFT", desc="Cargo car; pairs with K1/T1.", tags=["stacks"])
block("V2-BANK4", "V", "Lift bank ×4", 5, 2, 1, zones=[Z("SHAFT", 0, 0, 4, 1), Z("CIRC", 4, 0, 1, 1), Z("CIRC", 0, 1, 5, 1)],
    items=[I("cross", .1 + i, .1, .8, .8, "car") for i in range(4)] + [I("box", 4.3, .06, .4, .12, "ladder")], conns=[door("W1", "W", 1), door("E1", "E", 1), door("S1", "S", 2)],
    scale=("hub", "mega"), base="V2-LIFT", desc="Shared-lobby bank.", tags=["stacks"])
block("V2-GLASS", "V", "Atrium glass lift", 2, 2, 1, zones=[Z("SHAFT", 0, 0, 1, 1), Z("CIRC", 0, 1, 2, 1)], items=[I("round", .1, .1, .8, .8, "glass car")],
    conns=[door("S1", "S", 0), door("E1", "E", 1)], hull=None, scale=("mega",), wealth=("rich",), base="V2-LIFT", desc="Runs up an L3 void edge.", tags=["stacks"])
V3 = block("V3-HUB", "V", "Transit hub", 16, 10, 2, zones=[Z("CIRC", 0, 0, 16, 7.5), Z("SHAFT", 2, 0, 11, 1), Z("PLATFORM", 0, 7.5, 16, 2.5), Z("LEISURE", 0, 2.2, .85, 2.4), Z("LEISURE", 15.15, 2.2, .85, 2.4)],
    items=[I("cross", 2 + i, 0, 1, 1) for i in range(6)] + [I("cross", 9 + i, 0, 1, 1) for i in range(4)] + [I("box", 0, 0, 2, 2, "stair"), I("box", 14, 0, 2, 2, "stair"), I("box", 6, 3.5, 4, 2, "grand stair"), I("round", 2.75, 4.05, .9, .9, "info")],
    conns=[plaza("W1", "W", 5), plaza("E1", "E", 5), plaza("P1", "S", 0, ) | {"w": 16, "type": "platform"}], spine="S", scale=("mega",), desc="Tram interchange.")
block("V3-SECTOR", "V", "Sector hub", 8, 6, 1, zones=[Z("CIRC", 0, 0, 8, 6), Z("SHAFT", 2, 0, 4, 1)],
    items=[I("cross", 2 + i, 0, 1, 1) for i in range(4)] + [I("box", 0, 0, 2, 2, "stair"), I("box", 6, 0, 2, 2, "stair"), I("round", 3.5, 3, 1, 1, "info")],
    conns=[plaza("W1", "W", 3), plaza("E1", "E", 3), plaza("S1", "S", 3)], scale=("hub", "mega"), base="V3-HUB", desc="No tram; sector-level lift lobby.")

# ============ DOCKING ============
D0 = block("D0-PORT", "D", "Docking port", 2, 2, 1, zones=[Z("AIRLOCK", .5, 0, 1, 1), Z("STORE", 0, 0, .5, 1), Z("STORE", 1.5, 0, .5, 1), Z("CIRC", 0, 1, 2, 1)],
    items=[I("box", .04, .04, .42, .92, "suits"), I("box", 1.54, .04, .42, .92, "suits"), I("round", .78, .28, .44, .44, "lock"), I("box", 1.7, 1.2, .26, .3, "cycle")],
    parts=[P(.5, 0, .5, 1), P(1.5, 0, 1.5, 1), P(.5, 1, .75, 1), P(1.25, 1, 1.5, 1)], conns=[dock("DK", "N", .6, .8), door("S1", "S", 0) | {"at": .75}], hull="N", scale=("outpost", "station", "hub", "mega"), desc="External docking collar + airlock.")
block("D0-TWIN", "D", "Twin docking port", 4, 2, 1, zones=[Z("AIRLOCK", .5, 0, 1, 1), Z("AIRLOCK", 2.5, 0, 1, 1), Z("CIRC", 0, 1, 4, 1), Z("STORE", 1.5, 0, 1, 1)],
    items=[I("round", .78, .28, .44, .44, "lock"), I("round", 2.78, .28, .44, .44, "lock"), I("box", 1.54, .04, .92, .9, "suits")],
    conns=[dock("DK1", "N", .6, .8), dock("DK2", "N", 2.6, .8), door("S1", "S", 1), door("S2", "S", 2)], hull="N", scale=("station", "hub"), base="D0-PORT", desc="Two collars, shared vestibule.")
block("D0-CARGOLOCK", "D", "Cargo airlock", 3, 3, 1, zones=[Z("AIRLOCK", 0, 0, 3, 2), Z("CARGO", 0, 2, 3, 1)],
    items=[I("dash", .5, .3, 2, 1.4, "pallet space"), I("box", 2.6, 2.2, .3, .6, "cycle")], parts=[P(0, 2, 1, 2), P(2, 2, 3, 2)],
    conns=[dock("DK", "N", .5, 2), cargo("S1", "S", 1)], hull="N", scale=("station", "hub", "mega"), base="D0-PORT", desc="2 m hatches for crates.")
block("D0-PODS", "D", "Escape-pod bay", 3, 2, 1, zones=[Z("AIRLOCK", 0, 0, 3, .8), Z("CIRC", 0, .8, 3, 1.2)],
    items=[I("round", .15 + i, .05, .7, .7, "pod") for i in range(3)], conns=[door("S1", "S", 1)], hull="N", scale=("outpost", "station", "hub", "mega"), base="D0-PORT", desc="3 pods; place ≤ 16U from every SLEEP.")
D1 = block("D1-PAD", "D", "Small landing bay", 8, 6, 3, zones=[Z("PAD", 0, 0, 8, 4.5), Z("CONTROL", 0, 4.5, 2.5, 1.5), Z("CIRC", 2.5, 4.5, 3, 1.5), Z("CARGO", 5.5, 4.5, 2.5, 1.5)],
    items=[I("dash", 1.5, .6, 5, 3.4, "pad"), I("box", 2.4, .9, 3.2, 2.5, "shuttle"), I("box", .3, 4.7, 1.9, .35, "console"), I("round", 5.8, 4.8, .6, .6, "fuel")],
    parts=[P(0, 4.5, 4.25, 4.5), P(4.75, 4.5, 6.25, 4.5), P(7.25, 4.5, 8, 4.5), P(2.5, 4.5, 2.5, 5.1), P(2.5, 5.5, 2.5, 6), P(5.5, 4.5, 5.5, 5.1), P(5.5, 5.5, 5.5, 6)],
    conns=[dock("BAY", "N", 0, 8), door("S1", "S", 3)], hull="N", cap="1 craft ≤ 12×8 m", scale=("outpost", "station"), desc="One-shuttle bay.")
variant(D1, "D1-OPEN", "Open pad", zones=[Z("PAD", 0, 0, 8, 6)], items=[I("dash", 1.5, .6, 5, 3.4, "pad"), I("box", 2.4, .9, 3.2, 2.5, "shuttle"), I("round", .3, 4.8, .6, .6, "fuel")], parts=[],
    conns=[dock("BAY", "N", 0, 8), door("S1", "S", 3)], height=1, desc="No doors; vacuum, EVA access only.", wealth=["poor"])
merge("D1-TWIN", "D", "Twin landing bay", [(D1, 0, 0), (flip_x(D1), 8, 0)], 16, 6, conns=[dock("BAY", "N", 0, 16), door("S1", "S", 3), door("S2", "S", 12)],
    extra_parts=[P(8, 0, 8, 4.5)], hull="N", cap="2 craft", scale=("station", "hub"), base="D1-PAD", desc="Two bays, shared service wall.")
variant(D1, "D1-BELLY", "Ship belly bay", **{k: v for k, v in flip_y(D1).items() if k in ("zones", "items", "parts", "conns", "hull")}, desc="Ship variant: doors in the belly (S).", scale=["outpost"])
D2 = block("D2-HANGAR", "D", "Hangar deck", 16, 12, 4, zones=[Z("PAD", 0, 0, 16, 8), Z("CONTROL", 0, 8, 3, 4), Z("WORK", 3, 8, 4, 4), Z("MACHINE", 7, 8, 2.5, 4), Z("CIRC", 9.5, 8, 2.5, 4), Z("CARGO", 12, 8, 4, 4)],
    items=[I("dash", .75, 1, 4.5, 6, "pad 1"), I("dash", 5.75, 1, 4.5, 6, "pad 2"), I("dash", 10.75, 1, 4.5, 6, "pad 3"), I("box", 1.2, 1.5, 3.6, 4.8, "craft"), I("box", 6.2, 1.5, 3.6, 4.8, "craft"),
           I("round", 7.2, 9.7, 1.2, 1.2, "fuel")],
    parts=[P(0, 8, 4, 8), P(6, 8, 10.5, 8), P(11, 8, 13, 8), P(15, 8, 16, 8), P(3, 8, 3, 12), P(7, 8, 7, 12), P(9.5, 8, 9.5, 12), P(12, 8, 12, 12)],
    conns=[dock("BAY", "N", 0, 16), door("W1", "W", 10), door("S1", "S", 10), cargo("S2", "S", 13, 2)], hull="N", cap="3 craft", scale=("station", "hub"), desc="Three-berth hangar.")
variant(D2, "D2-REPAIR", "Hangar · repair cradle", items=D2["items"][:2] + [I("box", 1.2, 1.5, 3.6, 4.8, "craft"), I("dash", 10.75, 1, 4.5, 6, "cradle"), I("box", 11, 1.2, 4, 5.6, "scaffold")], desc="Berth 3 is a repair cradle.")
variant(D2, "D2-FIGHTER", "Hangar · fighter racks", items=[I("box", 1 + (i % 7) * 2, 1 + (i // 7) * 3.2, 1.6, 2.6, "fighter") for i in range(14)], cap="14 small craft (2 tiers)", desc="Military rack hangar.")
D3 = block("D3-DECK", "D", "Flight deck", 40, 24, 8, zones=[Z("PAD", 0, 0, 40, 18), Z("CONTROL", 0, 18, 6, 6), Z("CARGO", 6, 18, 14, 6), Z("MACHINE", 20, 18, 8, 6), Z("WORK", 28, 18, 12, 6)],
    items=[I("dash", 4, 2, 20, 15.5, "heavy berth"), I("box", 8, 3, 12, 14, "freighter"), I("dash", 26, 2, 10, 7, "medium A"), I("dash", 26, 10.5, 10, 7, "medium B"), I("round", 20.7, 19.5, 3, 3, "fuel"), I("round", 24.3, 19.5, 3, 3, "fuel"), I("dash", 30, 19, 8, 4, "cradle")],
    parts=[P(0, 18, 9, 18), P(13, 18, 15, 18), P(19, 18, 40, 18), P(6, 18, 6, 24), P(20, 18, 20, 24), P(28, 18, 28, 24)],
    conns=[dock("FIELD", "N", 0, 40), cargo("S1", "S", 9, 4), cargo("S2", "S", 15, 4), door("W1", "W", 21), door("E1", "E", 21)], hull="N", cap="1 heavy + 2 medium", scale=("mega",), desc="Megastation flight deck.")
block("D3-TERMINAL", "D", "Passenger terminal", 24, 16, 4, zones=[Z("PAD", 0, 0, 24, 8), Z("CIRC", 0, 8, 24, 8), Z("CONTROL", 0, 8, 4, 3)],
    items=[I("dash", 1, 1, 10, 6, "liner berth"), I("dash", 13, 1, 10, 6, "liner berth")] + [I("box", 5 + i * 2.5, 9, 2, 1, "gate") for i in range(6)] + [I("box", 5, 12, 14, .6, "customs line"), I("box", 2, 14, 20, 1.2, "lounge seating")],
    parts=[P(0, 8, 24, 8)], conns=[dock("BAY", "N", 0, 24), plaza("S1", "S", 11), plaza("W1", "W", 12)], hull="N", cap="2 liners · [TBD] pax", scale=("hub", "mega"), wealth=("std", "rich"), base="D3-DECK", desc="Gates, customs and a lounge.")
merge("D3-TWIN", "D", "Twin heavy deck", [(D3, 0, 0), (flip_x(D3), 24, 0)], 64, 24, conns=[dock("FIELD", "N", 0, 64), cargo("S1", "S", 9, 4), cargo("S2", "S", 51, 4)],
    hull="N", cap="2 heavy + 4 medium", scale=("mega",), base="D3-DECK", desc="Two decks sharing the central medium berths.")

# ============ COMMAND ============
C0 = block("C0-BRIDGE", "C", "Bridge", 3, 3, 1, zones=[Z("CMD", 0, 0, 3, 3)],
    items=[I("box", .3, .1, 2.4, .35, "helm"), I("round", .9, .6, .3, .3), I("round", 1.8, .6, .3, .3), I("box", .05, 1.2, .3, .8, "sens"), I("box", 2.65, 1.2, .3, .8, "comms"), I("round", 1.3, 1.95, .4, .4, "capt"), I("box", .05, 2.6, .9, .35, "suits")],
    conns=[door("S1", "S", 1)], hull="N", spine="W", cap="5", scale=("outpost", "station"), desc="Ship/outpost bridge.")
block("C0-COCKPIT", "C", "Cockpit", 2, 2, 1, zones=[Z("CMD", 0, 0, 2, 2)], items=[I("box", .2, .1, 1.6, .35, "helm"), I("round", .5, .6, .3, .3), I("round", 1.2, .6, .3, .3)],
    conns=[door("S1", "S", 0) | {"at": .75}], hull="N", cap="2", scale=("outpost",), base="C0-BRIDGE", desc="Shuttle cockpit.")
block("C0-TACTICAL", "C", "Bridge · tactical", 4, 3, 1, zones=[Z("CMD", 0, 0, 4, 3)],
    items=[I("box", .4, .1, 3.2, .35, "helm"), I("box", .05, 1.2, .3, .8, "sens"), I("box", 3.65, 1.2, .3, .8, "weapons"), I("round", 1.6, 1.0, .8, .8, "tac holo"), I("round", 1.8, 2.2, .4, .4, "capt")],
    conns=[door("S1", "S", 1), door("S2", "S", 2)], hull="N", cap="7", scale=("station",), base="C0-BRIDGE", desc="Adds a tactical station.")
C1 = block("C1-OPS", "C", "Ops room", 6, 5, 2, zones=[Z("CMD", 0, 0, 6, 5), Z("MACHINE", 0, 4, 1, 1)],
    items=[I("box", .5, .05, 5, .12, "screen wall"), I("box", .8, 1, 4.4, .3, "row 1"), I("box", .8, 2.1, 4.4, .3, "row 2"), I("round", 2.7, 3.35, .6, .6, "holo"), I("box", .1, 4.1, .7, .8, "comms")],
    parts=[P(0, 4, 1, 4), P(1, 4, 1, 4.3), P(1, 4.7, 1, 5)], conns=[door("S1", "S", 2), door("E1", "E", 4, True)], spine="W", cap="~16", scale=("station", "hub", "mega"), desc="Tiered ops room.")
variant(C1, "C1-TRAFFIC", "Traffic control", items=C1["items"] + [I("box", 5.2, 3.2, .7, .7, "radar")], desc="Faces the hangar; links D2/D3.")
block("C1-SECURITY", "C", "Security ops + brig", 6, 5, 1, zones=[Z("CMD", 0, 0, 6, 3), Z("CONTROL", 0, 3, 6, 2)],
    items=[I("box", .5, .05, 5, .12, "cams"), I("box", .8, 1, 4.4, .3, "desks"), I("box", .3, 1.8, 1.2, .6, "armoury")] + [I("box", .1 + i * 1.5, 3.1, 1.3, 1.8, "cell") for i in range(4)],
    parts=[P(0, 3, 6, 3)] + [P(1.5 * i, 3, 1.5 * i, 5) for i in range(1, 4)], conns=[door("S1", "S", 0) | {"at": 0.05}, door("W1", "W", 1)], spine="N", cap="8 staff · 4 cells", scale=("station", "hub", "mega"), base="C1-OPS", desc="Guard post with holding cells.")
block("C1-ONEROW", "C", "Ops room · 1 row", 6, 3, 1, zones=[Z("CMD", 0, 0, 6, 3)], items=[I("box", .5, .05, 5, .12, "screens"), I("box", .8, 1, 4.4, .3, "consoles"), I("round", 2.7, 2.0, .6, .6, "holo")],
    conns=[door("S1", "S", 2)], spine="W", cap="~8", scale=("outpost", "station"), base="C1-OPS", desc="Small-station ops.")
C2 = block("C2-COMMAND", "C", "Command centre", 20, 14, 4, zones=[Z("CMD", 0, 0, 20, 14), Z("MACHINE", 17, 0, 3, 5), Z("CONTROL", 17.5, 10, 2.5, 4)],
    items=[I("box", 3.2, .1, 13.6, .25, "screen wall"), I("round", 7.5, 3.5, 5, 5, "strategic holo"), I("round", 4, 1.5, 12, 12, "tiers"), I("box", .5, 1.5, 2, 2, "briefing"), I("box", 8.5, 8.7, 3, .8, "commander")],
    parts=[P(0, 5, 1.25, 5), P(1.75, 5, 3, 5), P(3, 5, 3, 0), P(17, 0, 17, 5), P(17, 5, 18.25, 5), P(18.75, 5, 20, 5), P(0, 10, 2.5, 10), P(2.5, 10, 2.5, 11.5), P(2.5, 12, 2.5, 14), P(20, 10, 17.5, 10), P(17.5, 10, 17.5, 11.5), P(17.5, 12, 17.5, 14)],
    conns=[plaza("S1", "S", 9), door("W1", "W", 7), door("E1", "E", 7)], cap="~60", scale=("mega",), desc="Megastation nerve centre.")
block("C2-BACKUP", "C", "Backup command", 12, 10, 2, zones=[Z("CMD", 0, 0, 12, 10)],
    items=[I("box", 1, .1, 10, .25, "screens"), I("round", 4.5, 2.5, 3, 3, "holo"), I("round", 2.5, 1.5, 7, 7, "tier")],
    conns=[plaza("S1", "S", 5), door("W1", "W", 5)], cap="~20", scale=("hub", "mega"), base="C2-COMMAND", desc="Armoured fallback centre, one tier.")
block("C2-BOARD", "C", "Corporate boardroom", 10, 8, 2, zones=[Z("CMD", 0, 0, 10, 8), Z("ENTRY", 0, 6, 10, 2)],
    items=[I("round", 2, 1, 6, 4, "board ring"), I("box", 1, .1, 8, .2, "screen"), I("box", .5, 6.4, 3, .6, "reception")], parts=[P(0, 6, 4.5, 6), P(5.5, 6, 10, 6)],
    conns=[plaza("S1", "S", 4)], hull="N", cap="16 seats", scale=("hub", "mega"), wealth=("rich",), base="C2-COMMAND", desc="Tiers become a board ring.")
C3 = block("C3-CAPTAIN", "C", "Captain's cabin", 4, 3, 1, zones=[Z("CMD", 0, 0, 2.5, 3), Z("SLEEP", 2.5, 0, 1.5, 2), Z("WET", 3, 2, 1, 1)],
    items=[I("box", .3, .08, 1.4, .4, "desk"), I("box", .04, 1.8, .35, 1.0, "couch"), I("box", 1.9, .08, .3, .3, "safe"), I("bed", 2.96, .08, 1.0, .8, "berth"), I("cross", 3.05, 2.5, .45, .45, "sh"), I("round", 3.68, 2.1, .24, .3, "wc")],
    parts=[P(2.5, 1.3, 2.5, 1.3), P(2.5, 1.75, 2.5, 2), P(2.5, 2, 3, 2), P(3, 2, 3, 2.3), P(3, 2.75, 3, 3), P(3, 2, 4, 2)], conns=[door("S1", "S", 0)], spine="N", cap="1", scale=("outpost", "station"), desc="Office + berth + wet.")
block("C3-TINY", "C", "Captain's cabin · tiny", 2, 2, 1, zones=[Z("CMD", 0, 0, 2, 2)], items=[I("bed", 1.0, .04, .96, .45, "berth"), I("dash", .04, .04, .8, .3, "fold desk"), I("box", .04, 1.5, .5, .46, "lk")],
    conns=[door("S1", "S", 1)], cap="1", scale=("outpost",), wealth=("poor",), base="C3-CAPTAIN", desc="Small-ship cabin.")
variant(C3, "C3-TRADER", "Captain's cabin · trader", items=C3["items"] + [I("cross", 1.7, 2.3, .6, .6, "vault")], desc="Manifest office with a cargo vault.")
C4 = block("C4-SUITE", "C", "Commander's suite", 8, 6, 1, zones=[Z("ENTRY", 0, 0, 2.5, 3), Z("CMD", 2.5, 0, 3.5, 3), Z("CMD", 0, 3, 3.5, 3), Z("LIVE", 3.5, 3, 2, 3), Z("SLEEP", 5.5, 3, 2.5, 3), Z("WET", 6, 0, 2, 1.5), Z("STORE", 6, 1.5, 2, 1.5)],
    items=[I("box", .4, .3, 1.4, .35, "aide"), I("box", 3.4, .6, 1.6, .5, "desk"), I("round", 2.85, 1.95, .7, .7, "holo"), I("box", .6, 3.9, 2.3, 1.2, "conf 10"), I("bed", 6.96, 4, 1, 1, "king"), I("round", 6.1, .1, 1, .5, "tub")],
    parts=[P(2.5, 0, 2.5, 1.9), P(2.5, 2.35, 2.5, 3), P(0, 3, 1, 3), P(1.45, 3, 4.2, 3), P(4.65, 3, 6.6, 3), P(7.05, 3, 8, 3), P(3.5, 3, 3.5, 6), P(5.5, 3, 5.5, 4.2), P(5.5, 4.65, 5.5, 6), P(6, 0, 6, 3), P(6, 1.5, 6.6, 1.5), P(7.05, 1.5, 8, 1.5)],
    conns=[door("W1", "W", 1), door("S1", "S", 4, True)], hull="N", cap="1–2 + aide", scale=("hub", "mega"), wealth=("std", "rich"), desc="Public → office → private.")
block("C4-POOR", "C", "Commander's office", 5, 6, 1, zones=[Z("ENTRY", 0, 0, 2.5, 3), Z("CMD", 2.5, 0, 2.5, 3), Z("CMD", 0, 3, 5, 3)],
    items=[I("box", .4, .3, 1.4, .35, "aide"), I("box", 3, .6, 1.6, .5, "desk"), I("box", .6, 3.9, 3.8, 1.2, "conference")],
    parts=[P(2.5, 0, 2.5, 1.9), P(2.5, 2.35, 2.5, 3), P(0, 3, 1, 3), P(1.45, 3, 5, 3)], conns=[door("W1", "W", 1)], cap="1 + aide", scale=("station",), wealth=("poor",), base="C4-SUITE", desc="No private wing.")
block("C4-WARLORD", "C", "Audience hall", 8, 8, 2, zones=[Z("CMD", 0, 0, 8, 8), Z("SLEEP", 6, 0, 2, 3)],
    items=[I("box", 3, .5, 2, 1, "throne dais"), I("box", 1, 2.5, .3, 5), I("box", 6.7, 3.5, .3, 4), I("dash", 2, 2.5, 4, 5, "audience floor"), I("bed", 6.96, .5, 1, 1, "")],
    parts=[P(6, 0, 6, 3), P(6, 3, 8, 3)], conns=[plaza("S1", "S", 3), door("E1", "E", 1)], cap="1 + court", scale=("station", "hub"), wealth=("rich",), base="C4-SUITE", desc="Office becomes an audience hall.")

# ============ CARGO ============
def slots(x0, y0, cols, rows, lab=""):
    return [I("solid", x0 + c + .06, y0 + r + .06, .88, .88, lab) for c in range(cols) for r in range(rows)]
K0 = block("K0-HOLD", "K", "Cargo hold", 4, 3, 1, zones=[Z("CARGO", 0, 0, 4, 3), Z("STORE", 3, 0, 1, 2.5)],
    items=slots(0, 0, 2, 2) + [I("dash", 2.06, .06, .88, .88, "free"), I("dash", 2.06, 1.06, .88, .88, "free"), I("box", 3.1, .04, .86, 1.5, "racks")],
    conns=[cargo("S2", "S", 1), door("W1", "W", 2)], spine="N", cap="6 slots", scale=("outpost", "station"), desc="1 grid square = 1 container.")
variant(K0, "K0-TALL", "Cargo hold · 2U", height=2, cap="12 slots", items=slots(0, 0, 3, 2, "×2") + [I("box", 3.1, .04, .86, 1.5, "racks")], desc="Stacks two high.")
variant(K0, "K0-COLD", "Reefer hold", zones=[Z("COLD", 0, 0, 4, 3)], desc="Refrigerated containers.")
variant(K0, "K0-HAZMAT", "Hazmat hold", zones=[Z("CARGO", 0, 0, 4, 3), Z("RAD", 3, 0, 1, 2.5)], items=slots(0, 0, 2, 2) + [I("cross", 3.1, .1, .8, .6, "sealed"), I("cross", 3.1, .8, .8, .6, "sealed"), I("cross", 3.1, 1.5, .8, .6, "sealed")], desc="Sealed lockers.")
variant(K0, "K0-SMUGGLER", "Hold · smuggler", items=K0["items"] + [I("dash", .5, 2.05, 1.4, .7, "hidden sub-floor")], desc="Hidden 0.5U cache.", wealth=["poor"])
K1 = block("K1-BAY", "K", "Cargo bay", 10, 8, 3, zones=[Z("CARGO", 0, 0, 10, 8), Z("CONTROL", 0, 6.5, 3, 1.5), Z("SHAFT", 8, 6, 2, 2)],
    items=slots(1, 1, 6, 2, "×3") + slots(1, 4, 6, 2, "×3") + [I("box", 8.1, 1.2, 1.2, .8, "cart"), I("box", 8.1, 2.6, 1.2, .8, "cart"), I("cross", 8.1, 6.1, 1.8, 1.8, "lift"), I("box", .3, 6.8, 1.8, .35, "office")],
    parts=[P(0, 6.5, 1.2, 6.5), P(1.7, 6.5, 3, 6.5), P(3, 6.5, 3, 8), P(8, 8, 8, 6), P(8, 6, 8.5, 6), P(9.5, 6, 10, 6)],
    conns=[cargo("E1", "E", 2, 2), cargo("S2", "S", 4, 2), door("S1", "S", 1)], cap="72 containers", scale=("station", "hub"), desc="Stacks under a crane.")
variant(K1, "K1-TANKS", "Tank farm", items=[I("round", 1 + i * 2, 1 + j * 2.7, 1.8, 1.8, "tank") for i in range(3) for j in range(2)] + [I("cross", 8.1, 6.1, 1.8, 1.8, "lift"), I("box", .3, 6.8, 1.8, .35, "office")], cap="6 tanks · fluids/ore", desc="Bulk liquids and slurry.")
variant(K1, "K1-CUSTOMS", "Bonded customs bay", items=slots(1, 1, 6, 2, "×3") + [I("dash", 1, 4, 4, 2, "inspection cage"), I("box", 5.5, 4.2, 1.5, .5, "scanner"), I("cross", 8.1, 6.1, 1.8, 1.8, "lift"), I("box", .3, 6.8, 1.8, .35, "office")], cap="36 containers", desc="Inspection cage and scanner.")
K2 = block("K2-WAREHOUSE", "K", "Automated warehouse", 32, 20, 8, zones=[Z("CARGO", 0, 0, 32, 17), Z("CONTROL", 0, 17, 5, 3), Z("MACHINE", 5, 17, 7, 3), Z("WORK", 12, 17, 6, 3), Z("SHAFT", 18, 17, 8, 3), Z("CIRC", 26, 17, 6, 3)],
    items=[I("solid", 3, 2 + i * 3, 22, 1, "racks ×8") for i in range(5)] + [I("round", 26.5, 2.5, 3.5, 12, "sorter")] + [I("cross", 18 + i * 2, 17, 2, 3) for i in range(4)],
    parts=[P(0, 17, 2, 17), P(3, 17, 6, 17), P(7, 17, 13, 17), P(14, 17, 18, 17), P(26, 17, 28, 17), P(29, 17, 32, 17), P(5, 17, 5, 20), P(12, 17, 12, 20), P(18, 17, 18, 20), P(26, 17, 26, 20)],
    conns=[cargo("W%d" % (i + 1), "W", 2 + 4 * i, 2) for i in range(4)] + [cargo("E1", "E", 4, 2), cargo("E2", "E", 14, 2), door("S1", "S", 28)], cap="~880 containers", scale=("mega",), desc="Robot high-bay.")
variant(K2, "K2-MANUAL", "Warehouse · manual", height=4, items=[I("solid", 3, 2 + i * 3, 22, 1, "racks ×3") for i in range(5)], cap="~330 containers", wealth=["poor"], scale=["hub", "mega"], desc="Forklift aisles, 4U tall.")
variant(K2, "K2-SILO", "Bulk silo hall", items=[I("round", 2 + (i % 6) * 4.5, 2 + (i // 6) * 7, 4, 4, "silo") for i in range(12)], cap="12 silos · ore/grain", desc="Hoppers for bulk material.")
block("K-VAULT", "K", "Secure vault", 3, 3, 1, zones=[Z("CARGO", 0, 0, 3, 3), Z("AIRLOCK", 0, 2, 3, 1)], items=slots(0, 0, 3, 2, "sec") , parts=[P(0, 2, 1.25, 2), P(1.75, 2, 3, 2)],
    conns=[door("S1", "S", 1)], cap="6 slots", scale=("station", "hub", "mega"), wealth=("rich",), desc="Bank/cartel vault with a mantrap.")

# ============ PROCESSING ============
P1 = block("P1-INTAKE", "P", "Ore intake & crushing", 8, 6, 3, zones=[Z("ORE", 0, 0, 3, 6), Z("MACHINE", 3, 0, 5, 4.5), Z("CONTROL", 3, 4.5, 2.5, 1.5), Z("WORK", 5.5, 4.5, 2.5, 1.5)],
    items=[I("box", .3, .3, 2.4, 2.4, "receiving hopper"), I("dash", .3, 3.2, 2.4, 2.4, "grizzly screen"), I("box", 3.4, .4, 1.6, 1.4, "jaw crusher"), I("round", 5.6, .4, 1.6, 1.6, "cone crusher"),
           I("box", 3.2, 2.6, 4.6, .4, "conveyor →"), I("box", 3.3, 4.7, 2, .4, "console")],
    parts=[P(3, 4.5, 8, 4.5), P(5.5, 4.5, 5.5, 6), P(3, 0, 3, 3), P(3, 3.6, 3, 6)], conns=[dock("DUMP", "N", 0, 3), cargo("E1", "E", 2), door("S1", "S", 4)], spine="E",
    cap="[TBD] t/h", scale=("outpost", "station", "hub"), wealth=("poor", "std"), desc="Drones dump ore; two-stage crushing.")
block("P1-MILL", "P", "Grinding mill", 8, 4, 3, zones=[Z("MACHINE", 0, 0, 8, 4)], items=[I("round", .4, .4, 3, 3, "ball mill"), I("round", 4.2, .6, 2.6, 2.6, "rod mill"), I("box", 7.1, .3, .7, 3.4, "cyclones")],
    conns=[cargo("W1", "W", 1), cargo("E1", "E", 1)], spine="N", cap="[TBD] t/h", scale=("station", "hub"), base="P1-INTAKE", desc="Grinds crushed ore to slurry/powder.")
block("P2-SEPARATOR", "P", "Separation plant", 6, 6, 2, zones=[Z("MACHINE", 0, 0, 6, 4.5), Z("SLAG", 0, 4.5, 6, 1.5)],
    items=[I("box", .3 + (i % 3) * 1.9, .3 + (i // 3) * 1.9, 1.6, 1.6, "float cell") for i in range(6)] + [I("box", .3, 4.7, 5.4, .5, "tailings →")],
    conns=[cargo("W1", "W", 1), cargo("E1", "E", 1), cargo("S1", "S", 2)], spine="N", cap="[TBD] t/h", scale=("station", "hub", "mega"), desc="Flotation cells split ore from waste.")
block("P2-MAGSEP", "P", "Magnetic separator", 4, 4, 2, zones=[Z("MACHINE", 0, 0, 4, 4)], items=[I("round", .3, .3, 1.6, 1.6, "drum"), I("round", 2.1, .3, 1.6, 1.6, "drum"), I("box", .3, 2.4, 3.4, .5, "conc. / tails")],
    conns=[cargo("W1", "W", 1), cargo("E1", "E", 1)], spine="N", cap="iron ores", scale=("outpost", "station"), base="P2-SEPARATOR", desc="Low-g friendly iron separation.")
block("P2-CENTRIFUGE", "P", "Centrifuge separator", 4, 4, 2, zones=[Z("MACHINE", 0, 0, 4, 4)], items=[I("round", .5, .5, 3, 3, "centrifuge")],
    conns=[cargo("W1", "W", 1), cargo("E1", "E", 1)], spine="N", cap="microgravity", scale=("outpost", "station"), base="P2-SEPARATOR", desc="Spin replaces gravity for separation.")
P3 = block("P3-SMELTER", "P", "Smelter hall", 12, 10, 4, zones=[Z("HOT", 0, 0, 8, 7), Z("SLAG", 8, 0, 4, 4), Z("MACHINE", 8, 4, 4, 3), Z("CONTROL", 0, 7, 4, 3), Z("CARGO", 4, 7, 8, 3)],
    items=[I("round", 1, 1, 2.6, 2.6, "arc furnace A"), I("round", 4.4, 1, 2.6, 2.6, "arc furnace B"), I("box", .5, 4.5, 7, .5, "tapping runner"), I("round", 1.2, 5.3, 1.2, 1.2, "ladle"), I("round", 4.6, 5.3, 1.2, 1.2, "ladle"),
           I("dash", 8.4, .4, 3.2, 3.2, "slag pit"), I("box", 8.4, 4.4, 3.2, 1.2, "transformer"), I("box", .4, 7.4, 3.2, .5, "console"), I("solid", 4.5, 7.8, 1, 1, "ingots"), I("solid", 5.7, 7.8, 1, 1, "ingots")],
    parts=[P(0, 7, 12, 7), P(4, 7, 4, 8.3), P(4, 8.8, 4, 10), P(8, 0, 8, 7)], conns=[cargo("W1", "W", 2), cargo("S1", "S", 8, 2), door("S2", "S", 1), cargo("E1", "E", 1)], spine="N", hull=None,
    cap="[TBD] t/day", scale=("station", "hub"), wealth=("poor", "std"), desc="Two electric arc furnaces with ladle crane.", tags=["exclusion:SLEEP 6U", "heat:high"])
block("P3-SMALL", "P", "Smelter · outpost", 6, 6, 3, zones=[Z("HOT", 0, 0, 6, 4), Z("CONTROL", 0, 4, 3, 2), Z("CARGO", 3, 4, 3, 2)],
    items=[I("round", 1.7, .6, 2.6, 2.6, "arc furnace"), I("round", .3, 3.1, .8, .8, "ladle"), I("box", .3, 4.3, 2.4, .4, "console"), I("solid", 3.5, 4.5, 1, 1, "ingots")],
    parts=[P(0, 4, 6, 4), P(3, 4, 3, 6)], conns=[cargo("W1", "W", 1), door("S1", "S", 1), cargo("S2", "S", 4)], spine="N", cap="[TBD] t/day", scale=("outpost",), wealth=("poor",), base="P3-SMELTER",
    desc="One furnace; mining outposts.", tags=["exclusion:SLEEP 6U"])
block("P3-SOLAR", "P", "Solar furnace", 10, 8, 3, zones=[Z("HOT", 0, 0, 10, 5), Z("CONTROL", 0, 5, 4, 3), Z("CARGO", 4, 5, 6, 3)],
    items=[I("round", 3.5, 1, 3, 3, "focus crucible"), I("box", .5, .2, 9, .4, "mirror feed (hull)"), I("box", .4, 5.4, 3.2, .5, "console"), I("solid", 5, 6, 1, 1, "ingots"), I("solid", 6.2, 6, 1, 1, "ingots")],
    parts=[P(0, 5, 10, 5), P(4, 5, 4, 8)], conns=[cargo("W1", "W", 2), door("S1", "S", 1), cargo("S2", "S", 6, 2)], hull="N", cap="[TBD] t/day", scale=("outpost", "station"), base="P3-SMELTER",
    desc="Mirror-fed furnace on a sunward hull face.")
P4 = block("P4-REFINERY", "P", "Electrolytic refinery", 10, 8, 3, zones=[Z("MACHINE", 0, 0, 10, 5), Z("WET", 0, 5, 3, 3), Z("CONTROL", 3, 5, 3, 3), Z("CARGO", 6, 5, 4, 3)],
    items=[I("box", .4 + i * 1.55, .4, 1.3, 3.8, "cells") for i in range(6)] + [I("box", .3, 5.4, 2.4, 2.2, "acid & rectifier"), I("box", 3.3, 5.4, 2.4, .5, "console"), I("solid", 6.5, 5.5, 1, 1, "cathode"), I("solid", 7.7, 5.5, 1, 1, "cathode")],
    parts=[P(0, 5, 10, 5), P(3, 5, 3, 8), P(6, 5, 6, 8)], conns=[cargo("W1", "W", 2), door("S1", "S", 4), cargo("S2", "S", 7, 2)], spine="N", cap="[TBD] t/day", scale=("station", "hub", "mega"),
    desc="Tank-house electrolysis to pure metal.")
block("P4-VOLATILES", "P", "Ice & volatiles plant", 8, 8, 3, zones=[Z("MACHINE", 0, 0, 8, 5), Z("COLD", 0, 5, 4, 3), Z("CONTROL", 4, 5, 4, 3)],
    items=[I("box", .3, .3, 2.4, 2, "ice melter"), I("box", 3, .3, 2, 2, "electrolyser"), I("round", 5.4, .3, 2.2, 2.2, "H₂"), I("round", 5.4, 2.7, 2.2, 2.2, "O₂"), I("round", .3, 5.3, 1.6, 1.6, "LOX"), I("round", 2.1, 5.3, 1.6, 1.6, "LH₂"), I("box", 4.4, 5.4, 3.2, .5, "console")],
    parts=[P(0, 5, 8, 5), P(4, 5, 4, 8)], conns=[cargo("W1", "W", 1), door("S1", "S", 5), cargo("E1", "E", 1)], spine="N", cap="water · fuel · O₂", scale=("outpost", "station", "hub"),
    desc="Comet/moon ice to water, propellant and air.", tags=["hazard:cryo", "hazard:H2"])
block("P4-CRACKER", "P", "Fuel cracking tower", 6, 6, 6, zones=[Z("MACHINE", 0, 0, 6, 4), Z("CONTROL", 0, 4, 6, 2)],
    items=[I("round", 1, .5, 3, 3, "column 6U"), I("round", 4.3, .5, 1.4, 1.4, "reboiler"), I("box", .3, 4.3, 5.4, .5, "console")],
    parts=[P(0, 4, 2.5, 4), P(3, 4, 6, 4)], conns=[cargo("W1", "W", 1), door("S1", "S", 2)], spine="N", cap="[TBD] fuel", scale=("hub", "mega"), base="P4-REFINERY", desc="Hydrocarbon/propellant refining.", tags=["hazard:fire"])
P5 = block("P5-FOUNDRY", "P", "Foundry", 10, 8, 3, zones=[Z("HOT", 0, 0, 6, 5), Z("WORK", 6, 0, 4, 5), Z("CARGO", 0, 5, 10, 3)],
    items=[I("round", .5, .5, 1.8, 1.8, "induction"), I("box", 2.8, .5, 2.8, 1.8, "mould line"), I("box", .5, 3, 5, 1.2, "cooling conveyor"), I("box", 6.4, .5, 3.2, 1.6, "fettling"), I("box", 6.4, 2.6, 3.2, 1.6, "CNC finish")] + slots(1, 5.5, 6, 2),
    parts=[P(0, 5, 10, 5), P(6, 0, 6, 5)], conns=[cargo("W1", "W", 2), cargo("E1", "E", 6), door("S1", "S", 8)], spine="N", cap="[TBD] parts/day", scale=("station", "hub"), desc="Casts hull plate, beams and parts.")
block("P5-ROLLING", "P", "Rolling mill line", 40, 8, 4, zones=[Z("HOT", 0, 0, 16, 8), Z("MACHINE", 16, 0, 16, 8), Z("CARGO", 32, 0, 8, 8)],
    items=[I("box", 1, 2.5, 5, 3, "reheat furnace"), I("box", 7, 3, 3, 2, "roughing"), I("box", 11, 3, 3, 2, "finishing"), I("box", 16, 3.5, 14, 1, "run-out table"), I("round", 30.5, 2.5, 3, 3, "coiler")] + slots(34, 1, 5, 6, "coil"),
    conns=[cargo("W1", "W", 3, 2), cargo("E1", "E", 3, 2), door("S1", "S", 20)], spine="N", cap="[TBD] t/day", scale=("mega",), base="P5-FOUNDRY", desc="Slab to plate and coil.", tags=["exclusion:SLEEP 8U", "heat:high"])
block("P6-SLAG", "P", "Slag & tailings works", 6, 6, 2, zones=[Z("SLAG", 0, 0, 6, 4), Z("CARGO", 0, 4, 6, 2)],
    items=[I("round", .4, .4, 2.2, 2.2, "granulator"), I("box", 3.2, .4, 2.4, 2.2, "brick press"), I("box", .4, 3, 5.2, .6, "conveyor")] + slots(.5, 4.2, 5, 1, "bricks"),
    conns=[cargo("W1", "W", 1), cargo("S1", "S", 2)], spine="N", cap="regolith bricks", scale=("outpost", "station", "hub"), desc="Waste becomes construction blocks.")
block("P6-SILO", "P", "Ore silo", 4, 4, 6, zones=[Z("ORE", 0, 0, 4, 4)], items=[I("round", .3, .3, 3.4, 3.4, "silo 6U")], conns=[cargo("S1", "S", 1, 2)], cap="[TBD] t", scale=("outpost", "station", "hub", "mega"), desc="Buffer between intake and plant.")
block("P7-MASSDRIVER", "P", "Mass-driver loader", 16, 4, 2, zones=[Z("MACHINE", 0, 0, 16, 4)],
    items=[I("box", .5, 1.4, 15, 1.2, "coil track →"), I("box", .5, .2, 3, 1, "bucket loader"), I("box", 12, .2, 3.5, .8, "capacitors")],
    conns=[cargo("W1", "W", 1, 2), dock("LAUNCH", "E", 1.5, 1)], hull="E", spine="N", cap="[TBD] t/day", scale=("outpost", "station"), desc="Throws refined metal to orbit.")
block("P9-MEGAPLANT", "P", "Integrated megaplant", 48, 24, 6, zones=[Z("ORE", 0, 0, 8, 24), Z("MACHINE", 8, 0, 12, 12), Z("HOT", 20, 0, 16, 12), Z("SLAG", 8, 12, 12, 12), Z("MACHINE", 20, 12, 16, 12), Z("CARGO", 36, 0, 12, 24)],
    items=[I("box", 1, 1, 6, 6, "intake"), I("round", 1, 9, 6, 6, "silo"), I("round", 1, 17, 6, 6, "silo"), I("box", 9, 1, 10, 4, "crush · mill"), I("box", 9, 6, 10, 5, "separation"),
           I("round", 21, 1, 6, 6, "furnace"), I("round", 29, 1, 6, 6, "furnace"), I("box", 21, 8, 14, 3, "casting"), I("box", 9, 13, 10, 10, "slag works"), I("box", 21, 13, 14, 10, "refinery tank-house")] + slots(37, 1, 10, 3) + slots(37, 20, 10, 3),
    conns=[dock("ORE", "W", 2, 6), cargo("E1", "E", 10, 4), door("S1", "S", 30)], spine="N", cap="[TBD] t/day", scale=("mega",), desc="Whole chain in one hull block: ore in W, metal out E.", tags=["exclusion:SLEEP 12U"])

# ---------- tidy: dashed areas that contain a labelled item lose their own label ----------
for b in BLOCKS:
    for a in b["items"]:
        if a["k"] != "dash" or not a.get("l"): continue
        ax, ay, aw, ah = a["r"]
        for o in b["items"]:
            if o is a or not o.get("l"): continue
            ox, oy, ow, oh = o["r"]
            if ox >= ax - 1e-6 and oy >= ay - 1e-6 and ox + ow <= ax + aw + 1e-6 and oy + oh <= ay + ah + 1e-6:
                a.pop("l", None); break

# ---------- validate ----------
errs = []
ids = set()
for b in BLOCKS:
    if b["id"] in ids: errs.append("dup " + b["id"])
    ids.add(b["id"])
    W, D = b["size"]
    for k in ("zones", "items"):
        for e in b[k]:
            x, y, w, h = e["r"]
            if x < -1e-6 or y < -1e-6 or x + w > W + 1e-6 or y + h > D + 1e-6: errs.append(f"{b['id']} {k} out {e}")
    for c in b["conns"]:
        L = W if c["face"] in ("N", "S") else D
        if c["at"] < -1e-6 or c["at"] + c["w"] > L + 1e-6: errs.append(f"{b['id']} conn out {c}")
print("\n".join(errs) or "ok", len(BLOCKS))

ZONES = {"SLEEP": "#20354a", "WET": "#183b3a", "LIVE": "#2a261d", "MESS": "#2a261d", "GALLEY": "#332c1f", "ENTRY": "#262b30", "STORE": "#262b30", "GARDEN": "#23402a",
         "COLD": "#1b3346", "MACHINE": "#2d2742", "WORK": "#2c3020", "CONTROL": "#3a2530", "RAD": "#3a2a1a", "TRUNK": "#173837", "LEISURE": "#4a2440", "CIRC": "#242e36",
         "SHAFT": "#1a2128", "PLATFORM": "#2a3036", "PAD": "#3b3515", "AIRLOCK": "#3a1f1f", "CMD": "#1f2b4d", "CARGO": "#33302a", "HOT": "#4a2616", "SLAG": "#2e2926", "ORE": "#3d3326"}
FAMILIES = {"H": "Housing", "F": "Food", "T": "Technical", "L": "Leisure", "V": "Circulation", "D": "Docking", "C": "Command", "K": "Cargo", "P": "Processing"}
out = {"schema": "station-interiors/blocks v0.2", "unit_m": 2, "zones": ZONES, "families": FAMILIES,
       "conventions": {"origin": "NW corner, x east, y south, U", "rect": "[x,y,w,h]", "conn.at": "offset in U along the face from its W (N/S faces) or N (E/W faces) end",
                       "item kinds": "box, bed, round, cross (shaft/shower/fab), dash (open area / folded / overhead), solid (container, pool, crop bed)",
                       "spine": "face with utility spine; RISER = own riser; MID = shared middle"}, "blocks": BLOCKS}
os.makedirs(os.path.dirname(os.path.abspath(__file__)) + "/out", exist_ok=True)
json.dump(out, open(os.path.dirname(os.path.abspath(__file__)) + "/out/blocks.json", "w"), ensure_ascii=False, separators=(",", ":"))
from collections import Counter
print(Counter(b["family"] for b in BLOCKS))
