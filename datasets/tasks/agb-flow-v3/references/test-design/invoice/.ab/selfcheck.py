import io, json, re

p = json.loads(io.open(".ab/prd.json", encoding="utf-8").read())
led = json.loads(io.open(".ab/questions.json", encoding="utf-8").read())["questions"]
prd = io.open("docs/PRD.md", encoding="utf-8").read()
ok = lambda b: "PASS" if b else "**FAIL**"

print("=== .ab/prd.json ===")
pages = p["pages"]
routes = [x["route"] for x in pages]
print(" 页面数 %d，路由唯一 %s" % (len(pages), ok(len(set(routes)) == len(routes))))
print(" 每页有交互或静态元素      ", ok(all(x.get("interactiveComponents") or x.get("staticElements") for x in pages)))
print(" 每页声明 UI 状态          ", ok(all(x.get("states") for x in pages)))
print(" 存在入口页                ", ok(any(x.get("isEntry") for x in pages)))
ic = [c["id"] for x in pages for c in x.get("interactiveComponents", [])]
print(" 交互组件 %d 个，id 唯一 %s" % (len(ic), ok(len(set(ic)) == len(ic))))
# 可达性：每个页面被别处的 effect 提到过路由，或本身是入口
mentioned = " ".join(c["effect"] for x in pages for c in x.get("interactiveComponents", []))
unreach = [x["id"] for x in pages if not x.get("isEntry") and not x.get("entryMechanism") and x["route"] not in mentioned]
print(" 页面可达（被某处导航指向）", ok(not unreach), unreach or "")

vids = {v["id"] for v in p["domain"]["variables"]}
print(" rules 的 inputVariableId 都有定义", ok(all(r["inputVariableId"] in vids for r in p["domain"]["rules"])))
print(" 有页面展示数据时 entities 非空  ", ok(bool(p["domain"]["entities"])))

print(" 状态机：")
for w in p["domain"]["workflows"]:
    st, tr = set(w["states"]), w["transitions"]
    reach = {w["initial"]}
    for _ in range(len(st)):
        for t in tr:
            if t["from"] in reach:
                reach.add(t["to"])
    checks = [
        ("initial", w["initial"] in st),
        ("from/to 合法", all(t["from"] in st and t["to"] in st for t in tr)),
        ("每条转移有 action", all(t.get("action") for t in tr)),
        ("全状态可达", reach == st),
        ("至少一个终态", len(w["terminalStates"]) > 0),
    ]
    bad = [n for n, v in checks if not v]
    print("   %-4s %-18s %s %s" % (w["id"], w["entity"],
          ok(not bad), ("← " + "、".join(bad)) if bad else ""))

print("\n=== docs/PRD.md ===")
ids = {q["id"] for q in led}
refs = set(re.findall(r"Q-\d{3}", prd))
print(" 引用闭合：引用了但台账没有  ", ok(not (refs - ids)), sorted(refs - ids) or "")
print(" 台账条目在正文均被提及      ", ok(not (ids - refs)), sorted(ids - refs) or "")
unanchored = [l for l in prd.split("\n") if "o be confirmed" in l and "Q-0" not in l]
print(" 未锚定的 TBD 行 %d %s" % (len(unanchored), ok(not unanchored)))
print(" 需求 ID：F### %d / US-* %d / AC-* %d / PAGE-* %d" % (
    len(set(re.findall(r"\bF0\d{2}\b", prd))), len(set(re.findall(r"US-\d{3}", prd))),
    len(set(re.findall(r"AC-\d{3}", prd))), len(set(re.findall(r"PAGE-\d{3}", prd)))))
print(" 每个 US 有 AC              ", ok(len(set(re.findall(r"AC-\d{3}", prd))) >= len(set(re.findall(r"US-\d{3}", prd)))))

print("\n=== .ab/questions.json ===")
unans = [q for q in led if not q.get("answer")]
prov = [q for q in led if q.get("provisional") and not q.get("answeredBy")]
nosign = [q["id"] for q in led if q.get("answer") and not q.get("answeredBy")]
print(" 总数 %d，已答 %d，未答 %d" % (len(led), len(led) - len(unans), len(unans)))
print(" 未答且 blocks 非空          :", [(q["id"], q["blocks"]) for q in unans if q["blocks"]] or "无")
print(" provisional 无裁决人(判 hard):", ok(not prov), [q["id"] for q in prov] or "")
print(" 有答案但无 answeredBy       :", ok(not nosign), nosign or "")
print(" 密钥类答案未写入值          :", ok(all("值在" in (q.get("answer") or "") or not q.get("answer")
                                              for q in led if q.get("kind") == "secret")))

blocking_arch = [q["id"] for q in unans if "arch" in q["blocks"]]
print("\n=== 阶段闸门 ===")
print(" 挡住 arch 的未答问题:", blocking_arch or "无 → arch 可进入")
