#!/bin/sh
# Flatpak entry point for Omnilogue.
#
# Flatpak points XDG_CONFIG_HOME and XDG_DATA_HOME at ~/.var/app/<app-id>/,
# but several providers are found through those variables: Cline, Trae and
# llm under ~/.config; Zed, OpenCode, Kilo, Goose, Kiro, Amazon Q and
# Antigravity's logs under ~/.local/share. Point them back at the host
# directories, which the manifest exposes (read-only except where the app
# writes).
#
# The app's own settings follow: they live in
# ~/.config/com.claude.history-viewer and ~/.local/share/com.claude.history-viewer,
# the same folders the .deb, .rpm and AppImage builds use, so switching
# between them keeps your settings. The cache stays inside the sandbox.
export XDG_CONFIG_HOME="${HOST_XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_DATA_HOME="${HOST_XDG_DATA_HOME:-$HOME/.local/share}"

exec /app/bin/claude-code-history-viewer "$@"
