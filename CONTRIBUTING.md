# Contributing to ErnOS

Welcome to ErnOS! 🧠

**New to GitHub?** Start with the [Git & GitHub Beginner's Guide](./docs/git-guide.md) — it explains exactly what commits are, how to write good commit messages, and how the GitHub workflow operates.

## Quick Links

- **GitHub:** https://github.com/MettaMazza/ErnOS
- **Manifesto:** [`MANIFESTO.md`](MANIFESTO.md)
- **Discord:** https://discord.gg/Yr7WNYWcj6

## Maintainer

- **Maria Smith (MettaMazza)** — Project lead, cognitive architecture, ErnOS kernel
  - GitHub: [@MettaMazza](https://github.com/MettaMazza)

## How to Contribute

1. **Bugs & small fixes** → Open a PR!
2. **New features / architecture** → Open a [GitHub Issue](https://github.com/MettaMazza/ErnOS/issues) or ask in Discord first
3. **Questions** → Join the [ErnOS Discord](https://discord.gg/Yr7WNYWcj6)
4. **New to GitHub?** → Read the [Git & GitHub Beginner's Guide](./docs/git-guide.md)

## Before You PR

- Test locally with your ErnOS instance
- Run tests: `pnpm build && pnpm check && pnpm test`
- Ensure CI checks pass
- Keep PRs focused (one thing per PR; do not mix unrelated concerns)
- Describe what & why

## AI/Vibe-Coded PRs Welcome! 🤖

ErnOS is itself an AI-augmented project. PRs built with Codex, Claude, or other AI tools are welcome — just mark it!

Please include in your PR:

- [ ] Mark as AI-assisted in the PR title or description
- [ ] Note the degree of testing (untested / lightly tested / fully tested)
- [ ] Include prompts or session logs if possible (super helpful!)
- [ ] Confirm you understand what the code does

AI PRs are first-class citizens here. We just want transparency so reviewers know what to look for.

## Current Focus & Roadmap 🗺

We are currently prioritizing:

- **Stability**: Core memory graph and dream cycle reliability.
- **Documentation**: Making ErnOS accessible to no-code contributors.
- **Security**: Continuing to harden the sandbox and Observer subsystem.

Check the [GitHub Issues](https://github.com/MettaMazza/ErnOS/issues) for "good first issue" labels!

## Report a Vulnerability

We take security reports seriously. If you discover a vulnerability (such as a Docker escape flaw, prompt injection bypass, or authentication weakness), please open a [GitHub Security Advisory](https://github.com/MettaMazza/ErnOS/security/advisories/new) or review [SECURITY.md](./SECURITY.md) for the coordinated disclosure policy.

### Required in Reports

1. **Title**
2. **Severity Assessment**
3. **Impact**
4. **Affected Component**
5. **Technical Reproduction**
6. **Demonstrated Impact**
7. **Environment**
8. **Remediation Advice**

Reports without reproduction steps, demonstrated impact, and remediation advice will be deprioritized. Given the volume of AI-generated scanner findings, we must ensure we're receiving vetted reports from researchers who understand the issues.
