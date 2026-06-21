# CLAUDE.md

Context and rules for building Baseline in Claude Code.

## What this is

A personal eczema tracker for one user, self-hosted on a Beelink and used from an iPhone as an installed PWA. This is a private tool for the owner's own use. The owner has asked the AI analysis to go beyond hedged suggestions: it may draw research-grounded conclusions about likely triggers and controls, identify aggravating (negative) factors as well as protective ones, and rely on reported results and dermatology research. It still flags treatment changes for the owner's dermatologist to validate, since changing medication is a clinical decision, not a tracking one.

This is a personal project. Keep it entirely separate from any work or Arcadis context. Nothing in this repo references work projects, and no work credentials or APIs are used here.

## Design source of truth

`docs/mockup.html` is the approved visual design and interaction model. Build the real UI to match it. Do not redesign it.

Design tokens (Palette B):
- bg `#F1EFE8`, surface `#FCFBF7`, ink `#2C2C2A`, steel `#5F5E5A`, mid `#888780`, border `#D8D5C9`
- positive / gain `#639922`, alert / loss `#E24B4A`
- allergen states: likely `#F7DCDB`/`#8A2825`, possible `#F3E6CF`/`#6E4708`, unlikely `#E7F0D8`/`#3B5A12`

Type: Space Grotesk for headings and numbers, Inter for body and data. Two weights only, 400 and 500.

Copy rule: no em dashes anywhere in UI copy.

## App model

- Capture is event-based. The user logs single timestamped events through the day: meal, cream (emollient), itch (0 to 10), photo, note. They compose into a daily log and a rolled-up day summary. An optional evening summary closes the day.
- Timestamps matter. Trigger analysis depends on lining up, for example, a 1pm meal against a 9pm itch reading. The Rinvoq reminder logs the actual time the user taps taken, not 10:00.
- Screens (see mockup): Today (feed), Meals (analyzer), Skin (episodes + severity + photo history), Trends (itch line with change-events marked), Insights (analysis), Dermatologist summary (6-month report), Reminders (settings). Plus a Library screen added after the mockup.
- Library: one unified products catalog for creams/emollients and medications. Each product has a name, brand, front and back label photos, and AI-extracted fields (active ingredients, purpose, efficacy, side effects). Logging a cream application or a medication picks from this library. Rinvoq keeps its own 10:00 reminder; allergy pills and other meds are logged as `medication` events that reference a product.
- Episodes: a flare on a region has a baseline ("current condition", the before) photo and a series of progress (after) photos. Progress photos can link to a cream application so the UI shows "12h after applying X" and a severity-over-time curve. Photos are stored as `photo` events tagged with episodeId and photoKind (episode | progress); episodes live in their own table.

## AI features

- Meal analyzer: photo plus optional text description to the Anthropic API. Returns dish, rough calorie range, allergen flags across dairy, egg, gluten, nuts, soy, shellfish, high-histamine, alcohol (each likely / possible / unlikely), visible ingredients, and a caveat about hidden ingredients. The text description is trusted over the image for anything it mentions.
- Skin severity: photo to the Anthropic API. Returns a 0 to 10 rubric across redness, scaling, and affected area. Consistency (same spot, light, distance) is what makes the trend meaningful.
- Insights: feed recent logs plus the symptom trend to the model and ask it to find what drives the condition. Correlate food (meal allergen flags), medications (Rinvoq plus any others), creams, sleep/stress, and skin severity against the itch and severity trend, with 1 to 3 day trigger lag in mind. It may state likely triggers and controls as research-grounded conclusions, rate the evidence strength, and call out confounds. It must surface aggravating factors (what makes it worse), not only improvements, and ground claims in atopic dermatitis research and reported results. Treatment changes are flagged for the dermatologist.
- Use the owner's own Anthropic API key, model `claude-opus-4-8`, for the vision and reasoning calls. Keep the key in `.env`, never commit it.

## Privacy

Photos are kept by default (the user wants a record for the dermatologist). Store images locally on the Beelink. The only time an image leaves the machine is the API call to analyze it. Store extracted tags and scores alongside each photo. Do not commit any personal data.

## Reminders (already scaffolded)

PWA web push. Server-side `node-cron` at 10:00 and 21:30 `America/Toronto` sends pushes via `web-push` to stored subscriptions. iOS requires the installed (Home Screen) PWA, manual add, and permission requested only after standalone launch on a user gesture. Do not use `beforeinstallprompt` for iOS; show the install hint instead.

## Build tasks

1. Build the full UI from `docs/mockup.html` as the served app in `public/`, wired to a `/api/log` model per event type.
2. Persist events, daily composites, photos (with extracted AI data), and severity assessments in SQLite.
3. Wire the meal analyzer and skin severity to the Anthropic API with the owner's key.
4. Build the Trends chart and Insights from real logged data.
5. Generate the dermatologist summary from the stored history.
6. Honor the reminder deep links (`/?log=rinvoq`, `/?screen=closeout`) by opening the matching capture flow.

## Conventions

- No build step. Plain static front end served from `public/`.
- Keep secrets in `.env`. `.gitignore` already covers `.env`, `data/`, and `node_modules/`.
- Run under PM2 as `baseline` on the Beelink.
