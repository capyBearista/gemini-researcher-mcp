# Dependabot Configuration Contract

## Document Status

- **Role**: Canonical specification for Dependabot behavior in this repository
- **Status**: Living specification (normative)
- **Audience**: Maintainers and contributors
- **Canonical config file**: `.github/dependabot.yml`
- **Last validated**: 2026-04-09 against current `main`

## Scope and Precedence

This document defines repository policy for Dependabot version updates and security updates.

Precedence:

1. `.github/dependabot.yml` (runtime truth)
2. `docs/dependabot-configuration-contract.md` (human-readable contract)

If they diverge, update this document to match `.github/dependabot.yml`.

## 1) Execution Model

Dependabot executes two independent channels:

1. **Version updates**
   - Scheduled by `.github/dependabot.yml` `updates[].schedule`.
   - Filtered by `groups`, `ignore`, and `open-pull-requests-limit`.

2. **Security updates**
   - Driven by Dependabot alerts/security-update capability.
   - Can open fix PRs when a non-vulnerable resolution is available.

## 2) Current Effective Policy

Configuration source:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "monthly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
    open-pull-requests-limit: 5

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
    open-pull-requests-limit: 3
```

Policy summary:

- Ecosystems: `npm`, `github-actions`
- Cadence: monthly, Monday, 06:00 UTC
- Routine major updates: suppressed
- PR caps: npm=5, github-actions=3

## 3) Config Snippet Reference (Behavioral)

## A) Schedule and ecosystem scope

```yaml
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "monthly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
```

Behavior:

- Triggers monthly version-update checks for both ecosystems.
- Uses root directory scope for npm and workflow action references.

## B) PR metadata and volume control

```yaml
updates:
  - package-ecosystem: "npm"
    labels: ["dependencies", "npm"]
    commit-message:
      prefix: "chore(deps)"
    open-pull-requests-limit: 5

  - package-ecosystem: "github-actions"
    labels: ["dependencies", "github-actions"]
    commit-message:
      prefix: "chore(ci-deps)"
    open-pull-requests-limit: 3
```

Behavior:

- Applies deterministic labels and commit prefixes.
- Enforces per-ecosystem PR cap.

## C) Grouping model

```yaml
updates:
  - package-ecosystem: "npm"
    groups:
      npm-security:
        applies-to: security-updates
        patterns: ["*"]
      npm-nonmajor:
        applies-to: version-updates
        patterns: ["*"]
        update-types: ["minor", "patch"]

  - package-ecosystem: "github-actions"
    groups:
      github-actions-nonmajor:
        patterns: ["*"]
        update-types: ["minor", "patch"]
```

Behavior:

- Groups npm security updates under `npm-security`.
- Groups routine non-major updates for npm and GitHub Actions.

## D) Major-version suppression

```yaml
updates:
  - package-ecosystem: "npm"
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "github-actions"
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
```

Behavior:

- Prevents routine major-version PR creation in both ecosystems.
- Leaves major upgrades as explicit maintainer actions.

## 4) Operational Sequences

## Scheduled run sequence

1. Run starts for each configured ecosystem on schedule.
2. Candidate updates are resolved.
3. Group/ignore rules are applied.
4. PRs are opened up to `open-pull-requests-limit`.
5. Remaining candidates are deferred to future runs.

## Maintainer development sequence

1. Feature and bugfix PRs proceed normally.
2. Dependabot PRs are reviewed/merged independently.
3. Lockfile conflicts are resolved by standard merge/rebase flow.
4. Security fix PRs take precedence over non-security maintenance PRs when conflict order matters.

## 5) Cadence Change Procedure (`monthly` -> `weekly`)

Patch pattern:

```yaml
updates:
  - package-ecosystem: "npm"
    schedule:
      interval: "weekly" # changed from "monthly"
```

Procedure:

1. Edit target `updates[]` block(s) in `.github/dependabot.yml`.
2. Change `schedule.interval` from `monthly` to `weekly`.
3. Commit and merge.

Recommended rollout:

1. Switch `npm` first.
2. Keep `github-actions` monthly unless action-update latency requires weekly cadence.
3. Re-evaluate PR volume after 1-2 cycles.

## 6) Manual Trigger Procedure

## A) Trigger version-update job now

UI path:

1. Repository -> `Insights`
2. `Dependency graph`
3. `Dependabot`
4. Target ecosystem -> `Recent update jobs`
5. `Check for updates`

Result:

- Executes immediate version-update job using current `.github/dependabot.yml`.

## B) Trigger targeted security-update PR now

UI path:

1. Repository -> `Security and quality` -> Dependabot Vulnerabilities
2. Open alert
3. `Create Dependabot security update` (when available)

Result:

- Attempts a fix PR for selected alert.

## C) Verify manual trigger outcome

UI path:

1. `Insights` -> `Dependency graph` -> `Dependabot`
2. Open `Recent update jobs`
3. Inspect status and `View logs`

## 7) Validation Checklist

Contract checks:

1. `.github/dependabot.yml` parses as valid YAML.
2. Exactly two ecosystem blocks: `npm`, `github-actions`.
3. Each block includes schedule, grouping (where defined), major-ignore policy, PR limit.
4. `.github/dependabot.yml` is tracked (not hidden by ignore rules).

Last validation status:

- YAML parse: pass
- Ecosystem block count: pass (2)
- Git tracking gate: pass (`.gitignore` includes `!.github/dependabot.yml`)

## 8) Change Governance

Required same-change updates for policy changes:

1. `.github/dependabot.yml`
2. `docs/dependabot-configuration-contract.md`

Optional companion updates:

- `CONTRIBUTING.md` (workflow expectations changed)
- `CHANGELOG.md` (material release/process impact)
