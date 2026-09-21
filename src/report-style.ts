/**
 * Page chrome shared by the canonical report pages (`report-v2.ts` for one
 * step, `report-workflow.ts` for the workflow above them) so the two never
 * drift into two different-looking reports. Layer-neutral: no legacy import.
 */

export const PAGE_STYLE = `
:root{--ground:#F7F8FB;--ground-top:#EEF1F6;--surface:#fff;--surface-2:#F6F7FA;--ink:#0F172A;--ink-2:#667085;--ink-3:#98A2B3;--rule:#E6E8EC;--accent:#C81E3A;--accent-2:#E4572E;--accent-soft:rgba(200,30,58,.07);--champ:#F1FAF3;--ok-bg:#DCFCE7;--ok-fg:#16A34A;--bad-bg:#FEE2E2;--bad-fg:#DC2626;--warn-bg:#FFF8EF;--warn-fg:#B45309;--shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06);--s1:#2A78D6;--s2:#EB6834;--s3:#1BAF7A;--s4:#EDA100}
@media(prefers-color-scheme:dark){:root{--ground:#12161B;--ground-top:#0E1217;--surface:#1A2027;--surface-2:#232B34;--ink:#E7EAEE;--ink-2:#B3BCC7;--ink-3:#7C8794;--rule:#2E3741;--accent:#F2748C;--accent-2:#F0956B;--accent-soft:rgba(242,116,140,.13);--champ:#1E3326;--ok-bg:#1F3A2A;--ok-fg:#8FD6A8;--bad-bg:#43231F;--bad-fg:#F0A29C;--warn-bg:#3F3319;--warn-fg:#EACB7C;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25)}}
body{margin:0;color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:44px 24px 80px;background:linear-gradient(180deg,var(--ground-top),var(--ground) 340px) no-repeat,var(--ground)}
.page{max-width:68rem;margin:0 auto;display:grid;gap:20px}
.mono,td.num,code,pre,.kv dd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-variant-numeric:tabular-nums}
.kv dd{font-size:13px}
.small{font-size:12px}
header.run{display:grid;gap:6px}.eyebrow{margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700}
h1{margin:0;font-size:30px;font-weight:800;letter-spacing:-.022em}h1 .id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:26px}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 20px;margin:8px 0 0;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.kv div{display:grid;gap:2px}.kv dt{font-size:12px;color:var(--ink-3)}.kv dd{margin:0;font-size:13px;overflow-wrap:anywhere}
.verdict{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--warn-fg);padding:16px 20px;border-radius:14px;box-shadow:var(--shadow)}
.verdict.firm{border-left-color:var(--ok-fg)}.verdict.needs-review{border-left-color:var(--bad-fg)}
.verdict .champ-line b{color:var(--accent)}
.verdict .tag{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:12px;letter-spacing:.08em;background:var(--warn-bg);color:var(--warn-fg);padding:4px 10px;border-radius:4px;white-space:nowrap}
.verdict.firm .tag{background:var(--ok-bg);color:var(--ok-fg)}.verdict.needs-review .tag{background:var(--bad-bg);color:var(--bad-fg)}
.verdict p{margin:0}
.champ-line{margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em}.champ-line b{font-weight:700}
.trophy{font-size:18px}
.champ-facts{margin:3px 0 6px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--ink-2)}.verdict .sub{color:var(--ink-2);font-size:13px;margin-top:4px}
section.card{position:relative;overflow:hidden;background:var(--surface);border:1px solid var(--rule);border-radius:16px;padding:20px 24px 22px;display:grid;gap:12px;box-shadow:var(--shadow)}
section.card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
section.card h2{margin:0;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);display:flex;gap:10px;align-items:baseline}section.card h2 .hint{font-size:12px;color:var(--ink-3);font-weight:400}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-weight:600;color:var(--ink-2);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:8px 13px;border-bottom:1px solid var(--rule);white-space:nowrap;background:var(--surface-2)}
th.num,td.num{text-align:right;white-space:nowrap}
td.num .bar{margin-right:8px}td{padding:9px 13px;border-bottom:1px solid var(--rule);vertical-align:top}tr:last-child td{border-bottom:none}
td.cand{font-weight:600}td.cand .model{display:block;font-weight:400;font-size:12px;color:var(--ink-3);font-family:"IBM Plex Mono",monospace}
td .sub{display:block;font-size:11px;color:var(--ink-3)}
tr.control td.cand::after{content:"对照";margin-left:8px;font-size:11px;color:var(--accent);background:var(--accent-soft);padding:1px 6px;border-radius:3px;font-weight:500}
tr.chosen,tr.chosen:hover{background:var(--champ);box-shadow:inset 3px 0 0 var(--ok-fg)}tr.gated td{color:var(--ink-3)}
tbody tr{transition:background .12s ease}tbody tr:hover{background:var(--accent-soft)}
.sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:7px;vertical-align:baseline}
.sw0{background:var(--s1)}.sw1{background:var(--s2)}.sw2{background:var(--s3)}.sw3{background:var(--s4)}
.bar{display:inline-block;width:92px;height:9px;background:var(--surface-2);border-radius:99px;vertical-align:middle;margin-right:8px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--rule)}
.bar span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.pill.pass{background:var(--ok-bg);color:var(--ok-fg)}.pill.miss{background:var(--bad-bg);color:var(--bad-fg)}
ol.trace{margin:0;padding-left:1.2em;font-size:13px;color:var(--ink-2);display:grid;gap:8px}
.pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap}.pill.warn{background:var(--warn-bg);color:var(--warn-fg)}
.state-list{font-size:12px;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:4px 10px}.state-list .bad{color:var(--bad-fg)}.state-list .warn{color:var(--warn-fg)}.state-list .ok{color:var(--ok-fg)}
.two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}
.two-col>*{min-width:0;overflow:hidden}
.two-col .table-wrap{overflow-x:auto}
.ledger td:first-child{color:var(--ink-2)}.ledger tr.total td{font-weight:600;border-top:2px solid var(--rule)}
.note{font-size:12.5px;color:var(--ink-2);margin:0}code{background:var(--surface-2);padding:0 5px;border-radius:3px;font-size:12px}
ul.gaps{margin:0;padding-left:1.1em;font-size:13px;color:var(--ink-2);display:grid;gap:4px}
details{font-size:13px}summary{cursor:pointer;color:var(--accent);font-weight:500}
pre{margin:8px 0 0;padding:12px;background:var(--surface-2);border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.55;max-height:420px}
footer{font-size:12px;color:var(--ink-3);display:flex;gap:16px;flex-wrap:wrap}
@media(max-width:480px){h1{font-size:20px}.verdict{grid-template-columns:1fr}section.card{padding:14px}}
`;
