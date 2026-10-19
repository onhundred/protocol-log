---
name: Onhundred
description: Social Experiment 001, a public field log of one founder handing his life to AI.
colors:
  darkroom-black: "#0A0A09"
  bone-paper: "#E8E8E2"
  live-wire-green: "#C6F432"
  field-note-grey: "#8C9087"
  faded-bone: "#B4B8AE"
  dormant-grey: "#7A7E74"
  graphite-rule: "#3A3D37"
  hairline-ink: "#1F211E"
  field-edge: "rgba(232, 232, 226, 0.55)"
  unmapped-edge: "rgba(232, 232, 226, 0.2)"
  mapped-fill: "rgba(198, 244, 50, 0.2)"
  mapped-edge: "rgba(198, 244, 50, 0.3)"
  assisted-fill: "rgba(198, 244, 50, 0.42)"
  assisted-edge: "rgba(198, 244, 50, 0.55)"
  delegated-fill: "rgba(198, 244, 50, 0.68)"
  delegated-edge: "rgba(198, 244, 50, 0.8)"
  termination-orange: "#FF9F5A"
typography:
  figure:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(64px, 20.3vw, 168px)"
    fontWeight: 780
    lineHeight: 0.86
    letterSpacing: "-0.04em"
    fontFeature: "\"tnum\", \"lnum\""
    fontVariation: "\"wdth\" 80"
  figure-desktop:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(120px, 13vw, 176px)"
    fontWeight: 780
    lineHeight: 0.86
    letterSpacing: "-0.04em"
    fontFeature: "\"tnum\", \"lnum\""
    fontVariation: "\"wdth\" 80"
  caption:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(18px, 5vw, 30px)"
    fontWeight: 640
    lineHeight: 1.1
    letterSpacing: "-0.005em"
  display:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(40px, 11.5vw, 96px)"
    fontWeight: 880
    lineHeight: 0.98
    letterSpacing: "-0.025em"
    fontVariation: "\"wdth\" 78"
  headline:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(18px, 4.6vw, 24px)"
    fontWeight: 300
    lineHeight: 1.4
  join-title:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(24px, 6vw, 34px)"
    fontWeight: 760
    lineHeight: 1.05
    letterSpacing: "-0.015em"
    fontVariation: "\"wdth\" 85"
  title:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(18px, 4.6vw, 22px)"
    fontWeight: 400
    lineHeight: 1.3
  confession:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(14px, 3.6vw, 22px)"
    fontWeight: 400
    lineHeight: 1.4
  body:
    fontFamily: "Archivo, Archivo Fallback, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Martian Mono, Martian Fallback, Menlo, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.14em"
  label-action:
    fontFamily: "Martian Mono, Martian Fallback, Menlo, Courier New, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.12em"
  label-area:
    fontFamily: "Martian Mono, Martian Fallback, Menlo, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.06em"
  note:
    fontFamily: "Martian Mono, Martian Fallback, Menlo, Courier New, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  input:
    fontFamily: "Martian Mono, Martian Fallback, Menlo, Courier New, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1
rounded:
  cell: "3px"
  control: "4px"
  plate: "6px"
  pill: "999px"
spacing:
  2xs: "4px"
  xs: "8px"
  sm: "10px"
  md: "14px"
  lg: "22px"
  xl: "40px"
  2xl: "48px"
  3xl: "64px"
  section-sm: "72px"
  section-md: "88px"
  section-lg: "96px"
  gutter: "clamp(20px, 5.6vw, 40px)"
  cell-row-gap: "5px"
  cell-col-gap: "6.5px"
  cell-col-gap-desktop: "7px"
  group-gap: "clamp(2px, 1.2vw, 14px)"
