import { sampleCurp } from "../src/lib/people/identity";

/**
 * A valid CURP for a person an e2e test creates: every active person needs
 * one (docs/identity-model.md). Random, above the seed's and the unit tests'
 * indexes, so runs against the same database do not collide.
 */
export const e2eCurp = () =>
  sampleCurp(200_000 + Math.floor(Math.random() * 600_000));
