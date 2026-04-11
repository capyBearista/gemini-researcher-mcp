# CodeQL Configuration Contract

## Document Status

- **Role**: Canonical specification for CodeQL static analysis behavior in this repository
- **Status**: Living specification
- **Audience**: Maintainers and contributors
- **GitHub UI Configuration**: Enabled via Settings → Code security and analysis
- **Last validated**: 2026-04-10 against current `main`

## Scope and Precedence

This document defines repository behavior for GitHub CodeQL static analysis and security scanning.

Precedence:

1. GitHub UI configuration (runtime truth for Default setup)
2. `docs/codeql-configuration-contract.md` (contract)
3. `.github/workflows/codeql.yml` (if Advanced setup is adopted)

If configuration diverges from this document, update this document to match runtime truth.

## 1) Execution Model

CodeQL runs in two configuration modes:

1. **Default setup**
   - Zero-configuration scanning via GitHub UI.
   - Auto-detects languages and optimal query packs.
   - Triggered on push to default branch and pull requests.

2. **Advanced setup**
   - YAML workflow configuration (`.github/workflows/codeql.yml`).
   - Customizable: query packs, build steps, paths, schedules.
   - Manual control over analysis scope and rules.

## 2) Current Effective Policy

Configuration source:

- **Mode**: Default setup
- **Language**: JavaScript/TypeScript (auto-detected)
- **Query suites**: Default security and quality suites
- **Triggers**: Push to `main`, pull requests

Policy summary:

- Language: `javascript-typescript`
- Trigger events: push, pull_request
- Query packs: GitHub default (security-extended, security-and-quality)
- Build mode: autobuild (zero custom steps)
- PR annotations: enabled
- Alert notifications: enabled

## 3) Configuration Model Reference (Behavioral)

## A) Default Setup (Current)

Configuration path:

```
Repository Settings → Code security and analysis → CodeQL analysis → Default
```

Behavior:

- Zero file-based configuration required.
- Automatic language detection at runtime.
- Uses GitHub-curated query packs (security-extended, security-and-quality).
- Runs on every push to default branch and on pull requests.
- Results appear in Security → Code scanning alerts.
- Inline annotations on pull request diffs.

## B) Advanced Setup (Deferred)

Configuration file (if adopted):

```yaml
# .github/workflows/codeql.yml
name: "CodeQL"

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  schedule:
    - cron: '0 9 * * 1'  # Weekly Monday 09:00 UTC

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [ 'javascript-typescript' ]

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended,security-and-quality

      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
```

Behavior:

- Explicit YAML control over triggers, languages, and queries.
- Custom build steps if autobuild is insufficient.
- Scheduled analysis frequency independent of development activity.
- Fine-grained path inclusions/exclusions.

## 4) Query Suite Semantics

| Query Pack | Purpose | Severity |
|------------|---------|----------|
| `security-extended` | Security vulnerabilities (SQL injection, XSS, path traversal, etc.) | High |
| `security-and-quality` | Security + reliability issues (null derefs, resource leaks, logic bugs) | Medium-High |
| `security-experimental` | Emerging threat patterns (optional) | Variable |

Current selection:

- Default setup automatically includes `security-extended` and `security-and-quality`.
- No custom queries active.

## 5) Operational Sequences

### Scan execution sequence

1. Trigger fires (push to `main` or pull request opened/updated).
2. GitHub starts an analysis runner.
3. CodeQL builds database from source code.
4. Query packs execute against database.
5. Results are published to Security tab.
6. Pull request annotations appear inline (if applicable).

### Alert review sequence

1. Navigate to Security → Code scanning alerts.
2. Filter by severity, rule, or path.
3. Assess finding: true positive / false positive / won't fix.
4. Dismiss with justification or create remediation issue.
5. Track remediation through to closure.

## 6) Mode Transition Procedure (Default → Advanced)

Procedure:

1. Navigate to Settings → Code security and analysis.
2. Disable Default setup for CodeQL analysis.
3. Select Advanced setup.
4. Generate workflow file (GitHub provides template).
5. Commit `.github/workflows/codeql.yml` to repository.
6. Update this document to reflect Advanced mode.

Rollback path:

1. Delete or disable `.github/workflows/codeql.yml`.
2. Re-enable Default setup in repository settings.
3. Update this document to reflect Default mode.

## 7) Validation Checklist

Contract checks:

1. CodeQL is enabled in repository settings.
2. Mode matches documented configuration (currently Default).
3. At least one successful scan has completed.
4. Results are visible in Security → Code scanning alerts.
5. Language detection matches codebase (JavaScript/TypeScript).

Last validation status:

- CodeQL enabled: pass
- Initial scan completed: pass (no issues detected)
- Language detection: pass (javascript-typescript)
- Results access: pass

## 8) Change Governance

Required updates when changing CodeQL configuration:

1. GitHub UI settings (Default mode) or `.github/workflows/codeql.yml` (Advanced mode)
2. `docs/codeql-configuration-contract.md`

Optional companion updates:

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) (CI expectations changed)
- [`CHANGELOG.md`](../CHANGELOG.md) (material security posture change)
- [`README.md`](../README.md) (security badge or scanning notice)

---

End of Contract (Living Spec)
