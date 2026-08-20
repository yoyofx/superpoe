# Project Lua

This directory contains Lua modules owned by SuperPoE. Keep feature bridges
here and leave the pinned PoB source under `upstreams/PathOfBuilding-PoE2/`
unchanged.

Run `npm run pipeline:lua` after changing a module. The generated files are
written to `public/superpoe-lua/`; they are loaded separately from the PoB
bundle at runtime.
