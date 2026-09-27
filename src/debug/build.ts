/** The build shown in the pane title and `__game.build`: commit short hash, `-dirty` if the tree had changes. */
export const BUILD = __DIRTY__ ? `${__COMMIT__}-dirty` : __COMMIT__;
