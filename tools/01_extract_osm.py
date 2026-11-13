"""Stage 1: pull the features we need out of a raw Geofabrik OSM extract.

Input : /tmp/geo/sz.osm.pbf  (Geofabrik 'southern-zone' India extract, ODbL)
Output: /tmp/geo/osm_*.pkl   (geometry in metres from scene origin, EPSG:32643 based)
"""
import osmium, pickle, sys, time, numpy as np
from config import *

W, S, E, Nn = BBOX
def inb(lon, lat): return W <= lon <= E and S <= lat <= Nn

HW_KEEP = {'motorway','trunk','primary','secondary','tertiary','motorway_link','trunk_link','primary_link',
           'secondary_link','tertiary_link','residential','unclassified','living_street','service','pedestrian',
           'construction','road'}
AREA_KEYS = ('natural','water','landuse','leisure','aeroway','amenity','building','boundary','waterway','man_made','military','tourism')
TAGK = ('name','name:kn','name:en','ref','oneway','lanes','bridge','tunnel','layer','junction','construction','highway',
        'railway','service','usage','colour','network','station','subway','natural','water','landuse','leisure','aeroway','amenity',
        'building','building:levels','height','boundary','admin_level','waterway','wetland','man_made','military','tourism',
        'place','public_transport','shop','route','line','covered','sport','operator','proposed','opening_date','start_date')
def tg(o): return {k: o.tags[k] for k in TAGK if k in o.tags}

roads, rails, nodes, areas, rels, waterways = [], [], [], [], [], []
bld_xy, bld_off, bld_tags = [], [0], []
wkb = osmium.geom.WKBFactory()
t0 = time.time(); n = 0
fp = (osmium.FileProcessor(RAW + '/sz.osm.pbf')
      .with_locations('sparse_file_array,' + RAW + '/nodes.idx')
      .with_areas()
      .with_filter(osmium.filter.KeyFilter('highway','railway','place','route','public_transport','shop', *AREA_KEYS)))
for o in fp:
    n += 1
    if n % 2000000 == 0: print(n, time.time() - t0, len(roads), len(bld_tags), flush=True)
    if o.is_node():
        if not inb(o.location.lon, o.location.lat): continue
        t = o.tags
        if ('place' in t or 'railway' in t or t.get('highway') in ('traffic_signals','bus_stop')
            or 'tourism' in t or t.get('amenity') in ('marketplace','bus_station','cafe','restaurant','fuel','place_of_worship','hospital')
            or 'shop' in t or 'aeroway' in t):
            nodes.append((o.id, o.location.lon, o.location.lat, tg(o)))
    elif o.is_way():
        t = o.tags
        hw, rw, ww = t.get('highway'), t.get('railway'), t.get('waterway')
        if not ((hw in HW_KEEP) or rw or ww in ('river','stream','canal','drain')): continue
        try:
            pts = [(nd.lon, nd.lat) for nd in o.nodes if nd.location.valid()]
        except Exception: continue
        if len(pts) < 2 or not any(inb(*p) for p in (pts[0], pts[-1], pts[len(pts)//2])): continue
        rec = (o.id, np.array(pts), tg(o), o.nodes[0].ref, o.nodes[-1].ref)
        if hw in HW_KEEP: roads.append(rec)
        elif rw: rails.append(rec)
        else: waterways.append(rec)
    elif o.is_relation():
        t = o.tags
        if t.get('route') in ('subway','light_rail','train','monorail') or t.get('type') == 'route_master':
            rels.append((o.id, tg(o), [(m.type, m.ref, m.role) for m in o.members]))
    elif o.is_area():
        t = o.tags
        first = None
        for ring in o.outer_rings():
            for nd in ring:
                first = (nd.lon, nd.lat); break
            break
        if first is None or not inb(*first): continue
        if 'building' in t:
            for ring in o.outer_rings():
                pts = [(nd.lon, nd.lat) for nd in ring]
                bld_xy.extend(pts); bld_off.append(len(bld_xy))
                bld_tags.append((t.get('building'), t.get('building:levels'), t.get('height'), t.get('name'), t.get('amenity'), t.get('shop'), t.get('office')))
            if not ('name' in t and ('tourism' in t or 'amenity' in t or 'leisure' in t)): continue
        keep = (t.get('natural') in ('water','wetland','wood','scrub','grassland','bare_rock') or 'water' in t
                or t.get('landuse') or t.get('leisure') or t.get('aeroway') or t.get('military')
                or t.get('amenity') in ('university','college','school','hospital','bus_station','marketplace','parking','research_institute')
                or (t.get('boundary') == 'administrative') or t.get('man_made') in ('wastewater_plant',) or ('building' in t)
                or t.get('tourism') in ('attraction','zoo','museum'))
        if not keep: continue
        try:
            g = wkb.create_multipolygon(o)
        except Exception: continue
        areas.append((o.orig_id(), o.from_way(), g, tg(o)))

print('done pass', time.time() - t0, len(roads), len(rails), len(nodes), len(areas), len(bld_tags), flush=True)
pickle.dump(dict(roads=roads, rails=rails, waterways=waterways, nodes=nodes, rels=rels), open(RAW + '/osm_lines.pkl', 'wb'), 4)
pickle.dump(areas, open(RAW + '/osm_areas.pkl', 'wb'), 4)
pickle.dump(dict(xy=np.array(bld_xy), off=np.array(bld_off), tags=bld_tags), open(RAW + '/osm_buildings.pkl', 'wb'), 4)
print('saved')
