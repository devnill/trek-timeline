"""Print text around year mentions in fetched Memory Alpha wikitext. Usage: ma_context.py WIKITEXT_JSON TITLE YEAR..."""
import json, re, sys
d = json.load(open(sys.argv[1]))
t = d[sys.argv[2]]
t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t); t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
for y in sys.argv[3:]:
    for m in list(re.finditer(y, t))[:3]:
        print(f"  {y}: …{t[max(0, m.start()-220):m.end()+120]}…".replace("\n", " "))
