# docs

Human-facing deliverables. These belong to the project, not to the tooling —
they should still make sense to someone who never opens `.agents/`.

| Directory | Holds | Template |
|---|---|---|
| `prd/` | Product requirements — why, for whom, what success is | `.agents/templates/prd.md` |
| `frd/` | Functional requirements — behaviours, rules, edge cases | `.agents/templates/frd.md` |
| `tdd/` | Technical design — components, data, contracts | `.agents/templates/tdd.md` |
| `adr/` | Architecture decision records, `NNNN-slug.md` | `.agents/templates/adr.md` |

Which of these get written is set by the active track's `design.*` gates. On the
`poc` track, all four are skipped by design — an empty `docs/` there is correct,
not an oversight.

ADRs are numbered sequentially and never deleted. A decision that no longer holds
gets a new ADR, and the old one is marked `superseded by ADR-NNNN`.
