# Bare `just` errors; developer must specify a recipe name.
# No quotes around the echo arg so cmd.exe doesn't echo the literal quotes.
[private]
default:
    @echo "ERROR: no recipe specified"
    @exit 1

# every third-party tool runs through mise so mise.toml pins apply without
# requiring shell activation (mandatory for Windows, where mise is shim-based).
MISE := "mise exec --"

set shell := ["bash", "-euo", "pipefail", "-c"]
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

# One-time host setup: install pinned toolchain, then the locked workspace.
setup:
    mise install
    {{MISE}} bun install --frozen-lockfile

# Run all tests (Bun test runner across the workspace).
test:
    {{MISE}} bun test --pass-with-no-tests

# Format TypeScript/JSON code in place (Biome, format only).
fmt:
    {{MISE}} biome format --write .


# Run lint checks: the fail-fast gate, in fixed order.
lint:
    @echo "==== running biome format check ===="
    @{{MISE}} biome format .

    @echo "==== running tsc type check (TypeScript 7 native) ===="
    @{{MISE}} bun x tsc --noEmit
    @{{MISE}} bun x tsc --noEmit --project tsconfig.browser.json
    @{{MISE}} bun x tsc --noEmit --project tsconfig.worker.json

    @echo "==== running oxlint with type-aware rules (tsgolint) ===="
    @{{MISE}} bun x oxlint --type-aware

    @echo "==== running knip deadcode check ===="
    @{{MISE}} bun x knip --no-progress

    @echo "==== running jscpd clone-budget check ===="
    @{{MISE}} jscpd .
