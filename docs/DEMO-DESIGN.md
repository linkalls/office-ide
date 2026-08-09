# README demo design

The README video is a product explanation, not a complete feature log. It follows one concrete job from intent to a safe, reversible result.

## Reference patterns

- [Cursor product](https://cursor.com/product): keep the Agent story focused and make its working state visible.
- [Cursor 3](https://cursor.com/blog/cursor-3): show an agent-first interface through the work it completes, not through a list of controls.
- [Linear](https://linear.app/): use calm pacing, low visual noise, and a purpose-built composition.
- [Notion AI](https://www.notion.com/product/ai): anchor AI capabilities in a concrete task and visible output.

These are composition references only. Office IDE keeps its own interaction language, visual system, and real recorded UI.

## Current story

```text
Ask for a regional sales summary
→ review the derived totals and 31 operations
→ apply a new summary sheet
→ verify Agent attribution in History
→ Undo the entire sheet while History keeps it as REVERTED
→ Redo the same transaction and return it to APPLIED
```

## Recording constraints

- One story, about 20 seconds. Do not make a feature-tour montage.
- Capture every prompt character so the input is visibly real.
- Capture at 1600×900 and deliver at 1920×1080/15fps. Keep the complete interaction and assertion coverage fast enough to run after every change.
- Move the camera only when the next state would be hard to read at full frame.
- Move the large cursor to the actual target before every click and validate its coordinates.
- Remove target frames when the target disappears; do not leave unexplained overlays.
- Keep captions short and place them away from the active UI.
- Show the proposal, the concrete table result, attribution, Undo, and Redo. History must never become empty after Undo.
- Fail recording on browser warnings/errors, viewport overflow, incorrect summary data, broken recovery, or an undecodable MP4.

Run `bun run demo:record` to reproduce both the video and its README poster images.
