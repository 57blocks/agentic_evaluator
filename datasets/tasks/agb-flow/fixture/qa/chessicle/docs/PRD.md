# PRD: AI Chess Analysis & Tournament Prep Tool

## Overview

Version: 1.0Created Date: 2026-07-20Owner: To be confirmed

Bug: The chess pieces are wonky and the ai can’t fix it for some reason, I can’t tell the difference between a bishop and a knight and a pawn at this point, so plz use the chess piece style alpha:

### One-sentence Product Description![][image1]

Chess app that analyzes games with summary of what you did wrong and labels strategic mistakes that other chess apps overlook as well as label which move is which move rank and why, also preps you for your opponent and saves you from searching online and finding manually, and has a study plan based on your games and skills linked to Youtube videos or [chess.com](http://chess.com) lessons.  

### Background and Core Problem

Tournament chess players, especially scholastic players, often record over-the-board games on paper notation sheets and enters it into [chess.com](http://chess.com) or chessbase, but these websites only tell them where they moved wrong and not the whole picture or strategic plans. It is also a pain to manually move-by-move enter the game into [chess.com](http://chess.com) or chessbase. Existing chess analysis tools show engine evaluations and best lines, but developing players may not understand why a move was good or bad or what concept they should study next. Players also struggle to prepare for upcoming opponents because finding public games and identifying tendencies requires manual searching across databases and the web.

## Goals and Success Metrics

### Product Goal

- Remove friction from analyzing over-the-board tournament games by allowing users to digitize handwritten notation sheets from a photo since every tournament makes you notate anyways  
- Make every analyzed move educational by explaining the reason behind the move evaluation in plain language.  
- Convert recurring mistakes into personalized study recommendations.  
- Make pre-tournament opponent preparation faster by summarizing publicly available opponent games and tendencies.  
- For v1, the user must stay on the active analysis tab until upload and analysis complete; background upload, tab switching, and offline-first processing are not supported.  
- Summarize strategic mistakes and why you lost this game at the top of every game analysis 

### Target Users

- Primary: Competitive scholastic and club chess players, roughly 800–2000 rating, who play rated over-the-board tournaments and record games on notation sheets.  
- Secondary: Chess parents and coaches who review games with students and want structured, explainable analysis.  
- Devices expected for v1: phones, laptops, iPads, and school Chromebooks where supported.  
- First launch cohort: To be confirmed.

### User Pain

- Players see engine scores and best lines but do not understand why a move was a mistake or what concept to learn.  
- Manual entry of paper notation sheets into analysis software is slow and error-prone, so many games are never analyzed.  
- Opponent preparation requires manual searching across chess platforms, databases, and the web.  
- Young tournament players may have limited patience for long upload or analysis times.


### Metrics

- Month 1 traction target: 500 users.  
- Early failure signal: 100 sign-ups in the first month is considered bad.  
- Primary game-entry success metric: analysis reports viewed divided by games played in the tournament/weekend, where the denominator is manually entered by the user through the prompt: “How many games did you play in this tournament/weekend?”  
- Target game-entry success: 60–80% of games played result in viewed analysis reports.  
- Backup engagement metric: average analysis reports viewed per user per week; target value to be confirmed.  
- Rating/review target: 4–5 star reviews; minimum review count to consider this reliable is to be confirmed.  
- OCR accuracy target from original concept: ≥90% of moves read correctly without manual correction.  
- Weekly active analysis sessions per user.  
- Exact analytics event definitions: To be confirmed.

## Feature List

### P0

Feature ID Feature Name Description User Value Notes

F001 Post-Game AI Analysis Panel After an analyzed game, the player sees move-by-move classifications and an end-of-game summary. Move classifications include Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Miss, and Blunder. Helps players understand what went right and wrong across the game. Uses engine analysis plus natural-language explanations.

F002 Plain-Language Move Explanations For every move, the system explains why the move was good or bad, including tactical or positional reasoning rather than only centipawn change. Helps developing players learn concepts behind mistakes and good moves. First explanation should appear within about 5 seconds after move confirmation, with loading state if full analysis is still processing.

F003 End-of-Game Summary The system aggregates key turning points, recurring themes, and overall accuracy. Gives the player a practical learning summary after each game. Recurring themes may include examples such as missed tactics or weak pawn-structure decisions.

F004 Personalized Study Recommendations Based on identified mistakes, the system searches the web for relevant articles, videos, and annotated games matched to the concept the player missed. Turns weaknesses into a concrete study plan. Recommendations are attached to relevant moves and shown in a “what to study next” list.

F005 Notation Sheet Photo Import User uploads a photo of a handwritten notation sheet. OCR/vision AI reconstructs the game and validates legality. Removes manual PGN entry friction. Pre-scan checks whether at least 80% of moves are readable after upload. If not, user is asked to retake in better light.

F006 Ambiguous Move Confirmation When OCR is unsure, the user sees uncertain moves and a list of candidate moves to choose from. Prevents silent OCR failure and lets users quickly correct the game. Exact UI design is to be confirmed.

F007 Active-Tab Upload and Analysis Flow During v1 upload and analysis, the user must remain on the active tab. Switching tabs, closing the browser, or phone sleep may cause failure or loss. Sets clear expectations and avoids unsupported background behavior in v1. Product must show a clear warning and progress screen telling users not to leave.

F008 Pre-Tournament Opponent Prep User enters an opponent name,  with rating and federation. The user must put in the opponent’s most recent rating in case their opponent has same names with other people. The ai also must search up the person’s most recent rating using [https://ratings.uschess.org/](https://ratings.uschess.org/) (the official uscf website). The official fide website([https://ratings.fide.com/](https://ratings.fide.com/)) same as well. If the user does not put in the most recent rating, ai can still identify the correct person if the inputted rating matches one of the previous ratings on ratings.uschess.org. Ai also narrows down [chess.com](http://chess.com) accounts or other resources with the federation or rating(if they have the same name but rating is very different, then it is not the same person). If there is no information matching the name and rating and federation, the ai reports there is no information. Reduces opponent preparation from manual searching to a faster workflow. Limited to publicly available game records; no private data scraping.

F009 Email Account Sign-Up with Parental Consent Users sign up using email. For child users, the app asks for parent email, sends a code, and requires confirmation. Allows persistent storage of games and reports while supporting child use cases. Intended to be COPPA-compliant, but legal review is required before confirming compliance.

F010 Rating Review Prompt Add a rating review mechanism. Helps measure user satisfaction and app quality. Exact placement, platform, and review collection method are to be confirmed.

### P1

Feature ID Feature Name Description User Value Notes

F101 Custom Position Setup Players can manually set up any board position using a drag-and-drop editor and run analysis from that position. Helps study critical moments, adjourned positions, or compositions. Proposed for v1.1, not v1.0.

F103 Puzzles from Your Own Blunders Generate tactics puzzles from mistakes found in the user’s own games. Reinforces learning from personal weaknesses. Suggested as a strong v1.1 candidate; not confirmed as v1.0.

### P2

To be confirmed.

## Core Flow

### Flow

1. User signs up or logs in with email.  
2. If parental consent is required, user enters parent email.  
3. System sends a 2-minute code to the parent email.  
4. Parent confirms using the code.  
5. User starts an over-the-board game analysis flow.  
6. User uploads a photo of the notation sheet while connected.  
7. System shows a warning that the user must stay on the active tab and must not switch tabs, close the tab, or let the phone sleep(I hope this doesn’t take too long then).  
8. System uploads the photo and performs a pre-scan after upload.  
9. If less than 80% of the moves are readable, system asks the user to retake the photo in better light.  
10. If the pre-scan passes, system reconstructs the game and validates move legality.  
11. System presents ambiguous moves with candidate corrections.  
12. User confirms or corrects flagged moves.  
13. System starts analysis and shows the first move explanation within about 5 seconds.  
14. User reviews move classifications, explanations, end-of-game summary, and study recommendations.  
15. At the end of the tournament/weekend flow, system asks: “How many games did you play in this tournament/weekend?”  
16. System calculates analysis reports viewed divided by games played as the primary game-entry success metric.

Additional v1 flow:

1. User enters opponent name for pre-tournament prep.  
2. User may add rating/federation for disambiguation.  
3. System searches public games and databases.  
4. User reviews found games, opening tendencies, patterns, and suggested preparation lines.

## User Flow

> **归一化说明**：以下用户故事的编号由归一化插入（`US-001` … `US-008`），每条故事的验收标准编号为 `AC-001` … `AC-008`。原文的 `US001` 标题与故事句在源文档里缺失，只留下了验收标准 —— 见 `Q-003`。

### US-001: Upload a Notation Sheet Photo (US001)

> `US-001` · 验收标准 `AC-001`（原文此处缺少故事句，见 `Q-003`）

Acceptance Criteria:

- Given I am logged in and connected to the internet  
- When I upload a notation sheet photo  
- Then the system performs an uploaded-photo pre-scan and proceeds only if at least 80% of moves are readable

### US002: Retake a Poor-Quality Notation Photo

> `US-002` · 验收标准 `AC-002`

As a player uploading a notation sheetI want to know when the app cannot read the page well enoughSo that I can retake the photo before wasting time on failed analysis

Acceptance Criteria:

- Given I upload a notation sheet photo  
- When the system detects that less than 80% of moves are readable  
- Then the system asks me to retake the photo in better light

### US003: Confirm Ambiguous OCR Moves

> `US-003` · 验收标准 `AC-003`

As a player whose notation was partially unclearI want to see uncertain moves and possible correctionsSo that I can quickly fix the game before analysis starts

Acceptance Criteria:

- Given the notation scan passes the pre-scan but contains ambiguous moves  
- When the OCR cannot confidently identify one or more moves  
- Then the system shows a list of uncertain moves with candidate move options for user confirmation

### US004: Understand Why Moves Were Good or Bad

> `US-004` · 验收标准 `AC-004`

As a developing chess playerI want plain-language explanations for my movesSo that I can understand the tactical or positional reasons behind mistakes and strong moves

Acceptance Criteria:

- Given I have confirmed the reconstructed game  
- When the analysis starts  
- Then the first move explanation appears within about 5 seconds, with a loading state if the full analysis is still processing

### US005: Receive a Post-Game Learning Summary

> `US-005` · 验收标准 `AC-005`

As a player reviewing a completed gameI want an end-of-game panel showing turning points, recurring themes, and accuracySo that I can focus my improvement on the most important lessons from the game

Acceptance Criteria:

- Given the game analysis is complete  
- When I open the end-of-game panel  
- Then I see key turning points, recurring themes, and overall accuracy

### US006: Get Personalized Study Recommendations

> `US-006` · 验收标准 `AC-006`

As a player who made specific mistakesI want study material matched to those mistakesSo that I know what to study next

Acceptance Criteria:

- Given the system identifies mistakes in my game  
- When I view the analysis report  
- Then relevant study recommendations are attached to the related moves and summarized in a study list

### US007: Prepare for an Opponent

> `US-007` · 验收标准 `AC-007`

As a tournament playerI want to enter an opponent’s name and review their public games and tendenciesSo that I can prepare openings and plans before a tournament game

Acceptance Criteria:

- Given I enter an opponent name  
- When the system finds public games or platform history  
- Then I can review opening preferences, common patterns, and suggested preparation lines

### US008: Complete Parental Consent

> `US-008` · 验收标准 `AC-008`

As a child user or parentI want account access to require parent email confirmationSo that the child can use the app with parental consent

Acceptance Criteria:

- Given a child user signs up  
- When they enter a parent email  
- Then the system sends a code that expires after 2 minutes and provides a resend code option

## Exception Handling

### EH001: Poor Photo Readability

- Trigger: Uploaded notation sheet photo has less than 80% readable moves.  
- System behavior: Stop reconstruction and request a new photo.  
- User feedback: Tell the user to snap again in better light.  
- Recovery / fallback: User retakes and uploads the photo again.

### EH002: Ambiguous OCR Moves

- Trigger: OCR can reconstruct most of the game but is unsure about specific moves.  
- System behavior: Show uncertain moves and candidate alternatives.  
- User feedback: User sees a list of moves the OCR thinks might be correct.  
- Recovery / fallback: User selects or confirms correct moves before analysis.

### EH003: Analysis Engine Crash or Timeout

- Trigger: Analysis engine crashes or fails mid-game.  
- System behavior: Retry the analysis once.  
- User feedback: To be confirmed.  
- Recovery / fallback: If the second attempt fails, show a partial report.

### EH004: User Switches Tab, Closes Browser, or Phone Sleeps During v1 Scan

- Trigger: User leaves the active tab, closes the tab/app, or phone sleeps during upload or analysis.  
- System behavior: Scan can fail or be lost.  
- User feedback: Before upload, show a clear warning and progress screen telling the user not to leave.  
- Recovery / fallback: User must restart the upload and analysis flow.

### EH005: Parent Email Code Expires or Does Not Arrive

- Trigger: Parent does not submit the code within 2 minutes, or the email/code fails to arrive.  
- System behavior: Code expires.  
- User feedback: Display resend code button.  
- Recovery / fallback: User can resend the code. Additional follow-up flow if the user still wants to use the app is to be confirmed.

### EH006: Parent Declines Consent

- Trigger: Parent declines the consent request.  
- System behavior: Account is deleted.  
- User feedback: Display “parent declined” sign/message before deletion.  
- Recovery / fallback: To be confirmed.

### EH007: Unsupported Browser

- Trigger: User opens the product on an unsupported browser or old browser version.  
- System behavior: Block or degrade unsupported experience.  
- User feedback: Show a clear message telling the user to use Chrome or Safari.  
- Recovery / fallback: User switches to a supported browser.

### EH008: Non-Chess or Invalid Image Upload

- Trigger: User uploads a non-chess image or an image that is not a notation sheet.  
- System behavior: To be confirmed.  
- User feedback: To be confirmed.  
- Recovery / fallback: To be confirmed.

### EH009: Opponent Name Disambiguation

- Trigger: Opponent search returns many players with the same or similar name.  
- System behavior: Ask for additional disambiguation such as rating or federation.  
- User feedback: User reviews possible matching profiles or provides more information.  
- Recovery / fallback: To be confirmed.

## Scope Boundaries

### In Scope

- Mobile web and desktop web application.  
- Latest two versions of Chrome and Safari for v1.  
- Current ChromeOS on school Chromebooks if possible.  
- Email-based user account creation.  
- Parent email code confirmation for child users.  
- Storing extracted game data, analysis reports, child name, parent email, and consent record.  
- US-only hosting for v1.  
- Uploaded notation photos deleted after analysis.  
- Notation sheet photo upload and OCR reconstruction.  
- Legal move validation.  
- Ambiguous move confirmation.  
- Move classifications and plain-language explanations.  
- End-of-game analysis summary.  
- Personalized study recommendations from web search.  
- Pre-tournament opponent prep using public games and public platform data.  
- Manual tournament/weekend denominator prompt: “How many games did you play in this tournament/weekend?”  
- Rating review collection.

### Out of Scope

- Live chess-playing platform.  
- Live play against humans.  
- Offline-first product behavior.  
- Background upload that survives tab switch, tab close, or phone sleep.  
- Dedicated mobile app for v1.  
- Support for very old phones or browsers.  
- Storing uploaded notation photos for model training in v1.  
- EU/GDPR international expansion for v1.  
- Requiring US Chess ID for v1 account creation.  
- Custom position setup in v1.0.  
- Coach personas in v1.0.  
- Play-vs-computer mode in v1.0.  
- Structured lesson modes in v1.0.

### Open Questions

- What exact launch cohort should be targeted first: middle-school players, high-school players, local clubs, coaches, or another segment?  
- What exact screens and UI components are used during the 20–30 second upload and pre-scan wait?  
- What exact UI is used for ambiguous move confirmation?  
- What is the minimum number of ratings/reviews needed before a 4–5 star average is considered reliable?  
- What is the target for backup metric: average analysis reports viewed per user per week?  
- Who owns the privacy policy and legal review?  
- Does the email-code method satisfy COPPA’s verifiable parental consent requirement after legal review?  
- Can a parent revoke consent later, and if so, through what interface?  
- What happens if upload exceeds 30 seconds on 4G?  
- What happens if the user uploads a non-notation image?  
- How should opponent disambiguation work when many public players share a name?  
- What search providers and chess platforms are officially supported in v1?

## Non-functional Requirements

### NFR

- Performance: Submit photo to move-confirmation screen should take around 20–30 seconds on a typical tournament-hall 4G connection. After confirmed moves, first explanation should appear within about 5 seconds. A loading state should appear if full analysis is still processing.  
- Submit photo to move-confirmation screen should take around 20–30 seconds on a typical tournament-hall 4G connection.  
- After confirmed moves, first explanation should appear within about 5 seconds.  
- A loading state should appear if full analysis is still processing.  
- Security: Users sign up with email. Child user flow requires parent email code confirmation. Parent code expires after 2 minutes. Resend code button is required. Uploaded notation photos must be deleted after analysis. Uploaded notation photos must not be stored for training in v1. Store extracted game data, analysis reports, child name, parent email, and consent record. Additional security requirements such as encryption, password policy, session duration, and audit logs: To be confirmed.  
- Users sign up with email.  
- Child user flow requires parent email code confirmation.  
- Parent code expires after 2 minutes.  
- Resend code button is required.  
- Uploaded notation photos must be deleted after analysis.  
- Uploaded notation photos must not be stored for training in v1.  
- Store extracted game data, analysis reports, child name, parent email, and consent record.  
- Additional security requirements such as encryption, password policy, session duration, and audit logs: To be confirmed.  
- Compatibility: v1 supports mobile web and desktop web. Latest two versions of Chrome and Safari are acceptable. Current ChromeOS on school Chromebooks should be supported if possible. Very old phones and browsers are not supported at launch. Unsupported browsers should show a clear message directing users to Chrome or Safari.  
- v1 supports mobile web and desktop web.  
- Latest two versions of Chrome and Safari are acceptable.  
- Current ChromeOS on school Chromebooks should be supported if possible.  
- Very old phones and browsers are not supported at launch.  
- Unsupported browsers should show a clear message directing users to Chrome or Safari.  
- Accessibility: To be confirmed.  
- To be confirmed.  
- Reliability: v1 does not support background upload or offline-first persistence. User must remain on the active tab during upload and analysis. If user switches tabs, closes the tab/app, or phone sleeps, scan may fail or be lost. Analysis crash should retry once; if the second attempt fails, system should show a partial report. More detailed reliability and retry policies: To be confirmed.  
- v1 does not support background upload or offline-first persistence.  
- User must remain on the active tab during upload and analysis.  
- If user switches tabs, closes the tab/app, or phone sleeps, scan may fail or be lost.  
- Analysis crash should retry once; if the second attempt fails, system should show a partial report.  
- More detailed reliability and retry policies: To be confirmed.

## Risks and Assumptions

### Risks

- COPPA compliance risk: product stores child name, parent email, consent record, game data, and analysis reports; legal review is required.  
- Email-code parental consent may not be sufficient as verifiable parental consent without legal validation.  
- v1 active-tab requirement creates high abandonment and data-loss risk if users switch tabs, close the browser, or the phone sleeps.  
- 20–30 second upload-to-confirmation target may be difficult on poor tournament Wi-Fi or 4G.  
- OCR accuracy may vary significantly with handwriting quality, lighting, and notation style.  
- Manual denominator metric depends on user self-reporting how many games they played.  
- Opponent prep depends on availability and reliability of public games and external search/platform APIs.  
- Study recommendations depend on external web search quality and relevance.  
- Children may not have parent nearby during sign-up, causing consent drop-off.  
- Unsupported older devices may exclude some scholastic users.

### Assumptions

- Users are willing to remain on the active browser tab until upload and analysis complete.  
- Users can access modern Chrome or Safari on phone, laptop, iPad, or Chromebook.  
- Parent is nearby or reachable during sign-up to complete a 2-minute code confirmation.  
- US-only hosting is acceptable for v1.  
- Deleting uploaded notation photos after analysis is sufficient for v1 privacy expectations.  
- Publicly available chess game records are sufficient for opponent preparation.  
- Players will answer the tournament/weekend games-played prompt accurately enough to support the 60–80% game-entry metric.

## Suggested Follow-up Questions

1. What exact launch user cohort should v1 target first?  
2. What should the upload/progress screen look like during the 20–30 second wait, including warning copy?  
3. What is the exact ambiguous-move correction UI?  
4. What is the target value for average analysis reports viewed per user per week?  
5. What minimum number of ratings/reviews is needed before a 4–5 star average counts as a success signal?  
6. Who will own legal review, COPPA compliance validation, and the privacy policy?  
7. Should parents be able to revoke consent later through a dashboard or email link?  
8. How should opponent search handle common names without requiring US Chess ID?

## Appendix

### Source Note

This PRD is generated from the complete conversation history between the user and PM Agent. Information not explicitly confirmed is marked as To be confirmed.  


[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAACeCAYAAABkWAWAAAAsp0lEQVR4Xu3dBcwtR9kH8OIagru7FncpTqFQKBa0Fw/uEKRQ3NtAWxyKFYoUAhSKFYoUl+BuxT24w375bTL3m/vc2d3ZI2/pPfNPJu95z8rZnXn8mXlmt66hYYOxW/yioWGT0BigYaPRGKBho9EYoGGj0RigYaPRGKBho9EYoGGj0RigYaPRGKBho9EYoGGj0RigYaPRGKBho9EYoGGj0RigYaPRGKBho9EYoGGj0RigYaPRGKBho9EYoGGjsRYG+OUvf9n96Ec/6v773//GQw0L4NWvfnV3netcp9tnn326j3/84/HwWvGtb32r+9e//hW/3mWwFga49rWv3e22227d3/72t3ioYSaOOeaY7jSnOU335Cc/ubvb3e7WnexkJ+t+/vOfx9PWgj/84Q/dWc961u7AAw+Mh3YZrJQB3v3ud3fPetazugtc4AI9AzztaU/rDj300O6vf/1rPHVp0C4vfelLu5vc5Cbda1/72nh4O0iwO93pTt297nWv7ic/+Uk8/D+Ppz71qd0ee+zRf/7GN77Rne1sZ+u++tWv7njSGvCPf/yju/e9792P45WudKV4eJfBShngrne9a99hebv0pS/d/epXv4qnLo299967u+IVr9i9/vWv785znvN0n/rUp+Ip/e+e4Qxn6J7ylKd0D3vYw7rznve88ZRB/OUvf+lucIMb7NDueMc7dj/96U/74wcffPBOx10DhxxyyE7HXvCCF+S3rwZpf7rTna673vWu1+2+++7dOc5xjrUIlBx+8/KXv3x30pOetHvLW97SneQkJ+l+8IMfxNMWxm9+85teUD796U8/3oXSShngZz/7WS9xSQzE/5WvfKXvuH//+9/x1KVxwQtesHvJS17Sf0aYz3/+88MZXf/7F77whbsf//jH3X/+85/uFKc4Ra/Wa8DuPdGJTtSd+9zn7i53uct1F7vYxXoG+t73vtcff+ADH9id6Uxn6o9hcu+b7v2gBz2o/y3HtJOf/OTdox/96Pz21fDct7rVrfpncc9XvvKVa/Ot3Ped73xnd/7zn7+7yEUu0vsesNdee3XXv/71u4997GP98ywDVsHpT3/67lznOlcvuE596lN3j3jEI9b2TlNYKQMkbIUPgChIQ5Jdh37uc5+Lp/SSxrHb3va2/QDq8DkgeZ/znOf0n7/85S935zznObsPfvCD3be//e3uLne5S29WwW9/+9v+fT//+c/3x2hCBJSAiZ797Gdv/78WX/jCF7qrXe1q3WUve9nu/e9/f691EM6DH/zgXtisEt/85je7Pffcs7f5H/OYx+xw7Pe//33fh6c97Wm7293udv25c4HA+TH68Kijjtr+/Sc+8YleSD3gAQ9Yi6CcwloYQMSC+lynqmaKXPe61+2lK+n4xz/+MZ7S40Y3ulF/DgL90Ic+FA+PwmA97nGP6z9jAKYAGxwRckwjA2DIdCxnANe87GUv2/5/Db7//e/397rmNa/ZR9WA9OUHIFKM8c9//jNctRho6fOd73zdGc94xu7Tn/50URr//e9/744++uheKBAknm8OjNfFL37x7m1ve1s81I+L3597z1VgFgOQhuxQA4zo2Nfs8M985jP9cfYcW5VaO/OZz9yrUioVfve733UPfehDe6ISyUCUPnO0fvGLX+Q/Uw1mCZV60YtetNixxx13XG82OHbKU56yH8A5uNSlLtXd/e537z8jgK997Ws7tOQPkFzx2He+853t96GFjjjiiO3/T4FJ4Jo3vvGNvTMageEe//jH94T4rne9Kx6eBQGEs5/97P1vEiKe0zgNgTkpHEsbvPCFL4yHB0HSG4NSBOtPf/pTT0+061ajigE4d0960pN67r/Wta7VfeADH+gl0Ytf/OJe2mOE173udT3xs4tJFARDdVP/H/nIR7rLXOYy/THqlcP62c9+treLdb6okbxBBMLCOCW7k1TUadTxE57whO4qV7nKTsTy8pe/vLfBOcOYzTuUYADitUDKMp2WkbQG/FSnOlUV83nPI488shcgGHsMfJRb3/rWPVEt4qAidv4EAaHvQJ8aJ9qL/1Tqd2B+0RY0YvKJpmDMvVfJ6cXQ7vXhD384Hlo7JhkAYVDDZznLWQY7+vDDD++ZgNTXcQkIh5nCHLrPfe7TM0XEn//8517KYq6kSeBLX/pSrzJJGlonOq+veMUr+muAyjYgj33sY7cf96wID7PCla985d43yYHBOKzuox100EE7HE8RJmHI/L1q4N055sluHjLRcnA6aVex/wjE+o53vGOH7zABIYK5v/71r+9wbAjemTObHNGPfvSj8ZQq8E+MN/sdAU+BH3H1q1+9F0o5Y/nMPDTGi1oCy2CSAWQeEbcY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>
---

# 归一化附录

> 以下三节由 `agb spec normalize` 归一化插入 —— **它们不新增需求**，只把原文里
> 已经写着的东西补成下游（`prd-id` / `prd-quality` / `page-coverage` /
> `contract-coverage` / 任务拆解）能锚的机器可读层：编号 ID、页面路由、UI 状态。
> 原文一个字都没有改写，基准是 `docs/PRD.source.md`。
>
> **凡是原文没说的，这里一律留空并指向一条 `Q-*`**，不替原文做决定。

## 附录 A：ID 索引

### 功能需求

原文的 `F001`–`F010`（P0）与 `F101` / `F103`（P1）已是门禁认的裸写法，归一化不重新编号。

| ID | 名称 | 优先级 | 对应用户故事 |
|---|---|---|---|
| `F001` | Post-Game AI Analysis Panel | P0 | `US-004` `US-005` |
| `F002` | Plain-Language Move Explanations | P0 | `US-004` |
| `F003` | End-of-Game Summary | P0 | `US-005` |
| `F004` | Personalized Study Recommendations | P0 | `US-006` |
| `F005` | Notation Sheet Photo Import | P0 | `US-001` `US-002` |
| `F006` | Ambiguous Move Confirmation | P0 | `US-003` |
| `F007` | Active-Tab Upload and Analysis Flow | P0 | `AC-010`（由 `Q-015` 补，原文无） |
| `F008` | Pre-Tournament Opponent Prep | P0 | `US-007` |
| `F009` | Email Account Sign-Up with Parental Consent | P0 | `US-008` |
| `F010` | Rating Review Prompt | P0 | `AC-009`（由 `Q-002` 补，原文无） |
| `F101` | Custom Position Setup | P1（v1.1） | — |
| `F103` | Puzzles from Your Own Blunders | P1（v1.1 候选） | — |

> `F102` 在原文中不存在，编号本身是跳号的 —— 归一化不补一个出来。

### 用户故事与验收标准

| 用户故事 | 验收标准 | 原文位置 |
|---|---|---|
| `US-001` Upload a Notation Sheet Photo | `AC-001` | `## User Flow` 起首（标题与故事句缺失，见 `Q-003`） |
| `US-002` Retake a Poor-Quality Notation Photo | `AC-002` | `### US002` |
| `US-003` Confirm Ambiguous OCR Moves | `AC-003` | `### US003` |
| `US-004` Understand Why Moves Were Good or Bad | `AC-004` | `### US004` |
| `US-005` Receive a Post-Game Learning Summary | `AC-005` | `### US005` |
| `US-006` Get Personalized Study Recommendations | `AC-006` | `### US006` |
| `US-007` Prepare for an Opponent | `AC-007` | `### US007` |
| `US-008` Complete Parental Consent | `AC-008` | `### US008` |

**覆盖缺口**：原文只有 `AC-001`–`AC-008` 共 8 条，`F007` 与 `F010` 两条 P0 功能
一条验收标准都没有。归一化**没有替原文补**，而是各记了一条问题（`Q-015` / `Q-002`）；
裁决之后补出 `AC-010` 与 `AC-009`，正文见附录 D。现在 10 条 P0 功能全部有验收标准可锚。

### 异常用例

`EH001`–`EH009` 沿用原文编号。`EH003` / `EH005` / `EH006` / `EH008` / `EH009`
的部分字段在原文里是 "To be confirmed"，逐条指向见附录 C。

## 附录 B：页面与路由（`PAGE-*` / `IC-*`）

页面清单**从原文的 Core Flow 与 Exception Handling 反推**，不引入原文没有描述的
屏幕。路由是归一化分配的（原文没有路由），UI 状态同理。

| ID | 页面 | 路由 | 来源 | 状态 |
|---|---|---|---|---|
| `PAGE-001` | Sign Up / Log In | `/signup` `/login` | Flow 1；`F009` | `idle` `submitting` `error` |
| `PAGE-002` | Parental Consent | `/consent` | Flow 2–4；`F009` `US-008` `EH005` `EH006` | `awaiting_parent_email` `code_sent` `expired` `declined` `confirmed` |
| `PAGE-003` | Dashboard / 我的对局 | `/` | Flow 5（"starts an … analysis flow" 的入口） | `loading` `empty` `populated` `error` |
| `PAGE-004` | Notation Photo Upload | `/analyze/upload` | Flow 6；`F005` `US-001` | `idle` `uploading` `retake_required`(`EH001`) `error` |
| `PAGE-005` | Stay-on-Tab Progress | `/analyze/processing` | Flow 7–10；`F007` `EH004` | `warning` `uploading` `prescanning` `reconstructing` `error` |
| `PAGE-006` | Ambiguous Move Confirmation | `/analyze/confirm` | Flow 11–12；`F006` `US-003` `EH002` | `loading` `populated` `submitting`（**具体 UI 未定，见 `Q-014`**） |
| `PAGE-007` | Analysis Report | `/games/:gameId` | Flow 13–14；`F001` `F002` `F003` `F004` | `loading` `partial`(`EH003`) `populated` `error` |
| `PAGE-008` | Tournament Games-Played Prompt | `/analyze/tournament-count` | Flow 15–16 | `idle` `submitting` |
| `PAGE-009` | Opponent Prep | `/prep` | Additional v1 flow；`F008` `US-007` `EH009` | `idle` `searching` `disambiguation`(`EH009`) `no_results` `populated` `error` |
| `PAGE-010` | Unsupported Browser Notice | `/unsupported` | `EH007` | `static` |

**未分配路由的产物**：`F010` 评分提示（`Q-002`：位置与平台未定）。原文写它是
一个"mechanism"而不是一个页面，归一化不替它造一个屏幕。

### 交互组件（`IC-*`）

只列原文明确描述过交互的组件。

| ID | 页面 | 组件 | 交互 | 效果 |
|---|---|---|---|---|
| `IC-01` | `PAGE-002` | Resend Code 按钮 | 点击 | 重发家长验证码（`EH005` 明确要求） |
| `IC-02` | `PAGE-004` | 照片上传 | 选择/拍照并提交 | 进入 `PAGE-005` 上传与预扫 |
| `IC-03` | `PAGE-004` | Retake 提示 | 点击重拍 | 回到 `IC-02`（`EH001`） |
| `IC-04` | `PAGE-006` | 候选着法列表 | 从候选中选择或确认 | 确认该半步，全部确认后进入分析（`F006`） |
| `IC-05` | `PAGE-007` | 逐步着法列表 | 点击某一步 | 展开该步的分类与自然语言解释（`F001` `F002`） |
| `IC-06` | `PAGE-007` | Study 推荐列表 | 点击条目 | 打开外部学习材料（`F004`） |
| `IC-07` | `PAGE-008` | 局数输入 | 提交数字 | 写入主成功指标的分母 |
| `IC-08` | `PAGE-009` | 对手检索表单 | 输入姓名（+ 评分 / 联合会） | 触发公开资料检索（`F008`） |

## 附录 C：未决台账指针

原文里每一处 "To be confirmed" 与 "Open Questions"，逐条对应 `.ab/questions.json`
里的一条 `Q-*`。**这一节只是指针**，答案与阻塞关系以台账为准
（门禁 `open-questions` 只读台账，不读这里）。

| 原文位置 | 原文写的 | 台账 |
|---|---|---|
| Overview · Owner | To be confirmed | `Q-025` |
| Overview · "Bug:" 段 | 棋子样式 alpha | `Q-004` |
| Target Users · First launch cohort | To be confirmed | `Q-019` |
| Metrics · 备用指标目标值 | To be confirmed | `Q-020` |
| Metrics · 评分可信所需评价数 | To be confirmed | `Q-021` |
| Metrics · analytics event 定义 | To be confirmed | `Q-022` |
| `F006` · 歧义确认 UI | To be confirmed | `Q-014` |
| `F008` · 对手评分必填与否 | 原文自相矛盾 | `Q-001` |
| `F009` · COPPA 合规 | 需法务复核 | `Q-012` |
| `F010` · 位置 / 平台 / 收集方式 | To be confirmed | `Q-002` |
| Core Flow · `US001` 标题与故事句 | 原文缺失 | `Q-003` |
| `EH003` · 用户可见文案 | To be confirmed | `Q-007` |
| `EH005` · 后续流程 | To be confirmed | `Q-008` |
| `EH006` · 恢复路径 | To be confirmed | `Q-009` |
| `EH008` · 系统行为 / 文案 / 兜底 | 三项均 To be confirmed | `Q-005` |
| `EH009` · 兜底 | To be confirmed | `Q-006` |
| Open Questions · 等待屏 UI 与警告文案 | To be confirmed | `Q-015` |
| Open Questions · 家长可否撤回同意 | To be confirmed | `Q-011` |
| Open Questions · 上传超过 30 秒 | To be confirmed | `Q-013` |
| Open Questions · 搜索与棋类平台供应商 | To be confirmed | `Q-010` |
| Open Questions · 隐私政策与法务负责人 | To be confirmed | `Q-023` |
| NFR · Security 其余项（加密 / 口令策略 / 会话时长 / 审计日志） | To be confirmed | `Q-017` |
| NFR · Accessibility | To be confirmed | `Q-016` |
| NFR · Reliability 其余重试策略 | To be confirmed | `Q-018` |
| 原文未提 · 账号凭证形式 | 缺失 | `Q-030` |

> 下面四条不在原文里，是归一化过程中**下游必须知道而原文没有回答**的决定，
> 同样进台账：`Q-026`（后端语言）、`Q-027`（OCR / 识别模型供应商）、
> `Q-028`（LLM 供应商）、`Q-029`（Figma 原型是不是 v1 UI 的准绳）。
> 前三条 TRD 里写着"provider to be confirmed"，第四条是本仓库
> `docs/prototype/` 的地位问题。

## 附录 D：裁决记录（`Q-*` 的答案回写）

台账 `.ab/questions.json` 是唯一权威（门禁 `open-questions` 只读它）。这一节是给人读的
那一份，**它不改写原文**：原文里那些 "To be confirmed" 原样留着，下面是它们各自
被裁决成了什么。裁决人 `xing`，日期 2026-09-10。

### 改变了规格的裁决

| `Q-*` | 裁决 | 落到哪 |
|---|---|---|
| `Q-001` | 对手评分**选填**。姓名必填；评分与联合会是可选消歧线索，消歧顺序 name → (当前 ∪ ratings.uschess.org 历史 rating) → federation；全不中返回空 matches 而非报错。F008 里那句 "must" 读成强烈建议，不是字段约束 | `_contracts/api-routes.json` |
| `Q-002` | F010 落成**站内评分**：`PAGE-007` 看完报告后的弹层，`IC-17` 1–5 星 + 可选文字，`POST /api/reviews`，实体 `Review`。Metrics 里的「4–5 星」指这个站内分数，不是应用商店 | `AC-009`（新增）· `.ab/prd.json` |
| `Q-003` | `US-001` = Upload a Notation Sheet Photo。故事句：作为一个刚打完比赛的棋手，我想拍一张记谱纸就把对局录入，不用逐步手敲 | 附录 A |
| `Q-004` | 「Bug:」那段**是要求**：棋盘棋子使用 alpha piece set，不用默认图集 | `UI_CONTRACT.md` · `.ab/design-tokens.json` |
| `Q-005` | `EH008` 并入 `EH001` 的 `retake_required` 状态，只换文案（「这张图里没有看到记谱纸…」）。不另开错误码 | `.ab/prd.json` `PAGE-004` |
| `Q-006` | `EH009` 返回 `{ status: "ambiguous", candidates: [...] }`，渲染在 `PAGE-009` 已有的 `disambiguation` 态；候选超过 N 条才回退到「请补充评分/联合会」 | `_contracts/api-routes.json` |
| `Q-007` | `EH003` 局部报告：顶部横幅「这份分析没能跑完：前 N 步已分析，第 N+1 步起缺失」+ 重试按钮；未分析的步置灰 | `UI_CONTRACT.md` |
| `Q-008` | `EH005` 掉队：账号挂起在 `suspended_awaiting_consent`，下次登录回到同意屏，可重发或改家长邮箱；未同意前不上传、不存对局数据；N 天后自动删除 | `WF-01` |
| `Q-009` | `EH006` 硬删账号，另存一条只含家长邮箱哈希 + 时间戳的 `consent_denials`；同邮箱不可重注册 | 数据层 schema |
| `Q-011` | 家长**可撤回同意**，走同意邮件里的长期签名链接 → `PAGE-011` `/consent/revoke`，触发与 `EH006` 同一条删除流程。不建家长账号、不建家长后台 | `PAGE-011`（新增） |
| `Q-013` | 20–30 秒是**目标值不是契约**：超 30 秒只改进度屏文案，硬上限 120 秒才判失败。理由：F007 已要求用户守在页面上，提前弄挂等于让他白守 | `.ab/prd.json` `VAR-07` |
| `Q-014` | `PAGE-006` 歧义确认 UI **以原型的 `ocr` 步骤为准**，不另做设计 | `UI_CONTRACT.md` |
| `Q-015` | 等待屏布局取原型的 `processing` 步骤；警告文案定为「分析中，请保持这个页面打开 —— 切换标签页、关闭浏览器或手机锁屏会中断，需要重新上传」。为 F007 补验收标准 `AC-010` | `AC-010`（新增） |
| `Q-016` | 无障碍基线 **WCAG 2.1 AA**：键盘可达、焦点可见、对比度 4.5:1、表单有 label、错误不只靠颜色。着法分类必须有颜色之外的第二重编码（原型的 `CLS_SYM` 符号表充当） | `UI_CONTRACT.md` |
| `Q-017` | 传输 TLS 1.2+ 与 HSTS；静态全库加密，`child_name` / `parent_email` 列级加密；会话 30 天滑动过期（`httpOnly` + `Secure` + `SameSite=Lax`）；审计只记同意发出/确认/拒绝、账号删除、照片删除；照片分析完立即删 + S3 lifecycle 24h 兜底。**口令策略作废**（见 `Q-030`） | `DEC-*`（arch） |
| `Q-018` | 统一重试策略：外部调用走同一个指数退避客户端（最多 3 次，只重试幂等 GET 与 5xx/429）；对手检索单源失败降级为部分结果并标明哪个源没到；SSE 断线自动重连并拉一次当前进度。`EH003` 的分析重试一次不变 | `DEC-*`（arch） |
| `Q-022` | 埋点最小集六个：`photo_uploaded` / `prescan_failed` / `moves_confirmed` / `analysis_completed` / `report_viewed` / `tournament_count_submitted`，写进自建 `metric_events` 表，不接第三方分析工具。主指标 = `report_viewed` 去重计数 ÷ `tournament_count_submitted` | 数据层 schema |
| `Q-030` | **无密码**：邮箱验证码登录。`POST /api/auth/request-code` → `POST /api/auth/verify-code` → 会话 cookie；6 位码与 2 分钟过期复用家长同意的同一套机制。不建 password 字段、不做密码找回 | `PAGE-001` · `_contracts/api-routes.json` |

### 技术准绳

| `Q-*` | 裁决 |
|---|---|
| `Q-026` | 全栈 TypeScript：React 18 + TS + Vite 6 + Tailwind v4 / Node 22 + TS + Fastify / PostgreSQL + Prisma / chess.js 前后端共用同一份合法性校验 / Stockfish 18 服务端 worker / SSE |
| `Q-027` | 托管分割 + 托管识别 + **后置**合法性过滤（拿不到 logits，做不了解码时硬约束）。≥90% 目标按 TRD §10 用标注集实测，达不到再考虑自托管 VLM。走 OCR provider 适配器 |
| `Q-028` | Claude（Anthropic API）。首条解释走 Haiku 4.5 保 5 秒（`AC-004`），全局总结与败因走 Sonnet 5 |
| `Q-029` | `docs/AI Chess Analysis Tool/` 那份 Figma Make 原型**是 v1 UI 的准绳**：`theme.css` 与四张着法分类表是设计 token 的直接来源，组件骨架是 UI 契约的基准 |
| `Q-010` | v1 只接四个外部源：uschess MSA 爬虫 + FIDE 月度 XML dump（优先吃 dump）+ Lichess API + Chess.com Published-Data API。ChessBase 与通用网页搜索推到 v1.1 |

### 补出来的两条验收标准

原文里 `F007` 与 `F010` 两条 P0 功能一条验收标准都没有。裁决之后各补一条：

**`AC-009`（补 `F010`）**

- Given 我看完了一份分析报告
- When 这是我第一次看完报告，且距上次评分弹层出现已超过 30 天
- Then 弹出 1–5 星评分（可选填文字），提交或关闭后 30 天内不再弹

**`AC-010`（补 `F007`）**

- Given 我提交了一张记谱纸照片
- When 上传与分析进行中
- Then 页面持续显示分阶段进度与一条「不要离开此页」的警告，且在浏览器标签页失焦时仍然可见

### 还没答的两条 —— **这一阶段没有做完**

| `Q-*` | 问题 | 挡住 |
|---|---|---|
| `Q-012` | 邮件验证码算不算 COPPA 的「可验证家长同意」？谁负责法务复核？ | **`ship`** |
| `Q-023` | 隐私政策由谁写、法务复核由谁负责？ | **`ship`** |

人明确选择「现在不答」。两条都**不挡** `arch` / `detail` / `qa` / `code` —— 开发可以
往下走。但 `open-questions` 会在交付口拦住，而那**不是门禁坏了**：一个存儿童姓名、
家长邮箱与同意记录的产品，在这两条有结论之前不能上线。若 `Q-012` 的复核结论是
「不算」，`F009` 的整条同意流程要换（信用卡验证 / 签名表单），而那时代码已经写完了。

> **`PAGE-010` 与 `PAGE-011` 是刻意的孤儿页。** `prd-quality` 会把它们报成
> 「没有任何被描述的导航能到达」（info 级），那条判定是对的 —— 站内确实没有
> 入口，而这是设计：`PAGE-010` 由浏览器嗅探强制跳入（`EH007`），`PAGE-011`
> 只能从家长同意邮件里的签名链接进（`Q-011`，家长没有账号，站内也就无处放这个入口）。
> 两者的 `entry` 字段在 `.ab/prd.json` 里写清了这件事。**留着这条 info，不要为了
> 消掉它而加一个没人会点的按钮。**
