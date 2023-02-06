# Obsidian ArchiveBox Plugin

This plugin searches Obsidian posts for Internet links and archives them to a self-hosted [ArchiveBox](https://archivebox.io) instance. If you're linking to external things in a second brain, you don't want them to disappear.

Unfortunately, since ArchiveBox does not have a stable API, this is desktop only as we cannot use XHR against it - instead, we have to fall back to Node.js networking. This plugin works by minimally implementing what is required to log into a private ArchiveBox instance and submit URLs to it. This plugin has been written in some-what of a way that as soon as ArchiveBox has a real REST API, it should be able to be quickly adapted for use on all Obsidian clients.

Tested against Obsidian 1.0.3.

## Assumptions and Limitations

-   You are running [ArchiveBox](https://archivebox.io) [**v0.6.3**](https://github.com/ArchiveBox/ArchiveBox/pull/721) or later.
-   A user / superuser has been created for ArchiveBox / Obsidian and this is used to submit.
-   You may or may not use HTTP Basic auth in front of `/public`
-   You want to archive fully-qualified URIs (e.g. `https://google.com/`, not `google.com` or `./some/path`).

### ArchiveBox is fragile!

As stated above, **ArchiveBox has no stable REST API** and thus this plugin attempts to minimally mimic the browser to get things done. The `master` branch of ArchiveBox is currently at v0.6.2 and thus **will not work**. As of now, `archivebox/archivebox:latest` works from Docker Hub, or run the `dev` branch if you're adventurous. My `docker-compose.yml` for ArchiveBox currently references:

````docker-compose
archivebox:
  image: archivebox/archivebox:latest
  volumes:
    - ./data:/data
  environment:
    - SAVE_ARCHIVE_DOT_ORG=False
    - CHECK_SSL_VALIDITY=False
````

There is an enormously good chance that this plugin will break in the future until the ArchiveBox API stabilizes, so please file a pull request if you notice that it isn't working for you.


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
-   **Cache URIs** - If this is selected, the plugin will not resubmit URIs it has seen before to ArchiveBox. ArchiveBox deduplicates on its own, but this cuts down on needless request bandwidth.
-   **Debug Mode** - Adds verbose logging to the Obsidian developer console. Turn on if a contributor has asked, or if you want to file an issue.


## License

[GNU GPL-3.0](./LICENSE).

Personal software is for people, not corpo profit.
