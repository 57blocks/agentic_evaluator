**TRD: AI Chess Analysis & Tournament Prep Tool**

Technical Requirements Document • Version 0.1 (Draft) • July 2026

**Companion to:** PRD v1.0 (2026-07-20). Feature IDs (F001–F010), user stories (US001–US008), and exception cases (EH001–EH009) referenced here come from that PRD.

**Owner:** *To be confirmed*    **Engineering reviewers:** *To be confirmed*

**How to edit this doc:** *Anything marked “To be confirmed” or “Proposed” is a decision waiting for you. Everything else is a starting recommendation — change it if you disagree, just note why.*

# **1\. Purpose and Scope**

This TRD describes how to build v1 of the product defined in the PRD: a mobile-web and desktop-web app that (a) turns a photo of a handwritten notation sheet into a digital chess game, (b) analyzes the game with Stockfish 18 plus plain-language AI explanations, (c) recommends study material, and (d) prepares players for opponents using public game data.

In scope for this document: system architecture, technology choices, component design, data model, API surface, performance and security requirements, and error handling. Out of scope: visual/UI design, marketing, pricing, and anything the PRD lists as out of scope (native mobile apps, offline-first behavior, live play, lessons).

# **2\. System Architecture**

v1 is a single web application talking to one backend API, which orchestrates four internal services and a small set of external providers. Because the PRD requires the user to stay on the active tab during upload and analysis (F007), the whole flow can be synchronous from the client's point of view: the browser holds one connection open and receives progress updates. No background job queue is strictly required for v1, but using one internally makes the retry rule in EH003 easier to implement.

## **2.1 Components**

| Component | What it does | PRD features |
| :---- | :---- | :---- |
| Web client (SPA) | Photo capture/upload, progress screen with “don't leave this tab” warning, ambiguous-move confirmation UI, analysis viewer, opponent prep UI, sign-up and consent screens, rating prompt. | F005–F010 |
| API backend | Auth, session management, request orchestration, metrics events, rate limiting. | All |
| OCR service | Pre-scan readability check (≥80% rule), full handwriting OCR, move parsing, chess-legality validation, candidate generation for unclear moves. | F005, F006 |
| Analysis service | Runs Stockfish 18 per position, classifies each move (Brilliant → Blunder), calls the LLM for plain-language explanations and the end-of-game summary. | F001–F003 |
| Search/Prep service | Web search for study material; queries Lichess/Chess.com public APIs and the web for opponent games; builds opening/tendency summaries. | F004, F008 |
| Email service | Sign-up emails, parent consent codes (2-minute expiry), resend flow. | F009 |
| Database \+ object storage | Accounts, consent records, games (PGN), analysis reports, metrics events. Photos live in temporary object storage and are deleted after analysis. | All |

## **2.2 External dependencies**

