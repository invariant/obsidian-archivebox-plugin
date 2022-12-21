# Obsidian ArchiveBox Plugin

This plugin searches Obsidian posts for Internet links and archives them to a self-hosted [ArchiveBox](https://archivebox.io) instance. If you're linking to external things in a second brain, you don't want them to disappear.

Unfortunately, since ArchiveBox does not have a stable API, this is desktop only as we cannot use XHR against it - instead, we have to fall back to Node.js networking. This plugin works by minimally implementing what is required to log into a private ArchiveBox instance and submit URLs to it. This plugin has been written in some-what of a way that as soon as ArchiveBox has a real REST API, it should be able to be quickly adapted for use on all Obsidian clients.

Tested against Obsidian 1.0.3.

## Assumptions and Limitations

-   You are running [ArchiveBox](https://archivebox.io).
-   A user / superuser has been created for ArchiveBox / Obsidian and this is used to submit.
-   You may or may not use HTTP Basic auth in front of `/public`
-   You want to archive fully-qualified URIs (e.g. `https://google.com/`, not `google.com` or `./some/path`).

## Usage

Install the ArchiveBox plugin and load it, then configure the information in the settings panel.

### Settings

-   **ArchiveBox URI** - Set this to the URL where your ArchiveBox instance is accessible, e.g. `https://archivebox.example.com/`.
-   **ArchiveBox Username** - The username for an account that has submission privileges.
-   **ArchiveBox Password** - The password for the account that has submission privileges.
-   **Ignore RFC1918 Addresses** - Ignore links that contain private addresses. By default, no URI pointing at an RFC1918 address will be saved.
-   **Ignored Domains** - Ignore links that exist in a comma-separated domain blocklist. (e.g. `google.com,duckduckgo.com`).
-   **Use Basic Auth** - Use [HTTP Basic Authentication](https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication) for a username/password ahead of ArchiveBox. Sometimes used when one wants to keep `/public` private.
-   **Basic Auth Username** - The HTTP basic auth username.
-   **Basic Auth Password** - The HTTP basic auth password.
-   **Auto-Submit** - Watch for file modification and auto-submit to ArchiveBox in real time. This can be relatively chatty so it is off by default.
-   **Minimum Batch Submission Time** - Wait at least this many seconds before sending another auto-submission.

## License

[GNU GPL-3.0](./LICENSE).

Personal software is for people, not corpo profit.
