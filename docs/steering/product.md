---
inclusion: always
---

# Closure Call — Product Context

Weather-driven facility-closure decision-support and notification system, built for the
USDA "Closure Call" challenge and deployed on Akamai Cloud.

## What it does
Ingests live National Weather Service data plus at least one supplementary signal, evaluates
threat against a specific facility, recommends a **graded** closure posture to a human
decision-maker (with full reasoning), builds a targeted notification package, and writes an
auditable decision record.

## Non-negotiable principles
- **Human-in-the-loop by design.** The system supports the decision; it never makes it. Never
  auto-execute a closure. The posture is a *recommendation*.
- **Live data, not mocks.** Weather must come from the real NWS API (`https://api.weather.gov`).
- **Graded, not binary.** Valid postures: `normal`, `delayed_arrival`, `early_dismissal`,
  `unscheduled_telework`, `full_closure`.
- **Every recommendation is explainable.** Output must include each input (with source +
  timestamp), which threshold was crossed and by how much, confidence, what would change the
  recommendation, and a one-paragraph plain-language rationale.
- **The decision record is a first-class deliverable**, not a log line. It must be reconstructable
  after the fact: what was known, when, and what was decided.
- **Thresholds must be defensible.** Every cutoff cites a source (NWS alert severity/certainty/
  urgency fields, state DOT thresholds, or OPM operating-status categories).

## Scope discipline
One synthetic facility profile + two or three hazard types, handled well. Do not broaden to every
facility type or hazard. Narrow and deep beats broad and shallow.
