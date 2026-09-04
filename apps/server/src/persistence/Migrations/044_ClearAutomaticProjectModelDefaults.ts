import * as Effect from "effect/Effect";

// Cozea can seed a project from the user's chosen tile/draft model. Unlike
// upstream T3, absence of a later metadata event does not prove this was an
// automatic default. Retain the migration slot without erasing either events
// or projections: there is no reliable persisted discriminator for old data.
export default Effect.void;