| Dependency | Used for | Notes |
| :---- | :---- | :---- |
| Stockfish 18 | Move evaluation | Run server-side (see §4.2). Fixed version pinned so classifications are reproducible. |
| Document OCR service | Layout detection, table/line segmentation, handwriting recognition (§4.1 stages 3–5) | *Provider to be confirmed.* Managed services (Textract, Google Vision, Azure Document Intelligence) return structured table cells with per-cell bounding boxes and confidences, which covers segmentation for the printed-scoresheet format cheaply. Their weakness is the recognition step itself: built-in language priors are tuned for words and hurt on short non-dictionary tokens like `Nf3` / `Qxd5+` / `O-O`. Treat them as the segmentation layer first; whether they also suffice for recognition is the §10 bake-off. |
| Recognition model (candidates) | Per-slot top-k SAN candidates (§4.1 stage 5\) | *Provider to be confirmed.* A self-hosted open-weights VLM is worth evaluating specifically because decode-time constraint (logit masking to the legal-move set) requires access to logits, which hosted APIs do not expose — a hosted model can only be *asked* to pick from the list, not *forced* to. Note that text-only APIs (e.g. DeepSeek's main chat models) accept no image input and are out of scope regardless. |
| LLM API | Move explanations, end-of-game summaries, opponent prep lines | *Provider to be confirmed.* Separate concern from OCR — may well be a different vendor than the recognition model. |
| Web search API | Study recommendations, opponent search | *Provider to be confirmed* PRD open question: which providers are officially supported. |
| US Chess ratings (ratings.uschess.org) | Opponent identity \+ rating verification (F008) | **No public API.** Scrape the public MSA player pages with a crawler (proposed: Crawlee) behind an adapter. Source of truth for USCF current \+ rating history — the PRD requires matching on a *previous* rating too. |
| FIDE ratings (ratings.fide.com) | Opponent identity \+ rating verification (F008) | **No public API.** Public rating lists are also published as downloadable XML dumps — prefer ingesting the monthly dump over live scraping where possible. Gives federation, title, rating history. |
| Lichess API | Opponent public games | Free, open API; good primary source for online games. |
| Chess.com Published-Data API | Opponent public games | Public data only; respect rate limits and terms of service. |
| ChessBase / OTB game databases | Opponent OTB games | Public archives only; access via web search \+ crawler adapter where no API exists. Terms-of-service review required per source. |
| Crawlee (crawler) | Fetching the above sources that have no API | Per PRD/appendix. Rate-limit politely, cache aggressively (§4.4), never authenticate into a site. |
| Email provider | Consent codes, account email | *Provider to be confirmed* Deliverability matters: a lost parent email \= EH005. |

# **3\. Proposed Technology Stack**

These are recommendations, not decisions. Swap anything the team knows better.

| Layer | Proposal | Why |
| :---- | :---- | :---- |
| Frontend | React \+ TypeScript, built with Vite | Works on the required browsers (latest two Chrome \+ Safari, current ChromeOS); large talent pool; chessboard libraries available (e.g. react-chessboard). |
| Chess rules library | chess.js (client and server) | Legal-move validation, PGN/FEN handling, SAN parsing — needed for OCR validation and the analysis viewer. |
| Backend | Node.js (TypeScript) or Python (FastAPI) | Either is fine; pick whichever the team writes fastest. Python pairs well with the OCR/analysis code. |
| Database | PostgreSQL | Relational fits users/consents/games/reports; hosted US-only per PRD. |
| Object storage | S3-compatible bucket (US region) | Temporary photo storage with lifecycle rule as a backstop for deletion (§7.2). |
| Engine hosting | Stockfish 18 in server workers | See §4.2 for server vs. in-browser tradeoff. |
| Progress updates | Server-Sent Events (SSE) | One-way progress stream fits the stay-on-tab flow; simpler than WebSockets. |

# **4\. Component Design**

## **4.1 Notation photo import pipeline (F005, F006, EH001, EH002, EH008)**

The pipeline runs in stages. Each stage reports progress to the client over the SSE stream so the progress screen can show real status during the 20–30 second budget.

1\. Upload. Client compresses the photo (target ≤1.5 MB, long edge \~2000 px) before upload to fit the 20–30 s budget on tournament-hall 4G. Accepted types: JPEG, PNG, HEIC (converted client-side).

2\. Image sanity check. Reject non-images, corrupt files, and obvious non-notation images (no detectable handwriting at all). This is the technical hook for EH008; the exact user-facing behavior is still To be confirmed in the PRD.

3\. **Layout detection and segmentation.** v1 must handle **two paper formats**, so this stage is a pluggable adapter that classifies the page and then segments it. Both adapters emit the same output — an **ordered list of half-move slots**, each with a crop, a slot index, and an expected side to move — so everything downstream is shared.

   **(a) Printed scoresheet (table).** The common USCF/FIDE tournament sheet: move numbers and White/Black columns are pre-printed. Detect the table and read cells directly; `row_index` maps to move number and `col_index` maps to side, which makes slot ordering exact and dropped moves nearly impossible. This is the easy and preferred path.

   **(b) Free-form handwritten score (plain or lined paper).** No grid: run line segmentation, then split each line into tokens. Handwritten move numbers (`1.`, `2.`, `3.` …) are the only anchors, so use their **monotonic increase** as a structural check — a gap or repeat in the recovered numbering means a dropped or duplicated move, which is passed to stage 6 as an explicit hint. Moves may wrap mid-pair across lines; the segmenter must join a trailing move number to the moves on the following line.

   Format classification itself must be cheap and confident; when detection is uncertain, prefer (b), since the free-form path degrades more gracefully on a table than the reverse.

4\. Pre-scan. Estimate what fraction of the segmented slots are legible (per-slot recognition confidence). If \<80% → stop and return “retake in better light” (EH001). The 80% threshold matches the PRD and is a constant in config so it can be tuned without a release. This gate runs **after** segmentation so the denominator is the real number of slots, not a guess.

5\. Per-slot recognition. For each slot, return the **top-k candidate SAN strings with confidences** (proposed k \= 5), not a single best guess. Normalize known confusions before scoring: `0-0`/`00` → `O-O`, digit/letter pairs (`0`/`O`, `1`/`l`, `5`/`S`), and dropped capture markers (`x`). Recognition is a provider adapter — see §2.2; selection depends on the bake-off in §10.

6\. **Constrained decoding into a legal game.** Do not accept slots one at a time — replay the game with chess.js under a beam search (proposed width 3–5) scored by (recognition confidence × engine plausibility). Two rules matter:

   • **Constrain to legal moves.** At every ply the set of legal SAN moves is typically \~30, so recognition is scored as a choice within that set rather than as open-ended text. Where the recognizer is self-hosted, enforce this as a hard decode-time constraint (logit mask) instead of a post-filter.

   • **Allow repair operations.** The beam may insert or delete a ply when no candidate continues the line — this is what recovers the dropped moves that format (b) is prone to. Repairs are always surfaced to the user in stage 7, never applied silently.

   Global legality is what rescues most single-slot misreads: a wrong ply poisons every later position, so scoring whole lines beats greedy per-slot decisions.

7\. Ambiguity output. Any slot where no candidate clearly wins — plus every repair the beam applied — is flagged. The client shows the flagged moves with the candidate list for the user to pick or type in manually (F006, US003). UI design is To be confirmed.

8\. Result. A validated PGN plus a list of user confirmations, stored as the game record. The photo is scheduled for deletion (§7.2).

**Accuracy target:** ≥90% of moves read correctly without manual correction (PRD metric). Measure this with a labeled test set of real notation sheets — **both paper formats**, different handwriting, pencil vs. pen, and lighting — before launch. Track three numbers, not one: per-ply accuracy, **whole-game zero-intervention rate**, and **average user taps per game**. The last one is the real experience metric, since F006 is the safety net. *Test-set size and sourcing: To be confirmed (proposed: ≥30 sheets per format).*

## **4.2 Analysis service (F001, F002, F003, EH003)**

Where the engine runs is the first decision:

**•** **Server-side Stockfish (recommended).** Consistent depth and speed on every device — important because school Chromebooks are a target device and in-browser WASM engines are slow on them. Costs server CPU.

**•** **In-browser WASM Stockfish.** Free compute, but analysis quality would vary by device and drain phone batteries at tournaments. Not recommended for v1.

Analysis flow, designed around the requirement that the first explanation appears within \~5 seconds of move confirmation (F002, US004):

1\. On confirmation, the server starts engine evaluation of all positions at a shallow depth first (fast pass), then deepens (target depth — proposed: 18–20; To be confirmed).

2\. Move classification uses centipawn loss vs. the engine's best move, bucketed into the nine PRD labels (Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Miss, Blunder). Proposed starting thresholds are in the table below; tune against chess.com-style expectations during beta.

3\. The first mistake (or move 1 if none yet) is sent to the LLM immediately for its explanation, so something meaningful renders inside 5 seconds; remaining explanations stream in behind a per-move loading state.

4\. The end-of-game summary (F003) is one LLM call over the full classified game: top of the report states the strategic mistakes and why the game was lost (per the PRD goal), then turning points, recurring themes, and accuracy.

5\. Crash/timeout handling (EH003): the whole analysis is retried once; if the retry fails, whatever moves completed are returned as a partial report. User-facing copy for this state: To be confirmed.

| Label | Proposed rule (starting point — tune in beta) |
| :---- | :---- |
| Brilliant | Best move AND involves a sacrifice or only-move save the engine confirms |
| Great | Best move in a critical position (eval swing avoided) |
| Best | Engine's top move |
| Excellent | Centipawn loss ≤ 20 |
| Good | Centipawn loss 21–50 |
| Inaccuracy | Centipawn loss 51–100 |
| Mistake | Centipawn loss 101–250 |
| Miss | Failed to play a winning tactic the engine finds (win → equal) |
| Blunder | Centipawn loss \> 250, or win → loss swing |

**LLM explanation inputs:** position (FEN), move played, engine best line, eval before/after, and the classification. The prompt must require the explanation to name the concept (fork, pin, weak color complex, development, king safety…) so recommendations in §4.3 have something to key on. Reading level: aim for a strong 10–14-year-old reader; coach personas that vary tone are v1.1 (F102).

## **4.3 Study recommendations (F004)**

1\. Collect the concept tags produced in §4.2 for every Inaccuracy/Mistake/Miss/Blunder.

2\. Group and rank tags by frequency and severity — recurring themes rank first.

3\. For the top tags (proposed: top 3; To be confirmed), run web searches like “chess back rank tactics lesson” and keep results from a quality allowlist (proposed: lichess.org/study, chess.com lessons/articles, well-known YouTube chess educators; list To be confirmed).

4\. Attach each recommendation to the move(s) that triggered it and list all of them in the “what to study next” panel.

**Safety note:** results are shown to children. Enable safe-search on the API and only surface links from the allowlist — never raw open-web results.

## **4.4 Opponent prep (F008, EH009, US007)**

1\. Input: opponent name, plus rating and federation. Per F008 the user is asked for the opponent's **most recent** rating, because名字重复时等级分是主要消歧依据.

2\. **Identity resolution first (rating sources).** Look the name up in the official rating sources before touching game databases:

   a. **US Chess (ratings.uschess.org)** — fetch the player's current rating *and rating history*. A match counts if the user-supplied rating equals the current rating **or any previous rating** in that player's history (explicit PRD rule for users who only know an older rating).

   b. **FIDE (ratings.fide.com)** — same lookup for federation, title, and rating history.

   c. Both sources are adapters returning a common `RatedPlayer {source, player_id, name, federation, current_rating, rating_history[], state?}` shape, so a third source can be added later without touching the caller.

3\. **Then find games** for the resolved player(s): Lichess and Chess.com public APIs for matching usernames/profiles, ChessBase and other public OTB archives, plus the web search API for anything else publishing public game records. Online accounts are narrowed by federation/rating — per PRD, a same-name account whose rating is far off is treated as a different person.

4\. If multiple plausible matches survive: return the candidate list with rating/federation/location/last-active so the user disambiguates (EH009). The API accepts an optional platform username or US Chess ID to skip resolution entirely.

5\. **If nothing matches name \+ rating \+ federation, report "no information found"** rather than guessing — explicit PRD requirement.

6\. Aggregate the found games: openings as White and Black (by frequency and score), common middlegame patterns, and 2–3 suggested prep lines, generated by the LLM from the aggregated stats. Every report shows which sources were queried and which failed (§7.4).

**Boundaries:** public data only; no scraping behind logins; respect every API's rate limits and terms; identify the crawler with a real User-Agent and honor robots.txt. Cache rating lookups and opponent reports for a short period (proposed: 7 days) to avoid re-querying.

## **4.5 Accounts and parental consent (F009, EH005, EH006, US008)**

1\. Sign-up asks for email and birth year. Under-13 (COPPA age) → consent flow; 13–17 handling: To be confirmed with legal review.

2\. Child enters parent email; server generates a one-time 6-digit code, valid 2 minutes, single use. Resend button issues a new code and invalidates the old one. Rate limit: proposed max 5 codes per hour per account.

3\. Until consent is confirmed, the account is in a pending state: it exists but cannot upload games or store data beyond the sign-up record.

4\. Parent declines → the account and all its data are deleted (EH006) after showing the “parent declined” message. Deletion is a hard delete, logged in an audit record that stores no child data.

5\. Code expires or never arrives (EH005) → resend flow; what happens if the user gives up mid-consent is To be confirmed.

**Legal flag:** the PRD already says this — email-code consent may not satisfy COPPA's “verifiable parental consent” standard. Nothing in this section is final until legal review. Consent revocation by parents (dashboard vs. email link) is also unresolved and affects the data model below.

## **4.6 Active-tab flow and rating prompt (F007, F010, EH004)**

• Before upload, the client shows the warning \+ progress screen (“stay on this tab”). Register a beforeunload handler so closing the tab mid-flow triggers the browser's leave-confirmation dialog.

• If the tab is backgrounded or the phone sleeps and the SSE connection drops, the server abandons the job and the client, on return, shows a “scan was lost — start again” state (EH004). No resume support in v1 (explicitly out of scope).

• Rating prompt (F010): trigger after the user has viewed a configurable number of complete analysis reports (proposed: 2nd report). Placement and collection method (in-app stars vs. store review): To be confirmed.

# **5\. Data Model (Draft)**

PostgreSQL. Names are draft; the important part is what is stored and what is deliberately NOT stored.

| Table | Key fields | Notes |
| :---- | :---- | :---- |
| users | id, email, display\_name, birth\_year, status (pending\_consent / active / deleted), created\_at | display\_name may be the child's name — treat as child PII. |
| parent\_consents | id, user\_id, parent\_email, code\_hash, code\_expires\_at, status (pending / confirmed / declined), confirmed\_at | Consent record required by PRD. Store code hashed, never plaintext. |
| games | id, user\_id, pgn, source (photo / manual), ocr\_confirmations (json), played\_at, created\_at | PGN is canonical. No photo reference after deletion. |
| analysis\_reports | id, game\_id, engine\_version, depth, classifications (json), summary\_text, accuracy, status (complete / partial), created\_at | engine\_version pinned per report so old reports stay reproducible. |
| study\_recommendations | id, report\_id, move\_number, concept\_tag, url, title, source | Only allowlisted sources. |
| opponent\_reports | id, user\_id, opponent\_query, matched\_profiles (json), summary (json), created\_at, expires\_at | Cached per §4.4. |
| metric\_events | id, user\_id, event\_name, properties (json), created\_at | Event names in §8. Exact definitions To be confirmed in PRD. |
| tournament\_checkins | id, user\_id, games\_played\_reported, period\_start, period\_end | Stores the answer to “How many games did you play this tournament/weekend?” — denominator for the primary metric. |

**Deliberately not stored:** notation photos after analysis completes (§7.2), plaintext consent codes, and any photo-derived data used for model training (out of scope for v1 per PRD).

# **6\. API Surface (Draft)**

| Endpoint | Purpose |
| :---- | :---- |
| POST /auth/signup · POST /auth/login | Email account creation and login (US001 precondition). |
| POST /consent/request · POST /consent/confirm · POST /consent/resend | Parental consent code flow (F009). |
| POST /games/photo | Upload notation photo; returns job id (F005). |
| GET /games/jobs/{id}/events | SSE stream: upload → pre-scan → OCR → validation progress (F007). |
| POST /games/jobs/{id}/confirmations | Submit choices for ambiguous moves (F006). |
| POST /games/{id}/analyze · GET /analysis/{id}/events | Start analysis; SSE stream delivers classifications and explanations as they finish (F001–F002). |
| GET /analysis/{id} | Full report: classifications, explanations, summary, recommendations (F003–F004). |
| POST /opponents/search · GET /opponents/reports/{id} | Opponent prep (F008). |
| POST /metrics/tournament-checkin | Games-played prompt answer (primary metric denominator). |
| POST /metrics/events | Client analytics events (§8). |

# **7\. Non-Functional Requirements**

## **7.1 Performance**

• Photo submit → move-confirmation screen: 20–30 s on typical tournament-hall 4G. Budget (proposed): ≤8 s upload of the compressed image, ≤5 s pre-scan, ≤12 s full OCR \+ validation, rest as margin.

• Move confirmation → first explanation rendered: ≤5 s (see §4.2 fast-pass design). Per-move loading states after that.

• If upload exceeds 30 s (open PRD question): keep going with the progress bar honest — do not fail on time alone — but log it; proposed hard timeout at 120 s. To be confirmed.

## **7.2 Security and privacy**

• Photos: stored in a private US-region bucket, deleted immediately when analysis completes or fails permanently; a 24-hour storage lifecycle rule acts as the backstop if a deletion call is missed.

• Photos are never used for model training in v1 (PRD scope).

• All traffic over HTTPS; data encrypted at rest (standard managed-database encryption). Password policy, session duration, and audit logging: To be confirmed (open in PRD).

• Consent codes stored hashed; 2-minute expiry; single use; resend invalidates prior codes; rate-limited.

• Child data minimization: collect only what the PRD lists (child name, parent email, consent record, games, reports). No ads, no third-party trackers on pages a child uses.

• US-only hosting for v1; no EU/GDPR features.

## **7.3 Compatibility**

• Latest two versions of Chrome and Safari, mobile and desktop; current ChromeOS on school Chromebooks where possible.

• Unsupported browsers get a clear “please use Chrome or Safari” message (EH007) — detect via feature checks (SSE, needed JS APIs), not user-agent strings alone.

• Camera capture must work through the standard file input with capture attribute on iOS Safari and Android Chrome — test HEIC handling on iPhone specifically.

## **7.4 Reliability**

• Analysis retry: exactly one automatic retry; then partial report (EH003).

• No resume of interrupted uploads/analyses in v1 (EH004); abandoned jobs are cleaned up server-side after 10 minutes.

• External API failures (search, Lichess, Chess.com): degrade gracefully — analysis works without recommendations; opponent prep reports which sources failed.

# **8\. Analytics Events (Draft)**

Exact definitions are an open PRD item; this is the proposed starting set, named so the PRD metrics can be computed directly.

| Event | Fired when | Feeds which metric |
| :---- | :---- | :---- |
| signup\_completed / consent\_confirmed | Account active | Month-1 traction (500 users; \<100 \= failure signal) |
| photo\_upload\_started / prescan\_failed / ocr\_completed | Import pipeline stages | OCR accuracy ≥90%; imports within 24 h of play |
| report\_viewed | User opens a completed analysis report | Numerator of primary metric (target 60–80% of games played); backup metric reports/user/week |
| tournament\_checkin\_submitted | User answers the games-played prompt | Denominator of primary metric |
| recommendation\_opened | User taps a study link | % opening ≥1 recommendation per game |
| opponent\_prep\_run | Opponent report generated | % of users running prep before rated events |
| rating\_prompt\_shown / rating\_submitted | Rating flow (F010) | 4–5 star target (minimum count To be confirmed) |

# **9\. Technical Risks**

| Risk | Mitigation |
| :---- | :---- |
| Handwriting OCR misses the 90% target on real scholastic sheets (pencil, rushed writing, coffee stains). | Build the labeled test set early; legality-constrained decoding (§4.1 stage 6\) recovers many misreads; the F006 confirmation UI is the safety net — measure how many taps it needs per game. |
| Free-form handwritten scores (no printed grid) drop or duplicate moves, poisoning every later position. | Monotonic move-number check plus insert/delete repair operations in the beam (§4.1 stages 3b, 6\); every repair is surfaced for confirmation rather than applied silently. Keep the two formats as separate rows in the test set so one does not mask the other's failures. |
| Constrained decoding masks a weak recognizer: forced to pick a legal move, it guesses plausibly instead of failing loudly. | Track per-ply accuracy on the *unconstrained* output too. A large A→B gap in the §10 bake-off is good; a B that scores well while A is near-noise means the model is guessing, and silent wrong moves are worse than flagged ones. |
| Active-tab requirement causes lost scans at tournaments (EH004 risk in PRD). | Make the progress screen honest and fast (§7.1 budget); log abandonment rate from day one — it is the strongest argument for background upload in v2. |
| Engine \+ LLM cost per game is too high at scale. | Fast-pass/deep-pass design caps engine time; cache LLM explanations per (position, move) pair; monitor cost per analyzed game as a launch metric. |
| Consent emails land in spam → EH005 drop-off. | Reputable email provider, proper SPF/DKIM, plain transactional template; monitor delivery rate. |
| External chess APIs rate-limit or change terms. | Cache opponent reports (§4.4); isolate each provider behind an adapter so one failing source degrades, not breaks, the feature. |
| Chromebook performance (school-managed devices, old hardware). | Server-side engine (§4.2) keeps the client thin; test on an actual managed Chromebook before launch. |

# **10\. Open Technical Questions**

1\. **Recognition bake-off (blocks the §4.1 provider choice).** Build the labeled test set first (both paper formats), then measure the same three metrics across at least: (A) managed OCR service, raw output; (B) managed OCR service \+ legality-constrained beam search; (C) self-hosted open-weights VLM with decode-time logit masking. A→B sizes the value of constrained decoding; B vs C decides whether a hosted service is worth paying for. Run A/B first — if B already clears 90% with few taps per game, C is unnecessary work.

1a. Which LLM provider (and model) for explanations and summaries, and what is the measured cost per analyzed game? At \~80 half-moves per game, per-slot recognition calls dominate cost — batch slots per request rather than calling once per move.

2\. Engine depth for the deep pass (proposed 18–20) — what depth fits the cost budget while keeping classifications trustworthy?

3\. Final classification thresholds (§4.2 table) — tune against what players expect from chess.com labels?

4\. Study-recommendation allowlist — which sites and channels are approved for kids?

5\. Hard timeout for slow uploads (proposed 120 s) and the UX when it triggers.

6\. Does email-code consent survive legal review, and does the answer change the §4.5 flow (e.g., needing credit-card or ID verification)?

7\. Parent consent revocation mechanism (dashboard vs. signed email link) — affects data model and email service.

8\. Analytics tooling: build on metric\_events table only, or add a product-analytics tool that is COPPA-safe?

# **Appendix A: Traceability**

Every P0 PRD feature maps to a section here: F001–F003 → §4.2; F004 → §4.3; F005–F006 → §4.1; F007 → §4.6; F008 → §4.4; F009 → §4.5; F010 → §4.6. Exception cases EH001–EH009 are covered in §4.1, §4.2, §4.4–§4.6, and §7.3. P1 features (F101–F103) are intentionally absent — design them when v1.1 is scoped.

Database (PostgreSQL):  
Stores user accounts, parent consent records, game files (PGN), analysis reports, and study recommendations. Photos are kept in temporary cloud storage (S3) and deleted right after processing—never used for training.

Servers:  
One main server (Node.js or Python) handles uploads, runs the analysis, and sends progress updates to your browser using SSE. Stockfish runs on this server, not in your browser, so it works fast even on old school Chromebooks.

Chess Engine (Stockfish 18):  
Runs server-side to evaluate every position and classify each move (from Brilliant to Blunder). It does a quick pass first to get you the first explanation within 5 seconds, then goes deeper (target depth 18–20) for the full report. An AI (LLM) turns those engine numbers into plain‑language explanations and summaries

OCR Pipeline: It works with both kinds of paper — the printed tournament scoresheet with its move-number grid, and a game just written out by hand on plain paper. It figures out which one it is, splits the page into individual moves, and checks the photo is clear enough (80% of moves readable). Then, for each move, instead of just reading the handwriting and hoping, it uses the rules of chess: at any point there are only about 30 legal moves, so it picks the best match among those. If it still can't tell, it stops and lets you choose from a short list or type the move yourself. Target: 90% of moves read correctly with no fixing needed. Which OCR model does the reading is still an open decision — see §10.

External Data Sources: To find study material and opponent info, the app uses all of these — [https://ratings.uschess.org/](https://ratings.uschess.org/) and [https://ratings.fide.com/](https://ratings.fide.com/) to verify *who* the opponent is by rating and federation, then Lichess, [Chess.com](https://chess.com/), ChessBase and general web search to find *their games*. Sites with no API are fetched with a web crawler (Crawlee) — public pages only, no logins. See §4.4.

Retry and Recovery Rules: If the analysis crashes or times out, the server tries one more time automatically. If that also fails, you get a partial report with whatever it finished. However, if you close the browser tab or your phone goes to sleep during processing, the job is lost—you have to start over (no resume in this version).

Parent Consent (Safety): The 6-digit email codes expire in 2 minutes and can only be used once. If you hit "resend," the old code instantly stops working. If the parent says "no," the entire account and all its data are permanently deleted.

1. Photo Import & OCR (Reading the Scoresheet)  
* Take a photo of your handwritten notation sheet and upload it.  
* Works with both a printed tournament scoresheet and a game written out by hand on plain paper.  
* System checks if the photo is clear enough (needs at least 80% readable).  
* If it's too blurry or dark, it asks you to retake it in better light.  
* It reads each move using the rules of chess to narrow down what you wrote, and can spot a move you skipped.  
* Target: 90% of moves read correctly without you having to fix them.

---

2\. Ambiguous Move Confirmation

* If the system is unsure about a specific move, it shows you a list of possible moves to choose from.  
* You pick the correct one before the analysis starts or you can enter in yourself  
* This prevents silent mistakes and lets you fix things quickly.

---

3\. Move-by-Move Analysis with Explanations

* Every move gets a label: Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Miss, or Blunder.  
* For each move, it explains in plain language why it was good or bad (tactical or positional reasons).  
* The first explanation appears within about 5 seconds.

---

4\. End-of-Game Summary

* At the top of every analysis, it tells you why you lost.  
* Shows the key turning points and recurring mistakes.  
* Gives you an overall accuracy score.

---

5\. Personalized Study Recommendations

* Based on the mistakes you made, it searches the web for relevant articles, videos, or lessons.  
* Only shows results from approved, kid-safe websites (like and [Chess.com](https://chess.com/)).  
* Lists them in a "what to study next" panel, attached to the moves that triggered them.

---

6\. Opponent Preparation

* Enter an opponent's name plus their most recent rating and federation (needed to tell apart people with the same name).  
* System first confirms who they are on US Chess and FIDE (a match against any *past* rating also counts), then searches public databases (Lichess, [Chess.com](https://chess.com/), ChessBase, and the web) for their games.  
* If nothing matches the name, rating and federation, it says so instead of guessing.  
* Summarizes their opening preferences, common patterns, and gives suggested prep lines.  
* Helps you prepare before a tournament game.

---

7\. Account Sign-Up with Parental Consent

* Sign up with email.  
* If you're under 13, you enter a parent's email.  
* Parent receives a 6-digit confirmation code that expires in 2 minutes.  
* You can resend the code if it doesn't arrive.  
* Because it has private information 


  
