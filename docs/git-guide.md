# Git & GitHub — A Beginner's Guide for ErnOS Contributors

Welcome! If you just made your first commit to GitHub and aren't quite sure what happened, this guide is for you.

## What is Git?

**Git** is a tool that tracks changes to files over time. Think of it like a detailed "undo history" for your entire project — but one that you can share with other people.

When you use Git, every saved snapshot of your work is called a **commit**. Each commit records:

- Which files changed
- Exactly what changed in those files
- Who made the change and when
- A short message describing *why* the change was made

## What is GitHub?

**GitHub** is a website that stores your Git history in the cloud. It lets you:

- Back up your work online
- Share your project with the world
- Collaborate with others
- Track issues, ideas, and planned work

Think of **Git** as the engine and **GitHub** as the garage where you park and show off what you built.

## What Did My Commits Do?

When you made your first two commits, here's what happened step by step:

1. **You edited a file** (in this case, `MANIFESTO.md`).
2. **Git noticed the change** — it saw that the file was different from the last saved version.
3. **You committed the change** — this created a permanent snapshot in the project's history with a message describing what you did.
4. **You pushed to GitHub** — this uploaded your new snapshots from your local machine to GitHub's servers, making them visible online.

You can see your commits at:
[https://github.com/MettaMazza/ErnOS/commits/main](https://github.com/MettaMazza/ErnOS/commits/main)

## The Basic Workflow

Every time you want to make a change to the project, follow this pattern:

```
edit a file  →  stage the change  →  commit  →  push to GitHub
```

### In plain English:

1. **Edit** — Make your change in any editor (or directly on GitHub).
2. **Stage** — Tell Git which changes you want to include in this commit (`git add`).
3. **Commit** — Save a named snapshot of those changes with a message (`git commit -m "your message"`).
4. **Push** — Upload your commits to GitHub (`git push`).

### Editing directly on GitHub (no-code workflow)

You can skip the command line entirely by editing files right in your browser:

1. Go to any file on [github.com/MettaMazza/ErnOS](https://github.com/MettaMazza/ErnOS).
2. Click the **pencil icon** (✏️) in the top-right corner of the file view.
3. Make your edits.
4. Scroll down to the **"Commit changes"** box.
5. Write a short message that describes what you changed (e.g. `docs: update manifesto intro`).
6. Click **"Commit changes"**.

That's it — Git and GitHub handle the rest.

## Writing Good Commit Messages

A commit message is how you (and others) understand the history of the project. Good messages are short but descriptive.

### A useful format:

```
type: brief description of what changed
```

Where `type` is one of the lowercase keywords from the table below.

Common types used in ErnOS:

| Prefix  | Use when…                                      |
|---------|------------------------------------------------|
| `docs`  | You updated documentation or the manifesto     |
| `fix`   | You corrected a bug or mistake                 |
| `feat`  | You added something new                        |
| `chore` | Routine maintenance (updating configs, etc.)   |

### Examples:

- ✅ `docs: clarify origin story in manifesto`
- ✅ `fix: correct typo in README`
- ✅ `feat: add dream cycle threshold config option`
- ❌ `update` (too vague)
- ❌ `fixed stuff` (no context)

## Understanding Branches

By default, your changes go to the **`main`** branch — the primary, live version of the project.

For larger changes, it's good practice to create a separate **branch**, work there, and then open a **Pull Request** (PR) to merge your work back into `main`. A PR lets you (and collaborators) review the changes before they become permanent.

For small edits like documentation updates, committing directly to `main` is perfectly fine.

## Seeing Your History

At any time, you can browse the full history of changes on GitHub:

- **All commits**: [github.com/MettaMazza/ErnOS/commits/main](https://github.com/MettaMazza/ErnOS/commits/main)
- **Changes in a single commit**: click any commit message to see exactly what changed line by line

## Next Steps

- Browse the [CONTRIBUTING.md](../CONTRIBUTING.md) for how to submit larger changes.
- Check [GitHub's own beginner docs](https://docs.github.com/en/get-started) for a deeper dive.
- Join the **[ErnOS Discord](https://discord.gg/Yr7WNYWcj6)** if you have questions — no question is too basic.

---

*You made your first commit. That's the hardest part. Everything else is just practice.*
