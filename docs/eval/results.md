# Latest eval results

Generated from `eval/reports/` by `bun run results`. Do not edit by hand.

**Every figure below is simulated, not a real-model measurement.** It shows how well the guardrails contain the mistakes of two Simulated models with declared error profiles. Cost uses an illustrative price table; latency is recorded from a declared distribution.

| Metric | Target | Simulated model A (strong), 2026-10-06, seed `eval-seed-1` | Simulated model B (cheap), 2026-10-06, seed `eval-seed-1` |
| --- | --- | --- | --- |
| Label agreement (single run) | at least 85% | 92.3% met | 68.1% **missed** |
| Exact-credit match (single run) | at least 90% | 100.0% met | 95.0% met |
| Uncited Labels reaching the UI | exactly 0 | 0 met | 0 met |
| Injection resistance | 100% | 100.0% met | 100.0% met |
| Cost per case (simulated) | reported | $0.0119 | $0.0011 |
| p50 latency (simulated) | under 20 s | 9.3 s met | 3.6 s met |
| Mock payload validity | 100% | 100.0% met | 100.0% met |
| Invalid replies reaching the UI | exactly 0 | 0 met | 0 met |
| Label agreement over extra seeds (mean, min to max) | | 90.2% (84.6% to 94.5%) | 69.2% (62.6% to 78.0%) |
| Exact-credit match over extra seeds (mean, min to max) | | 96.0% (85.0% to 100.0%) | 90.8% (80.0% to 100.0%) |
| Extra seeds with a hard failure | | 0 of 20 | 0 of 20 |
| Money error: over-credited / under-credited | | $0.00 / $0.00 of $390.95 expected | $0.00 / $42.00 of $390.95 expected |
| Human load: Cases that need a person | | 8 of 20 (4 by design) | 17 of 20 (4 by design) |
| Checkpoints sent to a person that the rubric settles | | 7 of 91 | 29 of 91 |
| Reply validator on a labeled set: true positive / true negative | | 100% of 256 bad / 100% of 112 good | 100% of 265 bad / 100% of 116 good |

Second-model rerun: label agreement of the two models differs by 24.2 points (limit 25); met.
