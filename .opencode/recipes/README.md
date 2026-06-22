# UOS Recipes

Recipes define domain workflows. They are not submodels and are not
user-selectable opencode agents.

A recipe composes functional submodels from `.opencode/submodels/` and adds
domain-specific rules such as folder conventions, navigation patterns, naming,
quality bars, and artifact review checkpoints.

The Orchestrator reads a selected recipe end to end, decomposes it into bounded
Task Packets, and passes only the relevant recipe slice to each submodel
handoff. A Task Packet should fit a practical context packet, have one owner,
and produce one reviewable artifact or evidence bundle.
Submodels may use the recipe for constraints and quality bars, but they do not
own the global recipe workflow or approval sequence.

## Required Sections

Each recipe should include:

- `## Domain`
- `## Uses Functional Submodels`
- `## Orchestration Model`
- `## Recipe Workflow`
- `## Artifacts`
- `## Evidence`

## Current Recipes

- `kiosk`: folder-driven kiosk/exhibition content workflow.
