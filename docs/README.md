# Documentation

- [Setup](setup.md): Discord bot creation, running from source, and commands.
- [Configuration](configuration.md): providers, search, memory, retries, and access.
- [Deployment](deployment.md): Docker, updates, Google Cloud, and Discloud.

## Enable the GitHub Wiki

1. Open the repository's [Settings](https://github.com/jahruz67/CCai/settings).
2. Under **General → Features**, select **Wikis**.
3. Open the [Wiki](https://github.com/jahruz67/CCai/wiki) tab and create the first page.
4. Create Setup, Configuration, and Deployment pages using these files, update their links, then point the README's documentation link to the Wiki.

GitHub stores the Wiki in a separate Git repository. Adding files here does not publish them to the Wiki. After its first page exists, you can clone it using `https://github.com/jahruz67/CCai.wiki.git`.

See GitHub's instructions for [wiki settings](https://docs.github.com/en/communities/documenting-your-project-with-wikis/disabling-wikis) and [editing pages](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages).

The existing [GitHub Pages workflow](../.github/workflows/pages.yml) publishes the landing site from `site/`; it is separate from the Wiki.