components:
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.bone-paper}"
    typography: "{typography.label-action}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "44px"
  button-outline-hover:
    backgroundColor: "{colors.bone-paper}"
    textColor: "{colors.darkroom-black}"
  button-signal:
    backgroundColor: "transparent"
    textColor: "{colors.live-wire-green}"
    typography: "{typography.label-action}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "44px"
  button-signal-hover:
    backgroundColor: "{colors.live-wire-green}"
    textColor: "{colors.darkroom-black}"
  link-cta:
    textColor: "{colors.bone-paper}"
    typography: "{typography.label-action}"
    padding: "12px 0"
  link-cta-hover:
    textColor: "{colors.live-wire-green}"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.bone-paper}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  tag-sample:
    backgroundColor: "transparent"
    textColor: "{colors.live-wire-green}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "25px"
  readout-figure:
    textColor: "{colors.bone-paper}"
    typography: "{typography.figure}"
  readout-caption:
    textColor: "{colors.bone-paper}"
    typography: "{typography.caption}"
  area-label:
    backgroundColor: "transparent"
    textColor: "{colors.field-note-grey}"
    typography: "{typography.label-area}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "24px"
  area-label-hover:
    textColor: "{colors.bone-paper}"
  area-label-pressed:
    textColor: "{colors.live-wire-green}"
  stage-pill:
    backgroundColor: "transparent"
    textColor: "{colors.dormant-grey}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  stage-pill-hover:
    textColor: "{colors.bone-paper}"
  stage-pill-current:
    textColor: "{colors.live-wire-green}"
  legend-item:
    backgroundColor: "transparent"
    textColor: "{colors.bone-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0 10px"
    height: "48px"
  legend-item-active:
    backgroundColor: "{colors.hairline-ink}"
  grid-cell-unmapped:
    backgroundColor: "transparent"
    rounded: "{rounded.cell}"
  grid-cell-mapped:
    backgroundColor: "{colors.mapped-fill}"
    rounded: "{rounded.cell}"
  grid-cell-assisted:
    backgroundColor: "{colors.assisted-fill}"
    rounded: "{rounded.cell}"
  grid-cell-delegated:
    backgroundColor: "{colors.delegated-fill}"
    rounded: "{rounded.cell}"
  grid-cell-autonomous:
    backgroundColor: "{colors.live-wire-green}"
    rounded: "{rounded.cell}"
  experiment-row:
    textColor: "{colors.bone-paper}"
    typography: "{typography.title}"
    padding: "18px 0"
---

# Design System: Onhundred

## Overview

**Creative North Star: "The Subject's Field Log"**

The page reads like an observation journal kept on a single human subject. A near-black darkroom field holds bone-white text, and every piece of metadata (dates, cycle numbers, statuses, section labels) is stamped in narrow monospace like a clinical entry. The voice is clinical, candid and unsettling: the system stays calm and procedural so the human crack in the copy ("Let's see what's left of me.") lands harder.

The first screen is a vital-sign readout, not a headline. One enormous condensed figure ("81% of him is still him") sits on top of the delegation grid, which acts as its meter. Tapping an area of the grid isolates its cells and the figure counts to that area's share, so the instrument answers the visitor's question in place. Density is low and deliberate below the fold: sections breathe with 48 to 96px of vertical padding inside a 1120px column, and content is separated by hairline rules rather than boxes. Color is almost absent. A single acid signal, Live-Wire Green, marks what is alive, delegated, actionable or flagged as sample data; everything else is a ladder of olive-tinted greys.

The page is also built to weigh almost nothing. There are no rasters anywhere: every visual is type or a CSS-drawn cell. Two self-hosted font files (about 54KB together), CSS inlined into the HTML, and roughly 1KB of compressed JavaScript for the grid. Weight is part of the world; a field log does not need a photo shoot.

**Key Characteristics:**
- Dark-first: Darkroom Black field, Bone Paper text, no light theme.
- One accent, used as a signal of "live", "delegated", "act here" or "sample", never as decoration.
- Two typographic voices: condensed Archivo for the subject, narrow Martian Mono for the experiment.
- The readout figure and the grid are one instrument; isolation changes the number, never the layout.
- Flat surfaces; structure comes from hairline rules, outlines and opacity.
- Softly squared, outlined controls (4px) with tracked mono labels, never smaller than a 44px target.
- No rasters, two font files, inline CSS, a kilobyte of JavaScript.

## Colors

A warm near-black field and a ladder of olive-cast greys, punctured by one acid-green signal and one failure orange.

