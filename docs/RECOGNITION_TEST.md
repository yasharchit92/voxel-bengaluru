# Blind human recognition test — protocol (NOT YET RUN)

**Status: designed only. No participants have been tested and no results exist.**

## Question
Can people who know Bengaluru identify districts and features from the model with labels switched off, at a rate clearly above chance?

## Participants
- Group A: 12+ residents of ≥ 3 years, recruited across at least four different home areas (to avoid a central-Bengaluru bias).
- Group B (control): 6+ people who have never lived in Bengaluru. They establish the guess rate from generic "Indian city" cues.

## Stimuli
Open `voxel-bengaluru.html?ui=0&seed=1`, press `L` to hide labels, turn the Metro/road overlays off. Capture 16 stills:
- 8 from the built-in presets 2–8 and the street view (heading rotated by a random multiple of 45° so north-up habit does not help);
- 4 "landmark" close-ups (Vidhana Soudha + High Court, Chinnaswamy Stadium, Bellandur Lake, Hebbal flyover + lake);
- 4 **foils**: two views of ordinary residential fabric with no landmark, and two mirror-flipped views of real areas.
Present in a per-participant random order.

## Tasks, per image
1. Free response: "Where in Bengaluru is this?" (60 s).
2. Then four-way forced choice among area names (the correct one plus three areas of similar character).
3. Confidence 1–5, and "what told you?" (free text).

## Scoring
- Free response is correct if it names the area, an adjacent area, or a feature visible in the image. Two raters score independently; report Cohen's κ.
- Primary metric: Group A forced-choice accuracy on the 12 real images against 25 % chance (exact binomial, per participant and pooled).
- Secondary: A minus B accuracy; free-response accuracy; foil behaviour (mirror images should be rejected or draw low confidence — high-confidence "recognition" of a mirror image means people are reading generic texture, not geography).

## Pre-registered pass criteria
- Group A pooled forced-choice accuracy ≥ 60 %, and ≥ 25 points above Group B.
- At least 5 of the 8 preset views recognised by a majority of Group A in free response.
- Lake and stadium close-ups ≥ 75 % in Group A.

## Use of results
Views that fail identify where district grammar is too generic; the "what told you?" answers say which cues to strengthen (or which are misleading).
