// How the player's body is shown: a view setting the debug pane switches (persisted there) and room
// views read every frame. Players always get the model (or the capsule if it failed to load).

export const bodyView = {
  /** Show the grey-box capsule instead of the model (to judge collision against the footprint). */
  capsule: false,
};
