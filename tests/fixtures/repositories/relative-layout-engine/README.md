# Relative Layout Engine

Fixture sample for Project Sentinel E2E live-fire testing.

This repository exposes a deterministic slide layout engine with relative
coordinate constraints, parent-aware text regions, and zero-dependency SVG/HTML
export for reviewable presentation artifacts.

![sample](fixture://relative-layout-engine/artifacts/sample-slide.svg)

The important implementation signal is that every block is positioned as a ratio
of the canvas or parent frame. No LLM output is trusted for final x/y placement.
