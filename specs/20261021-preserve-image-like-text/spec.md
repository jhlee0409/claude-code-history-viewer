# Spec: preserve image-like text

## Problem

Image detection treats any string ending in an image extension as an image and
extracts image URL substrings before Markdown parsing. Prose such as `Please
update logo.png` disappears, while code, Markdown links, copy, and search can
lose the original URL.

## Scope and acceptance

- Only a complete HTTP(S) URL with an image pathname or a complete base64 image
  data URL enters the standalone image renderer.
- Surrounding whitespace is trimmed for an actual standalone image.
- Prose and code retain the original content, including query strings and
  fragments; copy and search operate on the complete message.
- Explicit Markdown images retain their position and alt text. Markdown links
  remain links. Bare image URLs embedded in prose remain ordinary content.
- Structured image blocks retain their existing rendering and extraction.

Source history, image download behavior, and other content renderers are outside
this change.
