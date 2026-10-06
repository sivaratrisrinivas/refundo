# Demo walkthrough: captioned script

Silent recording (`walkthrough.webm`, about 2:04) of one Playwright run through the real UI. There is no narration and no human-recorded portion. The captions below are burned into the video. The banner "All data is synthetic" is visible throughout.

Regenerate with `bun run walkthrough` after `bun run e2e`'s build. Every metric shown comes from the stored eval reports (`eval/reports/`).

| Time | What is on screen and what the caption says |
| --- | --- |
| 0:00 | Invite-only demo. Everything here is synthetic, and the banner says so on every page. |
| 0:06 | Enter the passcode. This is demo-grade sign-in; the server still checks the role on every action. |
| 0:12 | The Queue is sorted by chargeback risk, then age. Tickets that threaten a dispute sit on top. |
| 0:20 | Open the $164.11 mixed Session. The Ticket text keeps the extracted grievances highlighted. |
| 0:28 | Checkpoints 4 and 5 repeat one error: a loop, decided by a rule. Checkpoints 2 and 3 are the first two repeats and are not credited. |
| 0:38 | Checkpoint 6 claimed the CSV export was fixed while its test failed. The evidence drawer highlights only the fields the Label cites. |
| 0:50 | Only code sets the amount, from a written policy: Credit lines for each Checkpoint, summing to the total, inside the Pro Cap. |
| 0:59 | The Simulated model was not confident about a Checkpoint, so it became Unknown. A person settles it, and must give a reason. |
| 1:10 | Approve once. One transaction writes the Orb credit at zero cost basis, the itemized reply and the audit row. |
| 1:18 | The Systems page shows the writes landing in the mock Orb, Zendesk and Linear. |
| 1:27 | Approving the same Session again is refused by the server. Nothing is written twice. |
| 1:35 | The audit log is for Lead and Reviewer, so switch Persona. It is append-only and hash-chained: any edit would break the chain. |
| 1:43 | Eval, all simulated: label agreement 92.3% on model A and 68.1% on model B, read from stored reports. The guardrails, not the models, are what is measured. |
| 1:56 | A Lead can reset the demo: the app returns to the exact seeded state, ready to run again. |

Second Approval attempt, as recorded: `409 already_approved`.
