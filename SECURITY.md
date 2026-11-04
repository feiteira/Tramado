# Security

Tramado holds students' lecture recordings, transcripts, notes and class chats, and shares classes directly between
classmates' computers. We take reports seriously and are grateful for them.

## Reporting a vulnerability

Please report privately: **do not open a public issue**. Use GitHub's private reporting, the **Report a
vulnerability** button under this repository's **Security** tab. Include what you found, how to reproduce it, and the
Tramado version (Settings › About) and operating system. **Copy diagnostics** in Settings › About gives a summary
without the content of your classes.

We aim to acknowledge reports within 5 working days, to keep you informed while we work on a fix, and to agree a
disclosure date with you once a fix is ready. We are happy to credit you, or not, as you prefer.

Never include real recordings, transcripts, classmates' details or an API key in a report; use the example library or
invented material. You may write in English, Portuguese or Spanish.

## Supported versions

Only the latest release receives security fixes. 0.1.0 is a release candidate.

## How Tramado protects you

The [architecture](docs/dev/architecture.md#16-security-model) (§16) lists every rule. In short:

- **The window has no network.** Its content-security policy allows only the app itself; every connection (OpenRouter,
  AI services you approved, Hugging Face) is made by the Rust side, to an allow-list of hosts and paths. Your
  OpenRouter key and Syncthing's API key never reach the window.
- **No file paths from the window.** File dialogs run natively and hand back opaque tokens; every class operation is
  confined to the class's registered folder and refuses symbolic links, so rendered content from a classmate cannot
  read or write elsewhere on your computer.
- **Untrusted content is rendered safely.** Chat, notes, transcripts and AI output are shown without raw HTML; links
  open only after a native confirmation; images come only from class files.
- **Classmates' records are checked.** Membership and authority records are signed with each computer's Syncthing key
  and bound to a person key; a file written by the wrong computer is ignored and the owner's copy restores itself;
  deleting someone else's file needs their authorship.
- **Sharing is narrow.** Syncthing runs with its own API key and password, on a loopback port, without introducers;
  Tramado admits a computer only with proof that it holds the invite, and re-checks every widening of access itself.
- **Privacy cannot be relaxed silently.** Making AI privacy less strict, or allowing a new AI service, always needs a
  confirmation in a native window.

## Especially welcome

- Any connection Tramado or its Syncthing makes that [PRIVACY.md](PRIVACY.md) does not list, or any way to make the
  window reach the network.
- Ways for a classmate (or anyone holding an invite) to read or write files outside a class folder, to take over a
  class, to lift a removal, or to make their changes look like someone else's.
- Crafted files (PDF, DOCX, PPTX, recordings, `.tramado-invite`, class records) that cause code execution, escape their
  folder, or corrupt other classes.
- Ways to read the OpenRouter key or the Syncthing API key from the window or from logs and diagnostics.
