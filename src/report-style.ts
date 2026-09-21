/**
 * Page chrome shared by the canonical report pages (`report-v2.ts` for one
 * step, `report-workflow.ts` for the workflow above them) so the two never
 * drift into two different-looking reports. Layer-neutral: no legacy import.
 */

export const PAGE_STYLE = `
:root{--ground:#F3F4F6;--surface:#fff;--surface-2:#E9ECF0;--ink:#1A1F26;--ink-2:#4B5563;--ink-3:#8A94A3;--rule:#D6DBE2;--accent:#2F5D8A;--accent-soft:#DCE7F2;--ok-bg:#DDF1E4;--ok-fg:#1E6B3A;--bad-bg:#F8DEDC;--bad-fg:#9B2C25;--warn-bg:#F8ECD2;--warn-fg:#7D5410}
@media(prefers-color-scheme:dark){:root{--ground:#12161B;--surface:#1A2027;--surface-2:#232B34;--ink:#E7EAEE;--ink-2:#B3BCC7;--ink-3:#7C8794;--rule:#2E3741;--accent:#7FB0DE;--accent-soft:#24384D;--ok-bg:#1F3A2A;--ok-fg:#8FD6A8;--bad-bg:#43231F;--bad-fg:#F0A29C;--warn-bg:#3F3319;--warn-fg:#EACB7C}}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.6 "IBM Plex Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;padding:28px 20px 64px}
.page{max-width:68rem;margin:0 auto;display:grid;gap:20px}
.mono,td.num,.kv dd,code,pre{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.small{font-size:12px}
header.run{display:grid;gap:6px}.eyebrow{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-.01em}h1 .id{font-family:"IBM Plex Mono",monospace;font-weight:500}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 20px;margin:8px 0 0;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.kv div{display:grid;gap:2px}.kv dt{font-size:12px;color:var(--ink-3)}.kv dd{margin:0;font-size:13px;overflow-wrap:anywhere}
.verdict{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;background:var(--surface);border-left:4px solid var(--warn-fg);padding:14px 18px;border-radius:6px}
.verdict.firm{border-left-color:var(--ok-fg)}.verdict.needs-review{border-left-color:var(--bad-fg)}
.verdict .tag{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:12px;letter-spacing:.08em;background:var(--warn-bg);color:var(--warn-fg);padding:4px 10px;border-radius:4px;white-space:nowrap}
.verdict.firm .tag{background:var(--ok-bg);color:var(--ok-fg)}.verdict.needs-review .tag{background:var(--bad-bg);color:var(--bad-fg)}
.verdict p{margin:0}
.champ-line{margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em}.champ-line b{font-weight:700}
.trophy{font-size:18px}
.champ-facts{margin:3px 0 6px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--ink-2)}.verdict .sub{color:var(--ink-2);font-size:13px;margin-top:4px}
section.card{background:var(--surface);border-radius:8px;padding:18px 20px;display:grid;gap:12px}
section.card h2{margin:0;font-size:15px;font-weight:600;display:flex;gap:10px;align-items:baseline}section.card h2 .hint{font-size:12px;color:var(--ink-3);font-weight:400}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-weight:500;color:var(--ink-3);font-size:12px;padding:6px 10px;border-bottom:1px solid var(--rule);white-space:nowrap}
th.num,td.num{text-align:right}td{padding:9px 10px;border-bottom:1px solid var(--rule);vertical-align:top}tr:last-child td{border-bottom:none}
td.cand{font-weight:600}td.cand .model{display:block;font-weight:400;font-size:12px;color:var(--ink-3);font-family:"IBM Plex Mono",monospace}
td .sub{display:block;font-size:11px;color:var(--ink-3)}
tr.control td.cand::after{content:"对照";margin-left:8px;font-size:11px;color:var(--accent);background:var(--accent-soft);padding:1px 6px;border-radius:3px;font-weight:500}
tr.chosen td.cand{color:var(--ok-fg)}tr.gated td{color:var(--ink-3)}
ol.trace{margin:0;padding-left:1.2em;font-size:13px;color:var(--ink-2);display:grid;gap:8px}
.pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap}.pill.warn{background:var(--warn-bg);color:var(--warn-fg)}
.state-list{font-size:12px;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:4px 10px}.state-list .bad{color:var(--bad-fg)}.state-list .warn{color:var(--warn-fg)}.state-list .ok{color:var(--ok-fg)}
.two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.ledger td:first-child{color:var(--ink-2)}.ledger tr.total td{font-weight:600;border-top:2px solid var(--rule)}
.note{font-size:12.5px;color:var(--ink-2);margin:0}code{background:var(--surface-2);padding:0 5px;border-radius:3px;font-size:12px}
ul.gaps{margin:0;padding-left:1.1em;font-size:13px;color:var(--ink-2);display:grid;gap:4px}
details{font-size:13px}summary{cursor:pointer;color:var(--accent);font-weight:500}
pre{margin:8px 0 0;padding:12px;background:var(--surface-2);border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.55;max-height:420px}
footer{font-size:12px;color:var(--ink-3);display:flex;gap:16px;flex-wrap:wrap}
@media(max-width:480px){h1{font-size:20px}.verdict{grid-template-columns:1fr}section.card{padding:14px}}
`;