### Primary
- **Live-Wire Green** (#C6F432): the only accent. It drives the live line's SAMPLE flag, every SAMPLE tag, the OBSERVE button, the current cycle stage, the pressed area label, RUNNING statuses, link hover, the focus ring, the text caret, text selection, the skip link and the autonomous grid cells. Its translucent steps are the delegation scale: mapped (20% fill, 30% edge), assisted (42% / 55%), delegated (68% / 80%), autonomous solid. Every state that has been touched at all is green-tinted; only the unmapped cell has no green in it.

### Tertiary
- **Termination Orange** (#FF9F5A): the failure color. It appears on the TERMINATED status of an experiment that was stopped and on the border of a field the visitor has filled in wrongly.

### Neutral
- **Darkroom Black** (#0A0A09): page background, theme color, and the text color on filled green or Bone Paper buttons. Never pure #000.
- **Bone Paper** (#E8E8E2): primary text, the brand line, the readout figure and caption, outline buttons, the observe note, footer links and the CONCLUDED status. A 20% step of it draws the dashed edge of unmapped cells; a 55% step (field edge) draws the boxed input at rest.
- **Faded Bone** (#B4B8AE): secondary copy: the live line, Join body copy, legend descriptions and input placeholders.
- **Field-Note Grey** (#8C9087): mono metadata: section titles, area labels at rest, experiment IDs, field labels, the stage note, legend counts, the signature, the footer and the NOT STARTED status.
- **Dormant Grey** (#7A7E74): inactive stage pills, the arrows between them, and the outline a stage draws on hover. Raised from #5E625A, which measured 3.18:1 on Darkroom Black; the new value clears 4.78:1.
- **Graphite Rule** (#3A3D37): the outline an area label draws on hover, and the scrollbar thumb.
- **Hairline Ink** (#1F211E): 1px section dividers and experiment row separators; also the fill of a legend item on hover and while pressed.

### Named Rules
**The One Live Signal Rule.** Live-Wire Green means "live, current, delegated, act here, or sample". It never decorates and never fills a large area at rest; the only green fills are grid cells, the OBSERVE button on hover, and the skip link.

**The Termination Rule.** Termination Orange is reserved for failure: terminated experiments and invalid input. It is not a general warning or emphasis color.

**The Olive Cast Rule.** Every neutral, from Darkroom Black to Bone Paper, shares a faint olive hue (about 105° to 135° in OKLCH). Never introduce a pure neutral grey like #888 or a blue-tinted grey.

**The Green Ladder Rule.** Delegation is one hue climbing in opacity (0, 20, 42, 68, 100%). A new delegation state gets a step on this ladder, not a new color.

## Typography

**Display Font:** Archivo (with Archivo Fallback, Helvetica Neue, Arial, sans-serif)
**Body Font:** Archivo (with Archivo Fallback, Helvetica Neue, Arial, sans-serif)
**Label/Mono Font:** Martian Mono (with Martian Fallback, Menlo, Courier New, monospace)

**Character:** Archivo carries the subject's human voice, from whisper-light confession (300) to a heavy, condensed, tightly tracked question (880 at 78% width). Martian Mono is the lab's voice: narrow, light and tracked, always in grey, Bone Paper or the signal color.

Both faces are self-hosted woff2, subset to Basic Latin and Latin-1 plus dashes, quotes, bullet, ellipsis and arrows (enough for English and Spanish). Archivo ships as one variable file spanning weight 300 to 900 and width 75 to 100, so every condensed headline comes from the same 47KB file. Martian Mono ships as one static instance cut at width 75 and weight 350 (7KB), declared as the 400 face so every mono label picks it up. Martian Mono replaced IBM Plex Mono: the approved plan required a mono outside impeccable's default-face list, and IBM Plex Mono is on that list.

Each face has a metric-matched local fallback (Archivo Fallback over Arial/Helvetica, Martian Fallback over Menlo/Courier New) with size-adjust, ascent and descent overrides, so the swap from fallback to webfont shifts nothing (layout shift stays at 0).

### Hierarchy
- **Figure** (780, clamp(64px, 20.3vw, 168px), 0.86; desktop clamp(120px, 13vw, 176px)): the readout percentage. 80% width, -0.04em tracking, tabular lining numerals so the count never jitters. One per page.
- **Caption** (640, clamp(18px, 5vw, 30px), 1.1; 30px on desktop): the line under the figure ("OF HIM IS STILL HIM"). It auto-shrinks, down to 11px, to stay on one line.
- **Display** (880, clamp(40px, 11.5vw, 96px), 0.98): the central question. 78% width, -0.025em, max 13ch, balanced wrapping.
- **Headline** (300, clamp(18px, 4.6vw, 24px), 1.4): the manifesto body, max 34em. The closing line switches to 700 for the punch.
- **Join Title** (760, clamp(24px, 6vw, 34px), 1.05): the three Join headings. 85% width, -0.015em.
- **Title** (400, clamp(18px, 4.6vw, 22px), 1.3): experiment questions.
- **Confession** (400, clamp(14px, 3.6vw, 22px), 1.4): the two hero lines under the figure, max 34ch, one line each.
- **Body** (400, 16px, 1.55): Join copy in Faded Bone, max 40ch. Legend descriptions use Archivo at 14px.
- **Label** (Martian 400, 11px, 0.14em, uppercase): section titles. Brand and live line run at 0.08em (12px on desktop); field labels and legend names at 0.1em; experiment statuses at 0.12em.
- **Label Action** (Martian 400, 12px, 0.12em, uppercase): OBSERVE, SUBMIT MY COMPANY, READ THE PROTOCOL.
- **Label Area** (Martian 400, 11px, 0.06em, uppercase; 12px on desktop): the three area labels over the grid.
- **Note** (Martian 400, 12px, 1.6, sentence case): the observe note, the stage note, the footer, the vote placeholder.
- **Input** (Martian 400, 12px, 1, lowercase placeholder): text inside fields.

### Named Rules
**The Two Voices Rule.** Archivo speaks for the subject; Martian Mono speaks for the experiment. Metadata, statuses, labels, notes and controls are mono; confessions, questions and descriptions are Archivo.

**The Stamped Label Rule.** Mono labels are uppercase with 0.06em to 0.14em tracking (tightest on the area labels, widest on section titles). Sentence-case mono is reserved for notes and the footer; lowercase mono for field text and placeholders.

**The Two Files Rule.** The whole type system is two font files. Width and weight come from Archivo's axes, not from extra families or extra files.

## Layout

A single centered column, max 1120px wide with fluid side gutters (clamp(20px, 5.6vw, 40px)). The page is a vertical sequence: masthead, hero (readout, grid, confession, observe form, cycle stages), delegation legend, manifesto question, experiments, join, footer. Every section after the hero opens with a 1px Hairline Ink top border. Vertical rhythm uses section padding of 48 to 96px (legend 48/64, manifesto 88/96, experiments 48/72, join 64/80, footer 40/56) and smaller internal gaps on an informal scale (4, 8, 10, 14, 22, 40px).

The design reference is a 390px portrait phone; desktop is the secondary layout. Below 960px everything stacks in one column, in story order. At 960px and up the masthead splits brand left and live line right; the hero becomes two columns (readout, confession and observe form on the left; the grid on the right, 72px apart) with the stages and stage note spanning full width beneath; the legend becomes five columns; the manifesto puts the question beside its body; experiment rows gain a right-hand status column; Join becomes three columns 48px apart; the footer splits consent left and credits right. Type sizes between those states scale with clamp().

The delegation grid is laid out on one shared track list. Every cell column of every area (4 Relationships, 4 Personal, 3 Company) is a column of a single CSS grid, separated per area by a group gutter column; each area and its cells use subgrid to sit on those tracks. All three areas therefore share one cell pitch, and cells are fluid squares (1fr wide, aspect-ratio 1) rather than fixed pixels. Cell gaps are 5px between rows and 6.5px between columns (7px rows and columns on desktop). The visible gutter between areas is the group gap (clamp(2px, 1.2vw, 14px)) plus the two cell gaps either side of it.

### Named Rules
**The Still Instrument Rule.** Interacting with the readout never moves the layout. Captions shrink to stay on one line, the stage note reserves two lines of height, and isolation changes only opacity and the figure's digits.

## Elevation & Depth

The system is flat. There are no shadows, gradients or blurs. Depth and focus come from three tools: hairline rules (Hairline Ink), outline weight (dashed vs solid, translucent vs opaque edges), and opacity. When an area, stage or state is isolated, every non-matching cell drops to 8% opacity over 0.45s on an expo-out curve, so the focused set seems to come forward without moving. The one box-shadow in the build is a 1px Live-Wire Green ring that thickens a focused field's border; it is a focus edge, not elevation.

### Named Rules
**The Flat Lab Rule.** No elevation shadow, no gradient, no backdrop blur. If something needs emphasis, change its outline, its color, or the opacity of everything around it.

## Shapes

The form language is softly squared and instrumental. Action controls (buttons, fields) and SAMPLE tags use a 4px corner. Grid cells and legend swatches use 3px. The legend item's hover plate uses 6px. The only fully round shapes are the area labels and stage pills (999px) and the 6px LIVE dot. Borders are always 1px; dashed borders mean "not yet mapped". The approved direction called for square controls; the build settled on 4px, and that is the system.

## Components

### Buttons
Instrumental, outlined, and filled only under the pointer.
- **Shape:** gently squared (4px), 44px tall, 22px side padding, Label Action mono.
- **Outline (default):** transparent background, 1px Bone Paper border, Bone Paper text. Used for SUBMIT MY COMPANY.
- **Signal:** the same shape in Live-Wire Green border and text. Used for OBSERVE, the primary action.
- **Hover / Focus / Active:** hover fills the button with its own border color and turns the text Darkroom Black (0.25s expo-out). Keyboard focus draws a 2px Live-Wire Green outline 3px out. Pressing nudges the button down 1px.

### Text Links
- **CTA link:** Label Action mono in Bone Paper, underlined (1px, offset 0.6em), with 12px vertical padding to enlarge the target.
- **Inline and footer links:** Bone Paper, 1px underline at 0.25em offset; footer links carry 10 to 12px of vertical padding to enlarge the target.
- **Hover:** every link turns Live-Wire Green.

### SAMPLE Tag
A small outlined stamp that marks data as sample: 25px tall, 8px side padding, 4px corner, 1px Live-Wire Green border and text, 11px mono at 0.08em. It sits after the readout caption (with a tooltip explaining the sample data), after the legend heading and after the experiments heading; in the live line the same flag appears as plain green text. Wherever data is placeholder, a SAMPLE marker sits next to it.

### Inputs / Fields
- **Style:** boxed: transparent background, 1px field-edge border (Bone Paper at 55%), 4px corner, 44px tall, 14px side padding, 12px Martian Mono in Bone Paper, lowercase placeholder in Faded Bone.
- **Hover:** border goes to solid Bone Paper.
- **Focus:** border and a 1px ring turn Live-Wire Green (a 2px green edge in total); no outline.
- **Error:** after the visitor interacts, an invalid field's border turns Termination Orange.
- **Label:** the observe forms use a visually hidden label; the submit form shows uppercase Field-Note Grey labels above each field.
- **Pairing:** in observe forms the field and the signal button share one row 9px apart, with the note on its own line below.

### Cycle Stage Pills
- **Style:** MAP → DELEGATE → REVIEW, centered, 11px mono at 0.1em, separated by Dormant Grey arrows. Each button is 44px tall; the pill outline is drawn 6px in from top and bottom, so it reads as a 32px pill inside a 44px target.
- **States:** at rest Dormant Grey with no outline; hover or pressed shows Bone Paper text and a Dormant Grey outline; the current stage is Live-Wire Green text and outline.
- **Behavior:** a stage isolates its cells in the grid (MAP: unmapped and mapped; DELEGATE: assisted, delegated, autonomous; REVIEW: cells that changed this cycle) and swaps its explanation into the stage note below.

### Legend Items
- **Style:** one row per delegation state: a 14px swatch (the cell itself), the uppercase state name (11px mono, 0.1em) over a 14px Archivo description in Faded Bone, and the count in Field-Note Grey tabular figures. Rows are 48px minimum on mobile; on desktop they become five columns.
- **State:** hover and pressed fill the item with Hairline Ink on a 6px plate. A pressed item isolates its state in the grid.

### Experiment Rows
- **Style:** list rows with 18px vertical padding and a Hairline Ink rule between them (none after the last). Mono ID in Field-Note Grey (64px column, 80px on desktop), Title-size question in Bone Paper, mono status under the title on mobile and in its own right-hand column on desktop.
- **Status colors:** RUNNING in Live-Wire Green, CONCLUDED in Bone Paper, NOT STARTED in Field-Note Grey, TERMINATED in Termination Orange.

### Navigation (Masthead)
Two mono lines at 11px (12px on desktop), 0.08em tracking. The brand line is Bone Paper. The live line is Faded Bone: a 6px Live-Wire Green dot, then LIVE · CYCLE · DAY, then a green SAMPLE flag while the data is sample. The dot is static; nothing on the page loops. A skip link to the observe field appears in Live-Wire Green when focused.

### The Readout (Signature Component)
The hero figure and its meter. It is a single heading made of the figure (Figure type, Bone Paper), the caption (Caption type) and the SAMPLE tag. The figure shows how much of the subject is still his. When an area is isolated, the figure counts to that area's percentage over 480ms with an exponential ease-out, driven frame by frame, and the caption swaps to the area's line ("OF HIS COMPANY IS STILL HIS"). Under reduced motion the number changes instantly. A caption that would wrap shrinks in half-pixel steps until it and the tag fit on one line, so the grid below never shifts under the pointer.

### Delegation Grid (Signature Component)
Three areas (Relationships 4 columns, Personal 4 columns, Company 3 columns) of fluid square cells on one shared track list (see Layout), each headed by its area label. Cells have 3px corners and a 1px edge. Fills follow a five-step escalation, all on the Live-Wire Green ladder except the first:
- **Unmapped:** transparent with a dashed edge of Bone Paper at 20%.
- **Mapped:** green at 20% fill, 30% edge.
- **Assisted:** green at 42% fill, 55% edge.
- **Delegated:** green at 68% fill, 80% edge.
- **Autonomous:** solid Live-Wire Green.

**Area labels** are pills: 11px mono (12px on desktop) at 0.06em, 24px drawn height with an invisible hit area extended to 44px. At rest Field-Note Grey with no outline; hover turns the text Bone Paper and draws a Graphite Rule outline; pressed turns text and outline Live-Wire Green.

**Isolation (the signature interaction).** Tapping an area label isolates its cells: the other areas drop to 8% opacity and the Readout counts to that area's percentage. Stage pills and legend items isolate by state instead. Only one isolation is active at a time; choosing an area clears a state and vice versa, tapping the active control again clears it, and Escape clears everything. With a mouse, hovering any of these controls previews its isolation and leaving restores the pressed one. Every control reports its pressed state to assistive technology.

### Named Rules
**The 44px Rule.** Every tap target is at least 44px tall. Small visual forms (area pills, stage pills) are drawn inside a 44px hit area, never shrunk to their drawn size.

## Do's and Don'ts

### Do:
- **Do** keep the page dark: Darkroom Black (#0A0A09) background with Bone Paper (#E8E8E2) text.
- **Do** set every piece of metadata, status, label, note and control in Martian Mono; labels uppercase at 0.06em to 0.14em tracking.
- **Do** separate sections and list rows with 1px Hairline Ink rules instead of cards or boxes.
- **Do** express delegation level with the five-step Live-Wire Green ladder (dashed outline, then 20%, 42%, 68% and solid green).
- **Do** use opacity (down to 0.08) to isolate a subset of the grid rather than adding new colors.
- **Do** put a SAMPLE marker next to every number, list or date that is placeholder data.
- **Do** hold the accessibility floors: functional text at 11px or larger, metadata notes at 12px or larger, tap targets at least 44px, text contrast at least 4.5:1, and every animation removed under reduced motion.
- **Do** keep the page weightless: no rasters, the two existing font files (about 54KB), inline CSS, and about 1KB of JavaScript.

### Don't:
- **Don't** use Live-Wire Green for decoration, backgrounds or large areas; it marks only live, delegated, actionable or sample things.
- **Don't** use Termination Orange for anything other than failure or invalid input.
- **Don't** add elevation shadows, gradients or blur.
- **Don't** introduce pure neutral greys or a second accent color.
- **Don't** let an interaction reflow the hero; the readout and grid stay put while the number changes.
- **Don't** add a looping animation; the live dot is static.
- **Don't** add a third font file or a raster image to show what type and CSS cells can draw.
- **Don't** set confessional or question copy in mono, or metadata in Archivo.
