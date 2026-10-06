# Refundo

Refundo turns a customer's "I was charged for broken Agent work" ticket into an itemized, policy-priced credit decision that a support specialist approves in one click. Models label evidence; code computes money; a human approves.

## Language

**Ticket**:
The support-system record a customer wrote about a charge: subject, body, whether a dispute is threatened.
_Avoid_: Complaint, request

**Case**:
The assembled working unit a specialist opens: a Ticket plus its account, Session, Checkpoints, signals, Labels and Decision. A Case is keyed by its Ticket.
_Avoid_: Claim, dispute

**Session**:
One continuous Agent working run, billed as a series of Checkpoints.
_Avoid_: Run, conversation

**Checkpoint**:
The unit of billed Agent work, priced by effort. It is the atom that is labeled and credited.
_Avoid_: Step, commit

**Persona**:
The role the viewer is acting as in the demo: Specialist, Lead or Reviewer.
_Avoid_: User, account type

## Judging a Checkpoint

**Label**:
One verdict about a Checkpoint from a fixed set, decided by rule, model or human, and citing the Checkpoint fields that support it. A Checkpoint has exactly one final Label.
_Avoid_: Tag, category, classification

**Clause**:
A numbered policy provision (C1 to C8) that maps a Label to a credit percentage.
_Avoid_: Rule

**Simulated model**:
A deterministic stand-in for an LLM with a declared error profile. Its output is never presented as a measurement of a real model.
_Avoid_: Mock model, fake LLM

## Money

**Credit**:
Goodwill balance issued to a customer's account. Refundo never issues cash.
_Avoid_: Refund, reimbursement, compensation

**Credit line**:
The Credit for one Checkpoint. The lines of a Decision sum to its amount.
_Avoid_: Item, charge

**Decision**:
The proposed or approved outcome of a Case: Labels, Clauses, Credit lines, amount and status.
_Avoid_: Verdict, adjudication

**Cap**:
The per-plan ceiling on goodwill Credit within 30 days.
_Avoid_: Limit, quota

**Headroom**:
The Cap minus Credit already granted in the 30-day window.
_Avoid_: Remaining balance

**Chargeback bump**:
When a dispute is threatened, a raised ceiling of 1.5 times the Cap minus Credit already granted. Needs Lead approval.
_Avoid_: Escalation, surcharge

## Review

**Override**:
A specialist's change to a Label or an amount. It always carries a reason.
_Avoid_: Edit, correction

**Approval**:
The act that makes a Decision real and triggers the downstream writes. A Session can be approved at most once, whatever the policy version.
_Avoid_: Sign-off, confirm
