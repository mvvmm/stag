# Credits

Third-party assets used by the game: models, textures, sounds, music, fonts. npm dependencies carry their own licenses and aren't listed here.

**Rules** (also in [AGENTS.md](AGENTS.md)):

- Every third-party asset gets a row here **before** it's used, with its source and license.
- Only assets whose license allows redistribution (CC0, CC-BY, …) are committed to this public repo. CC-BY and similar need the attribution in the "Credit" column.
- Assets whose license allows shipping them in a game but not redistributing the raw files (most asset-store EULAs) are **never committed**. They live outside the repo (R2, see step 9.1) and are listed here with location "R2".

| Asset | Author | Source | License | Location | Credit |
|---|---|---|---|---|---|
| Tiger model and animations (`public/models/tiger.glb`, built by `scripts/build-models.ts`) | kenchoo, from a "Tiger" model (no longer online) and MotionStreamStudios | [Tiger rebuilt](https://sketchfab.com/3d-models/tiger-rebuilt-6b5d14b2de984ffcb00ee00e404ad208), based on [White Tiger (RIGGED ANIMATED)](https://sketchfab.com/3d-models/white-tiger-rigged-animated-9dd099d283e54f99b7cbd40b531b1a29) | CC-BY 4.0 | repo | "Tiger rebuilt" by kenchoo, based on "White Tiger (RIGGED ANIMATED)" by MotionStreamStudios, both licensed under CC BY 4.0. Modified: clips renamed, an idle pose added, materials and textures re-encoded. |
