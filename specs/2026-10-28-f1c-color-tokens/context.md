# Context and decisions

- Concurrent F2b owns UI primitives/consumer adoption and index.css `.segmented`; TRbe owns backend metadata. No edits in those surfaces.
- Existing code roles and CSS resolver/contrast/CIEDE2000 math already existed from F1a. No colour library is required.
- Existing Prism callers pass resolved styles, not token types. The adapter maps exported VS Light/Dark colour groups to role tokens without changing caller files. Shared original groups cannot recover per-type distinctions (VS Light function/keyword); preserve that grouping and document it rather than pretending otherwise.
- Identity hues are not unique provider IDs; high-contrast themes deliberately use the foreground and neutral badge surface. Labels and F2b ProviderMark shapes remain mandatory. Agent icons remain distinct.
- Data consumers are later screen slices: these new roles do not silently remap legacy chart palettes.
- glass/noise/glow retain live references. Broad CSS class/keyframe removal is not justified by the old plan's stale counts and would exceed this declaration-only ownership.
- Machado source: https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html (severity 1.0 supplementary matrices). CIEDE2000 is pinned to Sharma reference pairs. Simulation occurs in linear sRGB, clipped before CIELAB D65; no colour-only accessibility conclusion follows.
